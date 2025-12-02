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

      // Mốc bắt đầu cửa sổ (trong NGÀY hôm nay)
      const windowStart = nowTZ
        .clone()
        .hour(hh)
        .minute(mm)
        .second(0)
        .millisecond(0);

      // Nhắc trước 5 phút, alert sau 10 phút
      const remindAt = windowStart.clone().subtract(5, 'minutes');
      const firstAlertAt = windowStart.clone().add(10, 'minutes');

      // Lặp ALERT mỗi 1 phút
      const repeatGapMins = 1;

      lg(reqId, '--- window ---', { window: hhmm, windowStart: windowStart.format() });

      // 1) Nếu đã check-in sau thời điểm bắt đầu cửa sổ → bỏ qua cửa sổ này
      if (lastCheckin && lastCheckin.isSameOrAfter(windowStart)) {
        lg(reqId, 'SKIP window reason=checked_in_after_windowStart');
        continue;
      }

      // 2) Khoảng nhắc (-5' → 0'): gửi REMINDER (mỗi cửa sổ chỉ 1 lần)
      if (nowTZ.isSameOrAfter(remindAt) && nowTZ.isBefore(windowStart)) {
        const needRemind = !lastRemAt || moment(st.lastReminderAt).tz(tz).isBefore(windowStart);
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
          lastAlertAtRaw && lastAlertAtRaw.isValid && lastAlertAtRaw.isValid();

        // 🆕🆕 SỬA LOGIC RESET: reset THEO KHUNG GIỜ, KHÔNG PHẢI THEO NGÀY
        // - Nếu lastAlertAt không cùng ngày HOẶC trước firstAlertAt của khung giờ hiện tại
        //   → coi như sang "cửa sổ mới", reset về 0.
        let inSameWindow = false;
        if (lastIsValid) {
          inSameWindow =
            lastAlertAtRaw.isSame(nowTZ, 'day') &&
            lastAlertAtRaw.isSameOrAfter(firstAlertAt);
        }

        if (!inSameWindow) {
          console.log(
            '[Deadman][count] reset alertCountToday vì sang khung giờ mới hoặc lastAlertAt invalid',
            {
              window: hhmm,
              firstAlertAt: firstAlertAt.format(),
              prevAlertCountToday: alertCountTodayRaw,
              lastAlertAt: st.lastAlertAt,
            },
          );
          alertCountToday = 0;
        }

        // Khoảng cách tối thiểu giữa 2 alert (phút)
        const repeatGapMinsInner = 1;

        // Quyết định có gửi thêm alert hay chưa:
        let shouldSend = false;
        let nextAlertDueLog = null;

        if (!lastIsValid || !inSameWindow) {
          // Chưa từng alert trong KHUNG GIỜ NÀY → gửi ngay lần đầu
          shouldSend = true;
          nextAlertDueLog = firstAlertAt.format();
        } else {
          const diffMins = nowTZ.diff(lastAlertAtRaw, 'minutes');
          shouldSend = diffMins >= repeatGapMinsInner;
          nextAlertDueLog = lastAlertAtRaw
            .clone()
            .add(repeatGapMinsInner, 'minutes')
            .format();

          console.log('[Deadman][count] diffMins since lastAlertAt =', diffMins, {
            window: hhmm,
            lastAlertAt: lastAlertAtRaw.format(),
            now: nowTZ.format(),
          });
        }

        if (shouldSend) {
          // Tăng số lần alert TRONG KHUNG GIỜ HIỆN TẠI
          alertCountToday += 1;

          const shouldTriggerAutoSOS = alertCountToday === 3; // ✅ Lần thứ 3 trong KHUNG GIỜ nào cũng auto SOS

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

            if (shouldTriggerAutoSOS) {
              setObj['safetyMonitoring.deadmanState.autoSosTriggeredAt'] = new Date();
            }

            await ElderlyProfile.updateOne({ user: prof.user }, { $set: setObj });

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
          lg(reqId, 'WAIT until next 1m alert tick', { nextAlertDue: nextAlertDueLog });
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

  // Tick mỗi 1 phút để test alert & auto SOS
  setInterval(() => {
    sweepOnce().catch(e => console.error('[Deadman] Sweep error', e));
  }, 60 * 1000); // 1 phút
}

module.exports = { startDeadmanScheduler, sweepOnce };
