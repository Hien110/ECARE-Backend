const mongoose = require('mongoose');

const medicationLogSchema = new mongoose.Schema({
  elderly: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  medicationReminder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MedicationReminder',
    required: true
  },
  medicationName: {
    type: String,
    required: true
  },
  scheduledTime: {
    type: Date,
    required: true
  },
  actualTime: Date,
  status: {
    type: String,
    enum: ['taken', 'missed', 'delayed', 'skipped'],
    required: true
  },
  dosageTaken: String,
  notes: String,
  // Nếu bỏ lỡ hoặc trì hoãn
  missedReason: String,
  delayMinutes: Number,
  // Người xác nhận (có thể là chính elderly hoặc supporter)
  confirmedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  confirmationMethod: {
    type: String,
    enum: ['self_report', 'supporter_confirm', 'family_confirm', 'automatic'],
    default: 'self_report'
  },
  // Tác dụng phụ nếu có
  sideEffects: [{
    effect: String,
    severity: {
      type: String,
      enum: ['mild', 'moderate', 'severe']
    }
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('MedicationLog', medicationLogSchema);
