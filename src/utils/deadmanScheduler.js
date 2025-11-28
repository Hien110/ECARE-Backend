// utils/deadmanScheduler.js
const moment = require('moment-timezone');
const ElderlyProfile = require('../app/models/ElderlyProfile');

// Log helper
function lg(reqId, ...args) {
  console.log(`[Deadman][sweep][#${reqId}]`, ...args);
}

async function sweepOnce() {
  const reqId = Math.random().toString(36).slice(2, 8);

  const list = await ElderlyProfile.find({
    'safetyMonitoring.deadmanConfig.enabled': true,
  })
    .select('user safetyMonitoring')
    .lean();

  lg(reqId, 'START. profiles=', list.length);

  // 3 khung giờ cố định
  const WINDOWS = ['07:00', '15:00', '19:00'];

  for (const prof of list) {
    const cfg = prof.safetyMonitoring?.deadmanConfig || {};
    const st = prof.safetyMonitoring?.deadmanState || {};

    const tz = cfg.timezone || 'Asia/Ho_Chi_Minh';
    const nowTZ = moment().tz(tz);

    const lastCheckin = st.lastCheckinAt ? moment(st.lastCheckinAt).tz(tz) : null;
    const snoozeUntil = st.snoozeUntil ? moment(st.snoozeUntil).tz(tz) : null;
    const lastRemAt = st.lastReminderAt ? moment(st.lastReminderAt).tz(tz) : null;
    const lastAlAt = st.lastAlertAt ? moment(st.lastAlertAt).tz(tz) : null;

    // 🆕 Trạng thái đếm alert & auto SOS trong ngày
    const alertCountTodayRaw = Number(st.alertCountToday || 0);
    const autoSosTriggeredAt = st.autoSosTriggeredAt
      ? moment(st.autoSosTriggeredAt).tz(tz)
      : null;

    lg(reqId, 'USER=', String(prof.user));
    lg(reqId, {
      tz,
      now: nowTZ.format(),
      lastCheckinAt: lastCheckin?.format() || null,
      snoozeUntil: snoozeUntil?.format() || null,
      lastReminderAt: st.lastReminderAt,
      lastAlertAt: st.lastAlertAt,
      alertCountToday: alertCountTodayRaw,
      autoSosTriggeredAt: autoSosTriggeredAt?.format() || null,
    });

    // 0) Đang snooze => bỏ qua toàn bộ
    if (snoozeUntil && snoozeUntil.isAfter(nowTZ)) {
      lg(reqId, 'SKIP reason=snoozed_until', snoozeUntil.format());
      continue;
    }

    // Quét 3 cửa sổ trong HÔM NAY
    for (const hhmm of WINDOWS) {
      const [hh, mm] = hhmm.split(':').map(n => Number(n) || 0);

      // Mốc bắt đầu cửa sổ
      const windowStart = nowTZ
        .clone()
        .hour(hh)
        .minute(mm)
        .second(0)
        .millisecond(0);

      // Nhắc trước 5 phút, alert sau 10 phút
      const remindAt = windowStart.clone().subtract(5, 'minutes');
      const firstAlertAt = windowStart.clone().add(10, 'minutes');

      // 🆕 Lặp ALERT mỗi 1 phút (cho bạn test)
      const repeatGapMins = 1;

      lg(reqId, '--- window ---', {
        window: hhmm,
        windowStart: windowStart.format(),
      });

      // 1) Nếu đã check-in sau thời điểm bắt đầu cửa sổ → bỏ qua cửa sổ này
      if (lastCheckin && lastCheckin.isSameOrAfter(windowStart)) {
        lg(reqId, 'SKIP window reason=checked_in_after_windowStart');
        continue;
      }

      // 2) Khoảng nhắc (-5' → 0'): gửi REMINDER (mỗi cửa sổ chỉ 1 lần)
      if (nowTZ.isSameOrAfter(remindAt) && nowTZ.isBefore(windowStart)) {
        const needRemind = !lastRemAt || lastRemAt.isBefore(windowStart);
        if (needRemind) {
          lg(reqId, 'ACTION reminder -> _remindElder (pre-5m)');
          try {
            await ElderlyProfile.updateOne(
              { user: prof.user },
              { $set: { 'safetyMonitoring.deadmanState.lastReminderAt': new Date() } },
            );
            // lazy require để tránh circular
            const DeadmanController = require('../app/controllers/deadmanController');
            if (typeof DeadmanController._remindElder === 'function') {
              await DeadmanController._remindElder(prof.user);
              lg(reqId, 'REMINDER sent OK');
            } else {
              lg(reqId, 'WARN _remindElder not implemented');
            }
          } catch (e) {
            console.error('[Deadman] remind error', e);
          }
        } else {
          lg(reqId, 'SKIP reason=reminder_already_sent_for_this_window');
        }
        continue;
      }

      // 3) Sau mốc windowStart +10' → ALERT đến người thân, và LẶP mỗi 1'
      if (nowTZ.isSameOrAfter(firstAlertAt)) {
        // 🆕 Đọc lại lastAlertAt & alertCountToday từ state
        const lastAlertAtRaw = st.lastAlertAt ? moment(st.lastAlertAt).tz(tz) : null;
        let alertCountToday = alertCountTodayRaw;

        const lastIsValid =
          !!(lastAlertAtRaw && typeof lastAlertAtRaw.isValid === 'function' && lastAlertAtRaw.isValid());
        const sameDay = lastIsValid && lastAlertAtRaw.isSame(nowTZ, 'day');

        // Nếu chưa có alert trong NGÀY hiện tại → reset về 0
        if (!sameDay) {
          console.log(
            '[Deadman][count] reset alertCountToday vì sang ngày mới hoặc lastAlertAt invalid',
            {
              prevAlertCountToday: alertCountTodayRaw,
              lastAlertAt: st.lastAlertAt,
            },
          );
          alertCountToday = 0;
        }

        // Quyết định có gửi thêm alert hay chưa:
        let shouldSend = false;
        let nextAlertDueLog = null;

        if (!lastIsValid) {
          // Chưa từng alert bao giờ hoặc lastAlertAt invalid → gửi ngay lần đầu
          shouldSend = true;
          nextAlertDueLog = firstAlertAt.format();
        } else {
          const diffMins = nowTZ.diff(lastAlertAtRaw, 'minutes');
          shouldSend = diffMins >= repeatGapMins;
          nextAlertDueLog = lastAlertAtRaw
            .clone()
            .add(repeatGapMins, 'minutes')
            .format();

          console.log('[Deadman][count] diffMins since lastAlertAt =', diffMins, {
            lastAlertAt: lastAlertAtRaw.format(),
            now: nowTZ.format(),
          });
        }

        if (shouldSend) {
          // Tăng số lần alert trong NGÀY
          alertCountToday += 1;

          // 🔥 CHỈ LẦN THỨ 3 MỚI AUTO SOS
          const shouldTriggerAutoSOS = alertCountToday === 3;

          console.log('[Deadman][logic]', {
            alertCountToday,
            autoSosTriggeredAt: autoSosTriggeredAt
              ? autoSosTriggeredAt.format?.()
              : null,
            shouldTriggerAutoSOS,
          });

          lg(reqId, 'ACTION alert -> _alertRelatives (every 1 minute)', {
            window: hhmm,
            alertCountToday,
            shouldTriggerAutoSOS,
          });

          try {
            const setObj = {
              'safetyMonitoring.deadmanState.lastAlertAt': new Date(),
              'safetyMonitoring.deadmanState.alertCountToday': alertCountToday,
            };

            // Lưu lại thời điểm autoSOS (tuỳ bạn dùng để thống kê)
            if (shouldTriggerAutoSOS) {
              setObj['safetyMonitoring.deadmanState.autoSosTriggeredAt'] =
                new Date();
            }

            await ElderlyProfile.updateOne(
              { user: prof.user },
              { $set: setObj },
            );

            const DeadmanController = require('../app/controllers/deadmanController');
            if (typeof DeadmanController._alertRelatives === 'function') {
              await DeadmanController._alertRelatives(prof.user, {
                alertCountToday,
                isAutoSOS: shouldTriggerAutoSOS,
              });
              lg(reqId, 'ALERT sent OK (to relatives)', {
                alertCountToday,
                isAutoSOS: shouldTriggerAutoSOS,
              });
            } else {
              lg(reqId, 'WARN _alertRelatives not implemented');
            }
          } catch (e) {
            console.error('[Deadman] alert error', e);
          }
        } else {
          lg(reqId, 'WAIT until next 1m alert tick', {
            nextAlertDue: nextAlertDueLog,
          });
        }

        continue; // qua cửa sổ tiếp theo
      }

      // 4) Trước remindAt → chưa tới cửa sổ → chờ
      if (nowTZ.isBefore(remindAt)) {
        lg(reqId, 'WAITING (before remindAt)');
        continue;
      }

      // 5) Trong khoảng [windowStart, firstAlertAt) → đang đếm sau khi bắt đầu cửa sổ
      if (nowTZ.isSameOrAfter(windowStart) && nowTZ.isBefore(firstAlertAt)) {
        lg(reqId, 'COUNTING (between windowStart and firstAlertAt)');
        continue;
      }
    }
  }

  lg(reqId, 'END');
}

function startDeadmanScheduler() {
  console.log('[Deadman] Scheduler started (utils/deadmanScheduler.js)');
  // chạy ngay 1 vòng để thấy log tức thì
  sweepOnce().catch(e => console.error('[Deadman] Sweep error (initial)', e));

  // 🆕 Tick mỗi 1 phút để test alert & auto SOS
  setInterval(() => {
    sweepOnce().catch(e => console.error('[Deadman] Sweep error', e));
  }, 60 * 1000); // 1 phút
}

module.exports = { startDeadmanScheduler, sweepOnce };
