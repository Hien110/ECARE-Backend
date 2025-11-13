const mongoose = require('mongoose');

const consultationSchema = new mongoose.Schema({
  elderly: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  bookedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true // Có thể là elderly hoặc family
  },
  consultationType: {
    type: String,
    enum: ['online', 'offline'],
    required: true
  },
  specialization: {
    type: String,
    required: true
  },
  // Triệu chứng và lý do khám
  symptoms: [{
    symptom: String,
    severity: {
      type: String,
      enum: ['mild', 'moderate', 'severe']
    },
    duration: String,
    description: String
  }],
  reason: {
    type: String,
    required: true
  },
  // Lịch hẹn
  scheduledDate: {
    type: Date,
    required: true
  },
  timeSlot: {
    start: String,
    end: String
  },
  // Địa điểm (cho offline)
  location: {
    address: String,
  },
  // Trạng thái
  status: {
    type: String,
    enum: ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'],
    default: 'scheduled'
  },
  // Kết quả tư vấn
  consultation: {
    diagnosis: String,
    prescription: [{
      medicationName: String,
      dosage: String,
      frequency: String,
      duration: String,
      instructions: String
    }],
    doctorNotes: String
  },
  // File đính kèm (kết quả xét nghiệm, hình ảnh, etc.)
  attachments: [{
    fileName: String,
    fileUrl: String,
    fileType: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: Date
  }],
  // Thanh toán
  pricing: {
    consultationFee: {
      type: Number,
      required: true
    },
    totalAmount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: 'VND'
    }
  },
  payment: {
    method: {
      type: String,
      enum: ['vnpay', 'momo', 'bank_transfer', 'cash']
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    transactionId: String,
    paidAt: Date
  },
  // Thời gian
  bookedAt: {
    type: Date,
    default: Date.now
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('Consultation', consultationSchema);
