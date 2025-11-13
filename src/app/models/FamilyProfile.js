const mongoose = require('mongoose');

const familyProfileSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  // Cài đặt thông báo
  notificationSettings: {
    healthAlerts: {
      enabled: {
        type: Boolean,
        default: true
      },
      severity: {
        type: [String],
        enum: ['low', 'medium', 'high', 'critical'],
        default: ['medium', 'high', 'critical']
      }
    }, // Tạm thời chưa dùng đến
    emotionalAlerts: {
      enabled: {
        type: Boolean,
        default: true
      },
      sentimentThreshold: {
        type: String,
        enum: ['all', 'negative_only', 'severe_only'],
        default: 'negative_only'
      }
    },
    emergencyAlerts: {
      enabled: {
        type: Boolean,
        default: true
      },
      immediateCall: {
        type: Boolean,
        default: true // Gọi ngay khi có SOS
      },
      priority: {
        type: Number,
        default: 1 // Thứ tự ưu tiên khi gọi khẩn cấp
      }
    },
    medicationReminders: {
      enabled: {
        type: Boolean,
        default: true // Mặc định không nhận nhắc uống thuốc
      }
    },
    appointmentReminders: {
      enabled: {
        type: Boolean,
        default: true
      },
      advanceHours: {
        type: Number,
        default: 24 // Nhắc trước 24h
      }
    } // Tạm thời chưa dùng đến
  },

  // Cài đặt riêng tư
  privacySettings: {
    shareProfileWithSupporters: {
      type: Boolean,
      default: false
    },
    shareProfileWithDoctors: {
      type: Boolean,
      default: false
    },
    allowDataAnalytics: {
      type: Boolean,
      default: true
    }
  }, // Tạm thời chưa dùng đến
}, {
  timestamps: true
});

module.exports = mongoose.model('FamilyProfile', familyProfileSchema);
