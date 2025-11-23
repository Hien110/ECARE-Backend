const mongoose = require('mongoose');


const HealthPackageSchema = new mongoose.Schema({
  // Tên gói khám, ví dụ "Gói Khám Tổng Quát 1 Tháng"
  title: { type: String, required: true, trim: true },

  // Thời hạn gói khám: chọn từ các mốc cố định hoặc nhập tuỳ ý
  durationOptions: {
    type: [{
      type: Number,
      enum: [30, 90, 180, 270], // 1 tháng, 3 tháng, 6 tháng, 9 tháng (tính theo ngày)
    }],
    default: [30],
    required: true,
    validate: {
      validator: function(arr) {
        // Đảm bảo không trùng lặp
        return Array.isArray(arr) && new Set(arr).size === arr.length;
      },
      message: "durationOptions có phần tử trùng lặp."
    }
  },
  // Nếu muốn nhập số ngày tuỳ ý
  customDuration: { type: Number, min: 1 },

  // Giá mặc định của gói (đơn vị VND). Trường này có thể được ghi đè trong bản đăng ký nếu cần.
  price: { type: Number, required: true, min: 0 },

  // Mô tả chi tiết về gói
  service: [{
    serviceName: { type: String, required: true },
    serviceDescription: { type: String }
  }],
description: {type: String,
  required: true
},

  // Trạng thái kích hoạt của gói (nếu false thì gói không được hiển thị/không bán)
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

HealthPackageSchema.index({ title: 1 });

module.exports = mongoose.model('HealthPackage', HealthPackageSchema);