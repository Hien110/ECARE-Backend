const mongoose = require('mongoose');

// SOS notification model to record urgent help requests with address and coordinates
const sosNotificationSchema = new mongoose.Schema({
  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipients: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Fixed type to distinguish from other notifications
  type: {
    type: String,
    enum: ['sos'],
    default: 'sos',
    required: true
  },
  message: {
    type: String
  },
  location: {
    address: String,
    coordinates: {
      latitude: {
        type: Number,
        required: true
      },
      longitude: {
        type: Number,
        required: true
      }
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  // Processing status lifecycle
  status: {
    type: String,
    enum: ['active', 'acknowledged', 'resolved', 'cancelled'],
    default: 'active'
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('SOSNotification', sosNotificationSchema);


