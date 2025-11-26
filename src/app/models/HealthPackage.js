const mongoose = require('mongoose');


const HealthPackageSchema = new mongoose.Schema({
  // Tên gói khám, ví dụ "Gói Khám Tổng Quát 1 Tháng"
  title: { type: String, required: true, trim: true },


  // Các mốc thời hạn cố định
  durationOptions: {
    type: [{
      type: Number,
      enum: [30, 90, 180, 270, 365], // 1 tháng, 3 tháng, 6 tháng, 9 tháng, 1 năm
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
  // Giá riêng cho customDuration nếu có
  customDurationPrice: { type: Number, min: 0 },
  // Mảng phí cho các mốc cố định
  fees: {
    type: [
      {
        days: { type: Number, required: true, enum: [30, 90, 180, 270, 365] },
        fee: { type: Number, required: true, min: 0 }
      }
    ],
    required: true,
    validate: {
      validator: function(arr) {
        // Đảm bảo không trùng lặp số ngày
        return Array.isArray(arr) && new Set(arr.map(f => f.days)).size === arr.length;
      },
      message: "fees có phần tử trùng lặp số ngày."
    }
  },

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