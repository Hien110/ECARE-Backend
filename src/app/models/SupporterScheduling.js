const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { Schema } = mongoose;

const STATUS = ['pending', 'confirmed', 'in_progress', 'completed', 'canceled'];
const PAYMENT_METHOD = ['cash', 'bank_transfer'];

const supporterSchedulingSchema = new Schema(
  {
    supporter: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    registrant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    elderly: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    service: {
      type: Schema.Types.ObjectId,
      ref: 'SupporterService',
    },

    status: {
      type: String,
      enum: STATUS,
      default: 'pending',
    },

    notes: { type: String, default: '' },

    startDate: {
      type: Date,
      required: true,
    },

    endDate: {
      type: Date,
      required: true,
    },

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

    price: {
      type: Number,
      min: 0,
    },

    cancelReason: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SupporterScheduling', supporterSchedulingSchema);
