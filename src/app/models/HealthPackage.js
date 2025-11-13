const mongoose = require('mongoose');


const HealthPackageSchema = new mongoose.Schema({
  // Tên gói khám, ví dụ "Gói Khám Tổng Quát 1 Tháng"
  title: { type: String, required: true, trim: true },

  // Thời hạn gói tính theo số ngày (khi đăng ký, đăng ký sẽ tính expires = registeredAt + durationDays)
  durationDays: { type: Number, required: true, default: 30 },

  // Giá mặc định của gói (đơn vị VND). Trường này có thể được ghi đè trong bản đăng ký nếu cần.
  price: { type: Number, required: true, min: 0 },

  // Mô tả chi tiết về gói
  description: [{
    serviceName: { type: String, required: true },
    serviceDescription: { type: String }
  }],


  // Trạng thái kích hoạt của gói (nếu false thì gói không được hiển thị/không bán)
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

HealthPackageSchema.index({ title: 1 });

module.exports = mongoose.model('HealthPackage', HealthPackageSchema);