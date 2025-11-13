const mongoose = require('mongoose');

const relationshipSchema = new mongoose.Schema({
  elderly: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  family: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  relationship: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'cancelled'],
    default: 'pending'
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  respondedAt: Date,
  permissions: {
    viewHealthData: {
      type: Boolean,
      default: true
    },
    viewEmotionalData: {
      type: Boolean,
      default: true
    },
    receiveAlerts: {
      type: Boolean,
      default: true
    },
    bookServices: {
      type: Boolean,
      default: false
    },
    emergencyContact: {
      type: Boolean,
      default: true
    },
    accessMedicalRecords: {
      type: Boolean,
      default: false
    }
  }, // Chưa dùng
  // Mức độ ưu tiên
  priority: {
    type: Number,
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('Relationship', relationshipSchema);
