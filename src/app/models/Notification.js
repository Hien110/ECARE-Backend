const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  type: {
    type: String,
    enum: [
      'medication_reminder',
      'appointment_reminder', 
      'emergency_alert',
      'relationship_request',
      'support_request',
      'consultation_booking',
      'health_alert',
      'mood_check',
      'system_notification',
      'payment_notification',
      'rating_request'
    ],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  // Dữ liệu bổ sung cho từng loại notification
  data: {
    // Cho medication reminder
    medicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MedicationReminder'
    },
    // Cho appointment
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId
    },
    appointmentType: String, // 'support' hoặc 'consultation'
    // Cho emergency
    emergencyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmergencyAlert'
    },
    // Cho relationship
    relationshipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Relationship'
    },
    // Cho payment
    transactionId: String,
    amount: Number,
    // Generic action data
    actionUrl: String,
    actionText: String
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  // Trạng thái
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read', 'acted_upon'],
    default: 'sent'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  // Phương thức gửi
  deliveryMethods: [{
    method: {
      type: String,
      enum: ['push_notification', 'sms', 'email', 'in_app']
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'failed']
    },
    sentAt: Date,
    deliveredAt: Date,
    failureReason: String
  }],
  // Lập lịch gửi
  scheduledFor: Date,
  // Hết hạn
  expiresAt: Date,
  // Nhóm notification (để gộp các notification cùng loại)
  groupKey: String
}, {
  timestamps: true
});

module.exports = mongoose.model('Notification', notificationSchema);
