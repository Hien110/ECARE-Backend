const HealthPackage = require('../models/HealthPackage');
const mongoose = require('mongoose');

// Helper kiểm tra ObjectId hợp lệ
const isValidObjectId = (v) => typeof v === "string" && /^[a-fA-F0-9]{24}$/.test(v);
const healthPackageController = {
 // Tạo mới gói khám
   createHealthPackage: async (req, res) => {
    try {
      const { title, durationOptions, customDuration, price, service, description, isActive } = req.body;
      if (!title || !description || !price || !Array.isArray(service) || service.length === 0 || !Array.isArray(durationOptions) || durationOptions.length === 0) {
        return res.status(400).json({ success: false, message: "Thiếu thông tin bắt buộc" });
      }
      // Kiểm tra customDuration nếu có
      if (customDuration && (typeof customDuration !== 'number' || customDuration < 1)) {
        return res.status(400).json({ success: false, message: "customDuration phải là số ngày hợp lệ" });
      }
      const healthPackage = await HealthPackage.create({
        title,
        durationOptions,
        customDuration,
        price,
        service,
        description,
        isActive
      });
      return res.status(201).json({ success: true, data: healthPackage });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Lỗi khi tạo gói khám" });
    }
  },

  // Lấy danh sách tất cả gói khám
   listHealthPackage: async (req, res) => {
    try {
      const packages = await HealthPackage.find().sort({ createdAt: -1 });
      return res.status(200).json({ success: true, data: packages });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Lỗi khi lấy danh sách gói khám" });
    }
  },

  // Lấy chi tiết 1 gói khám
  detailHealthPackage: async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ success: false, message: "ID không hợp lệ" });
      }
      const healthPackage = await HealthPackage.findById(id);
      if (!healthPackage) {
        return res.status(404).json({ success: false, message: "Không tìm thấy gói khám" });
      }
      return res.status(200).json({ success: true, data: healthPackage });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Lỗi khi lấy chi tiết gói khám" });
    }
  },

  // Cập nhật gói khám
   updateHealthPackage: async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ success: false, message: "ID không hợp lệ" });
      }
      const updateData = req.body;
      // Nếu có customDuration thì kiểm tra hợp lệ
      if (updateData.customDuration && (typeof updateData.customDuration !== 'number' || updateData.customDuration < 1)) {
        return res.status(400).json({ success: false, message: "customDuration phải là số ngày hợp lệ" });
      }
      // Nếu có durationOptions thì kiểm tra hợp lệ
      if (updateData.durationOptions && (!Array.isArray(updateData.durationOptions) || updateData.durationOptions.length === 0)) {
        return res.status(400).json({ success: false, message: "durationOptions phải là mảng số ngày hợp lệ" });
      }
      const updated = await HealthPackage.findByIdAndUpdate(id, updateData, { new: true });
      if (!updated) {
        return res.status(404).json({ success: false, message: "Không tìm thấy gói khám" });
      }
      return res.status(200).json({ success: true, data: updated });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Lỗi khi cập nhật gói khám" });
    }
  },

  // Xóa gói khám
   removeHealthPackage: async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ success: false, message: "ID không hợp lệ" });
      }
      const deleted = await HealthPackage.findByIdAndDelete(id);
      if (!deleted) {
        return res.status(404).json({ success: false, message: "Không tìm thấy gói khám" });
      }
      return res.status(200).json({ success: true, message: "Đã xóa gói khám" });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Lỗi khi xóa gói khám" });
    }
  },
}
module.exports = healthPackageController;
