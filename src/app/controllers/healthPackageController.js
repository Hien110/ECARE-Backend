const SupporterScheduling = require('../models/SupporterScheduling');
const HealthPackage = require('../models/HealthPackage');
const mongoose = require('mongoose');
const RegistrationHealthPackage = require('../models/RegistrationHealthPackage');

// Helper kiểm tra ObjectId hợp lệ
const isValidObjectId = (v) => typeof v === "string" && /^[a-fA-F0-9]{24}$/.test(v);
const healthPackageController = {
 // Tạo mới gói khám
  createHealthPackage: async (req, res) => {
    try {
      const { title, durations, service, description, isActive } = req.body;
      if (!title || !description || !Array.isArray(service) || service.length === 0 || !Array.isArray(durations) || durations.length === 0) {
        return res.status(400).json({ success: false, message: "Thiếu thông tin bắt buộc" });
      }
      // Kiểm tra durations
      for (const f of durations) {
        if (typeof f.days !== 'number' || f.days < 1 || typeof f.fee !== 'number' || f.fee < 0 || typeof f.isOption !== 'boolean') {
          return res.status(400).json({ success: false, message: "durations phải hợp lệ (days > 0, fee >= 0, isOption boolean)" });
        }
      }
      const healthPackage = await HealthPackage.create({
        title,
        durations,
        service,
        description,
        isActive
      });
      return res.status(201).json({ success: true, data: healthPackage });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Lỗi khi tạo gói khám" });
    }
  },
  // Lấy danh sách các gói khám mà beneficiary là userId
  listRegisteredPackagesByBeneficiary: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isValidObjectId(userId)) {
        return res.status(400).json({ success: false, message: "ID không hợp lệ" });
      }
      // Lấy các đăng ký mà beneficiary là userId, populate thông tin gói khám và người đăng ký
      const registrations = await RegistrationHealthPackage.find({ beneficiary: userId })
        .populate('packageRef')
        .populate('registrant')
        .populate('doctor')
        .populate('durationDays')
        .sort({ registeredAt: -1 });
      // Trả về danh sách các gói khám đã đăng ký
      return res.status(200).json({ success: true, data: registrations });
    } catch (err) {
      console.error("[listRegisteredPackagesByBeneficiary] Error:", err);
      return res.status(500).json({ success: false, message: "Lỗi khi lấy danh sách gói khám đã đăng ký" });
    }
  },

  // Lấy danh sách tất cả gói khám
   listHealthPackage: async (req, res) => {
    try {
      // Tìm các gói khám chưa có đăng ký nào
      // Sử dụng đúng trường packageRef để lấy các gói đã đăng ký
      const registeredIds = await RegistrationHealthPackage.distinct('packageRef');
      const packages = await HealthPackage.find({ _id: { $nin: registeredIds } }).sort({ createdAt: -1 });
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
      if (updateData.durations) {
        if (!Array.isArray(updateData.durations) || updateData.durations.length === 0) {
          return res.status(400).json({ success: false, message: "durations phải là mảng hợp lệ" });
        }
        for (const f of updateData.durations) {
          if (typeof f.days !== 'number' || f.days < 1 || typeof f.fee !== 'number' || f.fee < 0 || typeof f.isOption !== 'boolean') {
            return res.status(400).json({ success: false, message: "durations phải hợp lệ (days > 0, fee >= 0, isOption boolean)" });
          }
        }
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
    // Lấy danh sách các gói khám đã đăng ký bởi người đăng ký (registrant)
    listRegisteredPackagesByRegistrant: async (req, res) => {
      try {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) {
          return res.status(400).json({ success: false, message: "ID không hợp lệ" });
        }
        // Ép kiểu userId sang ObjectId để đảm bảo truy vấn chính xác
        const objectId = new mongoose.Types.ObjectId(userId);
        // Debug: log tất cả các bản ghi có trường registrant
        const allWithRegistrant = await RegistrationHealthPackage.find({ registrant: { $exists: true } }).lean();

        const registrations = await RegistrationHealthPackage.find({ registrant: objectId })
          .populate('packageRef')
          .populate('registrant')
          .sort({ registeredAt: -1 });

        return res.status(200).json({ success: true, data: registrations });
      } catch (err) {
        console.error("[listRegisteredPackagesByRegistrant] Error:", err);
        return res.status(500).json({ success: false, message: "Lỗi khi lấy danh sách gói khám đã đăng ký" });
      }
    },
     // Lấy danh sách lịch hẹn với supporter theo người già (elderly)
  listSupporterSchedulesByElderly: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isValidObjectId(userId)) {
        return res.status(400).json({ success: false, message: "ID không hợp lệ" });
      }
      // Lấy tất cả lịch hẹn mà elderly là userId, populate supporter, service
      const schedules = await SupporterScheduling.find({ elderly: userId })
        .populate('supporter')
        .populate('service')
        .sort({ scheduleDate: -1, createdAt: -1 });
      return res.status(200).json({ success: true, data: schedules });
    } catch (err) {
      console.error("[listSupporterSchedulesByElderly] Error:", err);
      return res.status(500).json({ success: false, message: "Lỗi khi lấy danh sách lịch hẹn" });
    }
  },
}
module.exports = healthPackageController;
