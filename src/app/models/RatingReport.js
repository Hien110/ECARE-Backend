const mongoose = require('mongoose');

const ratingReportSchema = new mongoose.Schema({
  // Rating bị báo cáo
  rating: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rating',
    required: true
  },
  // Người báo cáo
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Lý do báo cáo
  reason: {
    type: String,
    enum: ['inappropriate_content', 'fake_review', 'spam', 'offensive_language', 'other'],
    required: true
  },
  // Mô tả chi tiết
  description: {
    type: String,
    maxlength: 500
  },
  // Trạng thái báo cáo
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'resolved', 'dismissed'],
    default: 'pending'
  },
  // Thời gian báo cáo
  reportedAt: {
    type: Date,
    default: Date.now
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('RatingReport', ratingReportSchema);