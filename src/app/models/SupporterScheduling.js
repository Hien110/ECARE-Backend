// models/SupporterScheduling.js
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { Schema } = mongoose;

const SESSION_SLOTS = ['morning', 'afternoon', 'evening'];
const BOOKING_TYPE = ['session', 'day', 'month'];
const STATUS = ['pending', 'confirmed', 'in_progress', 'completed', 'canceled'];
const PAYMENT_METHOD = ['cash', 'bank_transfer'];

const supporterSchedulingSchema = new Schema(
  {
    // Người hỗ trợ
    supporter: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Người cao tuổi
    elderly: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Dịch vụ áp dụng
    service: {
      type: Schema.Types.ObjectId,
      ref: 'SupporterService',
    },

    // session | day | month
    bookingType: {
      type: String,
      enum: BOOKING_TYPE,
      default: 'session',
      required: true,
    },

    /**
     * --- THEO BUỔI (session) ---
     * Cần: scheduleDate + scheduleTime
     */
    scheduleDate: {
      type: Date,
    },
    scheduleTime: {
      type: String,
      enum: SESSION_SLOTS,
    },

    /**
     * --- THEO NGÀY (day) ---
     * Cần: scheduleDate
     * (không có scheduleTime)
     */

    /**
     * --- THEO THÁNG ---
     * Cần: monthStart + monthEnd + monthSessionsPerDay
     */
    monthStart: { type: Date },
    monthEnd: { type: Date },
    monthSessionsPerDay: [
      { type: String, enum: SESSION_SLOTS }
    ],

    // Trạng thái lịch
    status: {
      type: String,
      enum: STATUS,
      default: 'pending',
    },

    // Địa chỉ người cao tuổi tại thời điểm đặt
    address: { type: String, default: '' },

    // Ghi chú
    notes: { type: String, default: '' },

    // User tạo lịch
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Thanh toán
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHOD,
      default: 'cash',
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded'],
      default: 'unpaid',
    },

    // Snapshot giá
    priceAtBooking: {
      type: Number,
      min: 0,
    },

    // Lý do hủy
    cancelReason: { type: String, default: '' },
  },
  { timestamps: true }
);

/**
 * ✅ Chuẩn hóa ngày theo giờ Việt Nam (UTC+7)
 * FE đã validate rồi nên chỉ cần convert giờ là đủ.
 *
 * - session/day: scheduleDate → 00:00:00 VN time
 * - month:
 *      monthStart → 00:00:00
 *      monthEnd   → 23:59:59.999
 */
supporterSchedulingSchema.pre('save', function (next) {
  // Chỉ normalize nếu là kiểu Date hợp lệ
  if (this.scheduleDate instanceof Date && !isNaN(this.scheduleDate)) {
    this.scheduleDate = moment(this.scheduleDate)
      .tz('Asia/Ho_Chi_Minh')
      .startOf('day')
      .toDate();
  }

  if (this.monthStart instanceof Date && !isNaN(this.monthStart)) {
    this.monthStart = moment(this.monthStart)
      .tz('Asia/Ho_Chi_Minh')
      .startOf('day')
      .toDate();
  }

  if (this.monthEnd instanceof Date && !isNaN(this.monthEnd)) {
    this.monthEnd = moment(this.monthEnd)
      .tz('Asia/Ho_Chi_Minh')
      .endOf('day')
      .toDate();
  }

  next();
  // ngay sau schema definition
supporterSchedulingSchema.index({ supporter: 1, status: 1, bookingType: 1, scheduleDate: 1, scheduleTime: 1 });
supporterSchedulingSchema.index({ supporter: 1, status: 1, monthStart: 1, monthEnd: 1 });

});

module.exports = mongoose.model('SupporterScheduling', supporterSchedulingSchema);
