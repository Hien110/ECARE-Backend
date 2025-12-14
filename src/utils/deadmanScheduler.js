const moment = require('moment-timezone');
const ElderlyProfile = require('../app/models/ElderlyProfile');

async function sweepOnce() {
  const reqId = Math.random().toString(36).slice(2, 8);

  const list = await ElderlyProfile.find({
    'safetyMonitoring.deadmanConfig.enabled': true,
  })
    .select('user safetyMonitoring')
    .lean();

  const WINDOWS = ['07:00', '15:00', '19:00'];

  for (const prof of list) {
    const cfg = prof.safetyMonitoring?.deadmanConfig || {};
    const st = prof.safetyMonitoring?.deadmanState || {};

    const tz = cfg.timezone || 'Asia/Ho_Chi_Minh';
    const nowTZ = moment().tz(tz);

    const lastCheckin = st.lastCheckinAt ? moment(st.lastCheckinAt).tz(tz) : null;
    const snoozeUntil = st.snoozeUntil ? moment(st.snoozeUntil).tz(tz) : null;
    const lastRemAt = st.lastReminderAt ? moment(st.lastReminderAt).tz(tz) : null;

    const alertCountTodayRaw = Number(st.alertCountToday || 0);
    const autoSosTriggeredAt = st.autoSosTriggeredAt
      ? moment(st.autoSosTriggeredAt).tz(tz)
      : null;

    if (snoozeUntil && snoozeUntil.isAfter(nowTZ)) {
      continue;
    }

    for (const hhmm of WINDOWS) {
      const [hh, mm] = hhmm.split(':').map(n => Number(n) || 0);

      const windowStart = nowTZ
        .clone()
        .hour(hh)
        .minute(mm)
        .second(0)
        .millisecond(0);

      const remindAt = windowStart.clone().subtract(5, 'minutes');
      const firstAlertAt = windowStart.clone().add(10, 'minutes');

      const repeatGapMins = 1;

      if (lastCheckin && lastCheckin.isSameOrAfter(windowStart)) {
        continue;
      }

      if (nowTZ.isSameOrAfter(remindAt) && nowTZ.isBefore(windowStart)) {
        let needRemind = false;

        if (!lastRemAt || !lastRemAt.isValid()) {
          needRemind = true;
        } else {
          const isSameWindowReminder =
            lastRemAt.isSame(nowTZ, 'day') &&
            lastRemAt.isSameOrAfter(remindAt) &&
            lastRemAt.isBefore(windowStart);
            needRemind = !isSameWindowReminder;
        }

        if (needRemind) {
          try {
            await ElderlyProfile.updateOne(
              { user: prof.user },
              {
                $set: {
                  'safetyMonitoring.deadmanState.lastReminderAt': new Date(),
                },
              },
            );
            const DeadmanController = require('../app/controllers/deadmanController');
            if (typeof DeadmanController._remindElder === 'function') {
              await DeadmanController._remindElder(prof.user);
            } else {
            }
          } catch (e) {
            console.error('[Deadman] remind error', e);
          }
        } else {
        }
        continue;
      }

      if (nowTZ.isSameOrAfter(firstAlertAt)) {
        const lastAlertAtRaw = st.lastAlertAt ? moment(st.lastAlertAt).tz(tz) : null;
        let alertCountToday = alertCountTodayRaw;

        const lastIsValid =
          lastAlertAtRaw && lastAlertAtRaw.isValid && lastAlertAtRaw.isValid();
          let inSameWindow = false;
          if (lastIsValid) {
            inSameWindow =
              lastAlertAtRaw.isSame(nowTZ, 'day') &&
              lastAlertAtRaw.isSameOrAfter(firstAlertAt);
          }

        if (!inSameWindow) {
          alertCountToday = 0;
        }

        const repeatGapMinsInner = 1;

        let shouldSend = false;
        let nextAlertDueLog = null;

        if (!lastIsValid || !inSameWindow) {
          shouldSend = true;
          nextAlertDueLog = firstAlertAt.format();
        } else {
          const diffMins = nowTZ.diff(lastAlertAtRaw, 'minutes');
          shouldSend = diffMins >= repeatGapMinsInner;
          nextAlertDueLog = lastAlertAtRaw
            .clone()
            .add(repeatGapMinsInner, 'minutes')
            .format();
        }

        if (shouldSend) {
          alertCountToday += 1;

          const shouldTriggerAutoSOS = alertCountToday === 3; // ✅ Lần thứ 3 trong KHUNG GIỜ nào cũng auto SOS

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
            } else {
            }
          } catch (e) {
            console.error('[Deadman] alert error', e);
          }
        } else {
        }

        continue; 
      }

      if (nowTZ.isBefore(remindAt)) {
        continue;
      }

      if (nowTZ.isSameOrAfter(windowStart) && nowTZ.isBefore(firstAlertAt)) {
        continue;
      }
    }
  }
}

function startDeadmanScheduler() {
  sweepOnce().catch(e => console.error('[Deadman] Sweep error (initial)', e));
  setInterval(() => {
    sweepOnce().catch(e => console.error('[Deadman] Sweep error', e));
  }, 60 * 1000); 
}

module.exports = { startDeadmanScheduler, sweepOnce };
