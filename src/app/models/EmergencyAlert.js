const mongoose = require('mongoose');

const emergencyAlertSchema = new mongoose.Schema({
  elderly: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  alertType: {
    type: String,
    enum: ['sos_button', 'health_emergency', 'fall_detection', 'medication_missed', 'unusual_activity'],
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'high'
  },
  location: {
    address: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    accuracy: Number, // Độ chính xác GPS (mét)
    timestamp: Date
  },
  // Thông tin chi tiết
  details: {
    description: String,
    healthData: {
      heartRate: Number,
      bloodPressure: {
        systolic: Number,
        diastolic: Number
      },
      symptoms: [String]
    },
    deviceInfo: {
      deviceId: String,
      batteryLevel: Number,
      signalStrength: Number
    }
  },
  // Trạng thái xử lý
  status: {
    type: String,
    enum: ['active', 'acknowledged', 'resolved', 'false_alarm'],
    default: 'active'
  },
  acknowledgedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  acknowledgedAt: Date,
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  resolvedAt: Date,
  resolution: String,
  // Thông tin cuộc gọi khẩn cấp
  emergencyCalls: [{
    contactCalled: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    callStarted: Date,
    callEnded: Date,
    callDuration: Number,
    callStatus: {
      type: String,
      enum: ['answered', 'no_answer', 'busy', 'failed']
    }
  }],
  // Ghi chú từ responder
  responderNotes: [{
    responder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    note: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('EmergencyAlert', emergencyAlertSchema);
