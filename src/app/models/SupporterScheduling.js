// models/SupporterScheduling.js
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { Schema } = mongoose;

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

    registrant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

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

    // Trạng thái lịch
    status: {
      type: String,
      enum: STATUS,
      default: 'confirmed',
    },

    // Ghi chú
    notes: { type: String, default: '' },

    startDate: {
      type: Date,
      required: true,
    },

    endDate: {
      type: Date,
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
    price: {
      type: Number,
      min: 0,
    },

    // Lý do hủy
    cancelReason: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SupporterScheduling', supporterSchedulingSchema);
