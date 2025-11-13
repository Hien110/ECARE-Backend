// utils/deadmanScheduler.js
const moment = require('moment-timezone');
const ElderlyProfile = require('../app/models/ElderlyProfile');
// ❗ Không require controller ở đây để tránh circular;
// sẽ require "lười" ngay trước khi gọi

function lg(reqId, ...args) {
  console.log(`[Deadman][sweep][#${reqId}]`, ...args);
}

async function sweepOnce() {
  const reqId = Math.random().toString(36).slice(2, 8);

  const list = await ElderlyProfile.find({
    'safetyMonitoring.deadmanConfig.enabled': true,
  }).select('user safetyMonitoring').lean();

  lg(reqId, 'START. profiles=', list.length);

  // --- Cấu hình 3 khung giờ theo yêu cầu ---
  const WINDOWS = ["07:00", "15:00", "19:00"]; // sáng, chiều, tối (cố định)

  for (const prof of list) {
    const cfg = prof.safetyMonitoring?.deadmanConfig || {};
    const st  = prof.safetyMonitoring?.deadmanState  || {};

    const tz = cfg.timezone || 'Asia/Ho_Chi_Minh';
    const nowTZ = moment().tz(tz);

    const lastCheckin = st.lastCheckinAt ? moment(st.lastCheckinAt).tz(tz) : null;
    const snoozeUntil = st.snoozeUntil ? moment(st.snoozeUntil).tz(tz) : null;
    const lastRemAt   = st.lastReminderAt ? moment(st.lastReminderAt).tz(tz) : null;
    const lastAlAt    = st.lastAlertAt ? moment(st.lastAlertAt).tz(tz) : null;

    lg(reqId, 'USER=', String(prof.user));
    lg(reqId, {
      tz,
      now: nowTZ.format(),
      lastCheckinAt: lastCheckin?.format() || null,
      snoozeUntil: snoozeUntil?.format() || null,
      lastReminderAt: st.lastReminderAt,
      lastAlertAt: st.lastAlertAt,
    });

    // 0) Đang snooze => bỏ qua toàn bộ
    if (snoozeUntil && snoozeUntil.isAfter(nowTZ)) {
      lg(reqId, 'SKIP reason=snoozed_until', snoozeUntil.format());
      continue;
    }

    // Quét 3 cửa sổ trong HÔM NAY
    for (const hhmm of WINDOWS) {
      const [hh, mm] = hhmm.split(':').map(n => Number(n) || 0);

      // Mốc bắt đầu cửa sổ trong hôm nay
      const windowStart   = nowTZ.clone().hour(hh).minute(mm).second(0).millisecond(0);
      const remindAt      = windowStart.clone().subtract(5, 'minutes'); // Nhắc người cao tuổi: -5'
      const firstAlertAt  = windowStart.clone().add(10, 'minutes');     // Cảnh báo người thân: +10'
      const repeatGapMins = 10;                                          // Lặp 10'

      lg(reqId, '--- window ---', { window: hhmm, windowStart: windowStart.format() });

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
              { $set: { "safetyMonitoring.deadmanState.lastReminderAt": new Date() } }
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
        continue; // qua cửa sổ tiếp theo
      }

      // 3) Sau mốc windowStart +10' → ALERT đến người thân, và LẶP mỗi 10' cho đến khi check-in
      if (nowTZ.isSameOrAfter(firstAlertAt)) {
        // Nếu lần alert gần nhất thuộc cửa sổ trước → mốc due là firstAlertAt; ngược lại → lastAlertAt + 10'
        const lastAlertBelongsPrevWindow = !lastAlAt || lastAlAt.isBefore(windowStart);
        const nextAlertDue = !lastAlertBelongsPrevWindow
          ? lastAlAt.clone().add(repeatGapMins, 'minutes')
          : firstAlertAt;

        if (nowTZ.isSameOrAfter(nextAlertDue)) {
          lg(reqId, 'ACTION alert -> _alertRelatives (repeat every 10m)');
          try {
            await ElderlyProfile.updateOne(
              { user: prof.user },
              { $set: { "safetyMonitoring.deadmanState.lastAlertAt": new Date() } }
            );
            // lazy require để tránh circular
            const DeadmanController = require('../app/controllers/deadmanController');
            if (typeof DeadmanController._alertRelatives === 'function') {
              await DeadmanController._alertRelatives(prof.user);
              lg(reqId, 'ALERT sent OK');
            } else {
              lg(reqId, 'WARN _alertRelatives not implemented');
            }
          } catch (e) {
            console.error('[Deadman] alert error', e);
          }
        } else {
          lg(reqId, 'WAIT until next 10m alert tick', { next: nextAlertDue.format() });
        }
        continue; // qua cửa sổ tiếp theo
      }

      // 4) Trước remindAt → chưa tới cửa sổ → chờ
      if (nowTZ.isBefore(remindAt)) {
        lg(reqId, 'WAITING (before remindAt)');
        continue;
      }

      // 5) Trong khoảng [windowStart, firstAlertAt) → đang đếm thời gian sau khi bắt đầu cửa sổ
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

  setInterval(() => {
    sweepOnce().catch(e => console.error('[Deadman] Sweep error', e));
  }, 5 * 60 * 1000); // giữ nguyên tần suất như bản gốc
}

module.exports = { startDeadmanScheduler, sweepOnce };
