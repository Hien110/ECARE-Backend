// utils/buildConflictQuery.js
const moment = require('moment-timezone');

/** chuẩn hóa Y-M-D (VN) -> Date range 00:00..23:59 VN */
const dayRangeVN = (ymd) => {
  const start = moment.tz(ymd, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh').startOf('day').toDate();
  const end   = moment.tz(ymd, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh').endOf('day').toDate();
  return { start, end };
};

module.exports = function buildConflictQuery(bookingDraft) {
  const { packageType, session, day, month } = bookingDraft;
  const notCanceled = { $nin: ['canceled'] };

  if (packageType === 'session') {
    const { date, slot } = session; // YYYY-MM-DD, 'morning'|'afternoon'|'evening'
    const { start, end } = dayRangeVN(date);

    return {
      status: notCanceled,
      $or: [
        // có 1 lịch theo buổi trùng ngày + buổi
        { bookingType: 'session', scheduleDate: { $gte: start, $lte: end }, scheduleTime: slot },
        // hoặc có 1 lịch theo ngày trùng ngày
        { bookingType: 'day', scheduleDate: { $gte: start, $lte: end } },
        // hoặc có 1 lịch theo tháng bao phủ ngày đó và có giao buổi
        {
          bookingType: 'month',
          monthStart: { $lte: end },
          monthEnd:   { $gte: start },
          monthSessionsPerDay: { $in: [slot] },
        },
      ],
    };
  }

  if (packageType === 'day') {
    const { date } = day;
    const { start, end } = dayRangeVN(date);

    return {
      status: notCanceled,
      $or: [
        // bất kỳ buổi nào trong ngày đó cũng coi là bận (vì đặt theo ngày cần full ngày)
        { bookingType: 'session', scheduleDate: { $gte: start, $lte: end } },
        { bookingType: 'day',     scheduleDate: { $gte: start, $lte: end } },
        { bookingType: 'month',   monthStart: { $lte: end }, monthEnd: { $gte: start } },
      ],
    };
  }

  // packageType === 'month'
  if (packageType === 'month') {
    const start = moment.tz(month.start, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh').startOf('day').toDate();
    const end   = moment.tz(month.end,   'YYYY-MM-DD', 'Asia/Ho_Chi_Minh').endOf('day').toDate();

    // Các buổi cố định/ngày do service quy định, FE đã nhúng vào month.sessionsPerDay? (nếu cần)
    // Nếu không có, coi như bất kỳ lịch nào trong range cũng xung đột.
    const requestSlots = month.sessionsPerDay && month.sessionsPerDay.length
      ? { monthSessionsPerDay: { $in: month.sessionsPerDay } }
      : {};

    return {
      status: notCanceled,
      $or: [
        { bookingType: 'session', scheduleDate: { $gte: start, $lte: end } },
        { bookingType: 'day',     scheduleDate: { $gte: start, $lte: end } },
        { bookingType: 'month',   monthStart: { $lte: end }, monthEnd: { $gte: start }, ...(requestSlots) },
      ],
    };
  }

  // fallback
  return { _id: null }; // không match gì
};
