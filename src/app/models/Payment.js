const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  serviceType: {
    type: String,
    enum: ['support', 'consultation'],
    required: true
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'serviceModel'
  },
  serviceModel: {
    type: String,
    enum: ['SupportRequest', 'Consultation'],
    required: true
  },
  // Thông tin thanh toán
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'VND'
  },
  paymentMethod: {
    type: String,
    enum: ['vnpay', 'momo', 'bank_transfer', 'cash', 'wallet'],
    required: true
  },
  // Thông tin giao dịch
  transactionId: {
    type: String,
    unique: true,
    required: true
  },
  externalTransactionId: String, // ID từ VNPay, MoMo, etc.
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded', 'partially_refunded'],
    default: 'pending'
  },
  // Chi tiết thanh toán
  paymentDetails: {
    bankCode: String,
    cardType: String,
    orderInfo: String,
    // Cho VNPay
    vnpayData: {
      vnp_TmnCode: String,
      vnp_OrderInfo: String,
      vnp_ResponseCode: String,
      vnp_TransactionStatus: String,
      vnp_BankCode: String,
      vnp_PayDate: String
    },
    // Cho MoMo
    momoData: {
      partnerCode: String,
      orderId: String,
      requestId: String,
      resultCode: Number,
      message: String,
      responseTime: String
    }
  },
  // Phí và chiết khấu
  fees: {
    serviceFee: {
      type: Number,
      default: 0
    },
    platformFee: {
      type: Number,
      default: 0
    },
    paymentGatewayFee: {
      type: Number,
      default: 0
    },
    discount: {
      type: Number,
      default: 0
    },
    couponCode: String
  },
  // Tổng kết
  totalAmount: {
    type: Number,
    required: true
  },
  netAmount: Number, // Số tiền thực tế nhận được sau phí
  // Thông tin refund
  refund: {
    amount: Number,
    reason: String,
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    requestedAt: Date,
    processedAt: Date,
    refundTransactionId: String,
    status: {
      type: String,
      enum: ['requested', 'approved', 'processing', 'completed', 'rejected']
    }
  },
  // Thời gian
  initiatedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  failedAt: Date,
  cancelledAt: Date,
  // Metadata
  metadata: {
    userAgent: String,
    ipAddress: String,
    deviceInfo: String
  },
  // Ghi chú
  notes: String,
  adminNotes: String
}, {
  timestamps: true
});

module.exports = mongoose.model('Payment', paymentSchema);
