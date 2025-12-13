// utils/buildConflictQuery.js
const moment = require('moment-timezone');

/**
 * Kiểm tra xung đột lịch dựa trên khoảng thời gian (startDate, endDate)
 * Model mới đơn giản: chỉ cần check xem có lịch nào trùng khoảng thời gian không
 */
module.exports = function buildConflictQuery(bookingDraft) {
  const { startDate, endDate } = bookingDraft;
  
  // Chuyển đổi startDate và endDate sang Date object (timezone VN)
  const requestStart = moment.tz(startDate, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh').startOf('day').toDate();
  const requestEnd = moment.tz(endDate, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh').endOf('day').toDate();
  
  // Tìm các lịch có xung đột về thời gian và không bị hủy
  // Xung đột xảy ra khi:
  // - Lịch hiện tại startDate <= requestEnd
  // - Lịch hiện tại endDate >= requestStart
  return {
    status: { $nin: ['canceled'] },
    startDate: { $lte: requestEnd },
    endDate: { $gte: requestStart },
  };
};
