const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  }],
  // Cài đặt chat
  settings: {
    allowEmojis: {
      type: Boolean,
      default: true
    },
    allowFileSharing: {
      type: Boolean,
      default: true
    },
    allowVoiceMessages: {
      type: Boolean,
      default: true
    },
    autoTranslate: {
      type: Boolean,
      default: false
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});


module.exports = mongoose.model('Conversation', conversationSchema);
