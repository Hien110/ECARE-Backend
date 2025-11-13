const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file', 'voice', 'video', 'emoji', 'system'],
    default: 'text'
  },
  content: {
    text: String,
    fileUrl: String,
    fileName: String,
    fileSize: Number,
    mimeType: String,
    duration: Number, // Cho voice/video messages (giây)
    emoji: String,
    systemMessage: String
  },
  // Cho AI chat
  aiContext: {
    isAiResponse: {
      type: Boolean,
      default: false
    },
    emotionalAnalysis: {
      sentiment: String,
      emotions: [{
        emotion: String,
        confidence: Number
      }],
      moodScore: Number
    },
    responseType: {
      type: String,
      enum: ['empathy', 'advice', 'question', 'support', 'reminder']
    }
  },
  // Trạng thái tin nhắn
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Tin nhắn đã bị xóa
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Tin nhắn đã được chỉnh sửa
  isEdited: {
    type: Boolean,
    default: false
  },
  editHistory: [{
    content: String,
    editedAt: Date
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Message', messageSchema);
