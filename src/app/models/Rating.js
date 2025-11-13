const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema({
  // Người đánh giá
  reviewer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Người/dịch vụ được đánh giá
  reviewee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Loại đánh giá
  ratingType: {
    type: String,
    enum: ['support_service', 'consultation', 'supporter_profile', 'doctor_profile'],
    required: true
  },
  // Điểm số đánh giá (1-5 sao)
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  // Bình luận
  comment: {
    type: String,
    maxlength: 1000
  },
  status: {
    type: String,
    enum: ['active', 'hidden', 'reported', 'deleted'],
    default: 'active'
  },
  // Thời gian đánh giá
  ratedAt: {
    type: Date,
    default: Date.now
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('Rating', ratingSchema);
