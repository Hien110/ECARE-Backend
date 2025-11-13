const mongoose = require('mongoose');

const supportRequestSchema = new mongoose.Schema({
  elderly: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  supporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true // Có thể là elderly hoặc family
  },
  serviceType: {
    type: String,
    required: true,
    enum: ['basic_care', 'medical_support', 'transportation', 'shopping', 'cleaning', 'cooking', 'companionship', 'other']
  },
  serviceDescription: {
    type: String,
    required: true
  },
  scheduledDate: {
    type: Date,
    required: true
  },
  timeSlot: {
    start: {
      type: String,
      required: true // "07:30"
    },
    end: {
      type: String,
      required: true // "11:30"
    },
    type: {
      type: String,
      enum: ['morning', 'afternoon', 'evening', 'night'],
      required: true
    }
  },
  location: {
    address: {
      type: String,
      required: true
    },
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    specialInstructions: String
  },
  pricing: {
    pricePerSession: {
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
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled'],
    default: 'pending'
  },
  // Ghi chú và yêu cầu đặc biệt
  specialRequirements: String,
  elderlyNotes: String,
  supporterNotes: String,
  // Thời gian quan trọng
  requestedAt: {
    type: Date,
    default: Date.now
  },
  respondedAt: Date,
  startedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  cancellationReason: String,
  // Thanh toán
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
    paidAt: Date,
    refundedAt: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SupportRequest', supportRequestSchema);
