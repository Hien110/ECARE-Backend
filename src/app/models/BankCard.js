const mongoose = require('mongoose');

const bankCardSchema = new mongoose.Schema({
  // User sở hữu thẻ ngân hàng
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // Mỗi user chỉ có một thẻ ngân hàng chính
  },
  // Số thẻ
  cardNumber: {
    type: String,
    required: true,
    match: /^\d{12,19}$/, // 12-19 chữ số
    unique: true
  },
  // Tên chủ thẻ
  cardHolderName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  // Tháng hết hạn
  expiryMonth: {
    type: Number,
    min: 1,
    max: 12,
    required: true,
  },
  // Năm hết hạn
  expiryYear: {
    type: Number,
    min: new Date().getFullYear(),
    required: true,
    validate: {
      validator: function(value) {
        // Kiểm tra năm không quá xa trong tương lai (tối đa 20 năm)
        return value <= new Date().getFullYear() + 20;
      },
      message: 'Năm hết hạn không hợp lệ'
    }
  },
  // Ngân hàng phát hành
  bankName: {
    type: String,
    trim: true,
    maxlength: 100
  },
  // Loại thẻ
  cardType: {
    type: String,
    enum: ['visa', 'mastercard', 'jcb', 'amex', 'domestic'],
    default: 'domestic'
  },
  // Trạng thái thẻ
  status: {
    type: String,
    enum: ['active', 'inactive', 'expired', 'blocked'],
    default: 'active'
  },
  // Thẻ mặc định cho thanh toán
  isDefault: {
    type: Boolean,
    default: true
  },
  // Thời gian thêm thẻ
  addedAt: {
    type: Date,
    default: Date.now
  },
  // Lần cuối sử dụng
  lastUsedAt: Date
}, {
  timestamps: true
});

module.exports = mongoose.model('BankCard', bankCardSchema);