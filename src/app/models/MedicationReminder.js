const mongoose = require('mongoose');

const medicationReminderSchema = new mongoose.Schema({
  elderly: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  medicationName: {
    type: String,
    required: true
  },
  dosage: {
    type: String,
    required: true
  },
  medicationType: {
    type: String,
    enum: ['tablet', 'capsule', 'liquid', 'injection', 'cream', 'drops', 'inhaler', 'other'],
    default: 'tablet'
  },
  frequency: {
    type: String,
    enum: ['once_daily', 'twice_daily', 'three_times_daily', 'four_times_daily', 'as_needed', 'custom'],
    required: true
  },
  // Lịch uống thuốc
  schedule: [{
    time: {
      type: String,
      required: true // "08:00", "14:00", "20:00"
    },
    withFood: {
      type: String,
      enum: ['before_meal', 'after_meal', 'with_meal', 'empty_stomach', 'anytime'],
      default: 'anytime'
    }
  }],
  // Ngày bắt đầu và kết thúc
  startDate: {
    type: Date,
    required: true
  },
  endDate: Date, // Nếu null thì uống lâu dài
  // Cài đặt nhắc nhở
  reminderSettings: {
    enabled: {
      type: Boolean,
      default: true
    },
    advanceMinutes: {
      type: Number,
      default: 15 // Nhắc trước 15 phút
    },
    snoozeMinutes: {
      type: Number,
      default: 10
    },
    maxSnoozeCount: {
      type: Number,
      default: 3
    },
    notificationMethods: [{
      type: String,
      enum: ['app_notification', 'sms', 'call', 'email']
    }]
  },
  // Thông tin bổ sung
  prescribedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // Doctor
  },
  notes: String,
  sideEffects: [String],
  interactions: [String],
  // Trạng thái
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('MedicationReminder', medicationReminderSchema);
