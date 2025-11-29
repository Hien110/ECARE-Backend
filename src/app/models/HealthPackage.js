const mongoose = require('mongoose');


const HealthPackageSchema = new mongoose.Schema({
  // Tên gói khám, ví dụ "Gói Khám Tổng Quát 1 Tháng"
  title: { type: String, required: true, trim: true },


  // Gộp tất cả các mốc thời hạn vào một mảng durations
  durations: {
    type: [
      {
        days: { type: Number, min: 1, required: true },
        fee: { type: Number, min: 0, required: true },
        isOption: { type: Boolean, default: false }, // true: mốc cố định, false: tuỳ ý
      }
    ],
    required: true,
    validate: {
      validator: function(arr) {
        // Đảm bảo không trùng lặp số ngày
        return Array.isArray(arr) && new Set(arr.map(f => f.days)).size === arr.length;
      },
      message: "durations có phần tử trùng lặp số ngày."
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