// controllers/supporterScheduling.controller.js
const SupporterScheduling = require("../models/SupporterScheduling");
const SupporterService = require("../models/SupporterServices");

// TODO: thay bằng util thực của bạn
const { encryptField, tryDecryptField } = require("./userController");

// ---- helpers ----
const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const projectUser = "-password -refreshToken -__v";

// Tạo bản sao JSON an toàn để giải mã field nhạy cảm mà không mutate doc
const toPlain = (doc) => JSON.parse(JSON.stringify(doc));

// ---- Controller ----
const schedulingController = {
  /**
   * POST /api/schedulings
   * Body (tuỳ bookingType):
   * - Common: supporter, elderly, createdBy, service, address?, notes?, paymentStatus?
   * - session: scheduleDate (YYYY-MM-DD), scheduleTime ('morning'|'afternoon'|'evening')
   * - day:     scheduleDate (YYYY-MM-DD)
   * - month:   monthStart (YYYY-MM-DD), monthEnd? (auto 30d nếu không gửi), monthSessionsPerDay? (lấy từ service)
   */
  createScheduling: async (req, res) => {
    try {
      const schedulingData = req.body || {};
      const {
        supporter,
        elderly,
        createdBy,
        service,
        address,
        notes,
        paymentStatus,     // 'unpaid'|'paid'|'refunded' (tuỳ FE)
        paymentMethod,     // 'cash'|'bank_transfer' (nếu FE gửi)
        bookingType,       // 'session'|'day'|'month'
        scheduleDate,
        scheduleTime,
        monthStart,
        monthEnd,
        monthSessionsPerDay, // FE có thể không gửi: lấy từ service
      } = schedulingData || {};
      // Bắt các field bắt buộc tối thiểu theo yêu cầu business
      if (!supporter || !elderly || !createdBy || !service || !bookingType) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Thiếu thông tin bắt buộc (supporter, elderly, createdBy, service, bookingType).",
          });
      }
      // Tối thiểu cần địa chỉ để di chuyển (theo form của bạn)
      if (!address) {
        return res
          .status(400)
          .json({ success: false, message: "Thiếu địa chỉ (address)." });
      }

      // Tải service để snapshot giá + cấu hình
      const svc = await SupporterService.findById(service).lean();
      if (!svc || !svc.isActive) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Dịch vụ không tồn tại hoặc đang tắt.",
          });
      }

      // Tính priceAtBooking + chuẩn bị payload theo bookingType
      let priceAtBooking = 0;
      const serviceSnapshot = {
        name: svc.name,
        bySession: {
          morning: svc?.bySession?.morning ?? 0,
          afternoon: svc?.bySession?.afternoon ?? 0,
          evening: svc?.bySession?.evening ?? 0,
        },
        byDay: { dailyFee: svc?.byDay?.dailyFee ?? 0 },
        byMonth: {
          monthlyFee: svc?.byMonth?.monthlyFee ?? 0,
          sessionsPerDay: Array.isArray(svc?.byMonth?.sessionsPerDay)
            ? [...svc.byMonth.sessionsPerDay]
            : [],
        },
      };

      const basePayload = {
        supporter,
        elderly,
        createdBy,
        service,
        notes: notes || "",
        paymentStatus: paymentStatus || "unpaid",
        paymentMethod: paymentMethod || "cash",
        address: encryptField(address.trim()),
        bookingType,
        serviceSnapshot,
      };

      if (bookingType === "session") {
        if (!scheduleDate || !scheduleTime) {
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Thiếu scheduleDate hoặc scheduleTime cho gói theo buổi.",
            });
        }
        // snapshot giá
        priceAtBooking =
          scheduleTime === "morning"
            ? serviceSnapshot.bySession.morning
            : scheduleTime === "afternoon"
            ? serviceSnapshot.bySession.afternoon
            : serviceSnapshot.bySession.evening;

        basePayload.scheduleDate = scheduleDate;
        basePayload.scheduleTime = scheduleTime;
        basePayload.priceAtBooking = priceAtBooking;
      } else if (bookingType === "day") {
        if (!scheduleDate) {
          return res
            .status(400)
            .json({
              success: false,
              message: "Thiếu scheduleDate cho gói theo ngày.",
            });
        }
        priceAtBooking = serviceSnapshot.byDay.dailyFee || 0;

        basePayload.scheduleDate = scheduleDate;
        basePayload.priceAtBooking = priceAtBooking;
      } else if (bookingType === "month") {
        if (!monthStart) {
          return res
            .status(400)
            .json({
              success: false,
              message: "Thiếu monthStart cho gói theo tháng.",
            });
        }
        // Nếu FE không gửi monthEnd → auto 30 ngày (start + 29)
        const _monthStart = new Date(monthStart);
        const _monthEnd = monthEnd
          ? new Date(monthEnd)
          : addDays(_monthStart, 29);

        // Buổi áp dụng mỗi ngày: nếu FE không gửi, lấy từ service
        const sessionsDaily =
          Array.isArray(monthSessionsPerDay) && monthSessionsPerDay.length > 0
            ? monthSessionsPerDay
            : serviceSnapshot.byMonth.sessionsPerDay;

        basePayload.monthStart = _monthStart;
        basePayload.monthEnd = _monthEnd;
        basePayload.monthSessionsPerDay = sessionsDaily;

        priceAtBooking = serviceSnapshot.byMonth.monthlyFee || 0;
        basePayload.priceAtBooking = priceAtBooking;
      } else {
        return res
          .status(400)
          .json({ success: false, message: "bookingType không hợp lệ." });
      }

      const created = await SupporterScheduling.create(basePayload);

      // Trả bản sao đã giải mã address để FE hiển thị
      const plain = toPlain(created);
      if (plain.address) {
        plain.address = tryDecryptField(plain.address);
      }

      return res
        .status(201)
        .json({ success: true, message: "Đặt lịch thành công", data: plain });
    } catch (error) {
      console.error("Error creating scheduling:", error);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đặt lịch thất bại",
          error: error?.message || error,
        });
    }
  },

  /**
   * GET /api/schedulings/by-user
   * Query: userId, includeCanceled?=false, page=1, limit=20
   * -> Lịch của elderly (người được hỗ trợ)
   */
  getSchedulingsByUserId: async (req, res) => {
    try {
      const {
        userId,
        includeCanceled = "false",
        page = 1,
        limit = 20,
      } = req.body || {};

      console.log("userId:", userId);
      
      if (!userId)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu userId." });

      const skip = (Number(page) - 1) * Number(limit);
      const query = { elderly: userId };
      if (includeCanceled !== "true") {
        query.status = { $ne: "canceled" };
      }

      const [items, total] = await Promise.all([
        SupporterScheduling.find(query)
          .skip(skip)
          .limit(Number(limit))
          .populate("supporter", projectUser)
          .populate("elderly", projectUser)
          .populate("createdBy", projectUser)
          .lean(),
        SupporterScheduling.countDocuments(query),
      ]);

      // giải mã address cho từng item (nếu cần hiển thị)
      const data = items.map((it) => ({
        ...it,
        address: it.address ? tryDecryptField(it.address) : "",
      }));

      console.log(data);
      
      return res.status(200).json({
        success: true,
        message: "Lấy danh sách đặt lịch thành công",
        data,
        pagination: { page: Number(page), limit: Number(limit), total },
      });
    } catch (error) {
      console.error("Error fetching schedulings by user:", error);
      return res
        .status(500)
        .json({
          success: false,
          message: "Lấy danh sách đặt lịch thất bại",
          error: error?.message || error,
        });
    }
  },

  /**
   * GET /api/schedulings/by-supporter
   * Query: userId, includeCanceled?=false, page=1, limit=20
   * -> Lịch của supporter
   */
  getSchedulingsBySupporterId: async (req, res) => {
    try {
      const {
        userId,
        includeCanceled = "false",
        page = 1,
        limit = 20,
      } = req.query || {};
      if (!userId)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu userId." });

      const skip = (Number(page) - 1) * Number(limit);
      const query = { supporter: userId };
      if (includeCanceled !== "true") {
        query.status = { $ne: "canceled" };
      }

      const [items, total] = await Promise.all([
        SupporterScheduling.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .populate("supporter", projectUser)
          .populate("elderly", projectUser)
          .populate("createdBy", projectUser)
          .lean(),
        SupporterScheduling.countDocuments(query),
      ]);

      const data = items.map((it) => ({
        ...it,
        address: it.address ? tryDecryptField(it.address) : "",
      }));

      return res.status(200).json({
        success: true,
        message: "Lấy danh sách đặt lịch thành công",
        data,
        pagination: { page: Number(page), limit: Number(limit), total },
      });
    } catch (error) {
      console.error("Error fetching schedulings by supporter:", error);
      return res
        .status(500)
        .json({
          success: false,
          message: "Lấy danh sách đặt lịch thất bại",
          error: error?.message || error,
        });
    }
  },

  /**
   * GET /api/schedulings/:id
   */
  getSchedulingById: async (req, res) => {
    try {
      const schedulingId = req.params.id;
      const scheduling = await SupporterScheduling.findById(schedulingId)
        .populate("supporter", projectUser)
        .populate("elderly", projectUser)
        .populate("createdBy", projectUser)
        .lean();

      if (!scheduling) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy lịch hỗ trợ" });
      }

      // giải mã address
      const data = {
        ...scheduling,
        address: scheduling.address ? tryDecryptField(scheduling.address) : "",
      };

      return res
        .status(200)
        .json({
          success: true,
          message: "Lấy chi tiết lịch hỗ trợ thành công",
          data,
        });
    } catch (error) {
      console.error("Error fetching scheduling by id:", error);
      return res
        .status(500)
        .json({
          success: false,
          message: "Lấy chi tiết lịch hỗ trợ thất bại",
          error: error?.message || error,
        });
    }
  },

  /**
   * PATCH /api/schedulings/:id/status
   * Body: { status }
   */
  updateSchedulingStatus: async (req, res) => {
    try {
      const schedulingId = req.params.id;
      const { status } = req.body;
      if (!status)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu status." });

      const scheduling = await SupporterScheduling.findById(schedulingId);
      if (!scheduling) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy lịch hỗ trợ" });
      }

      scheduling.status = status;
      await scheduling.save();

      const plain = toPlain(scheduling);
      if (plain.address) plain.address = tryDecryptField(plain.address);

      return res
        .status(200)
        .json({
          success: true,
          message: "Cập nhật trạng thái lịch hỗ trợ thành công",
          data: plain,
        });
    } catch (error) {
      console.error("Error updating scheduling status:", error);
      return res
        .status(500)
        .json({
          success: false,
          message: "Cập nhật trạng thái lịch hỗ trợ thất bại",
          error: error?.message || error,
        });
    }
  },

  /**
   * POST /api/schedulings/check-all-completed-or-canceled
   * Body: { supporterId, elderlyId }
   * Trả về true nếu tất cả lịch giữa 2 bên đều 'completed' hoặc 'canceled'
   */
  checkAllCompletedOrCanceled: async (req, res) => {
    try {
      const { supporterId, elderlyId } = req.body || {};
      if (!supporterId || !elderlyId) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Thiếu supporterId hoặc elderlyId.",
          });
      }

      const schedulings = await SupporterScheduling.find({
        supporter: supporterId,
        elderly: elderlyId,
      })
        .select("status")
        .lean();

      const allCompletedOrCanceled = schedulings.every(
        (s) => s.status === "completed" || s.status === "canceled"
      );

      return res.status(200).json({
        success: true,
        message: "Kiểm tra lịch thành công",
        data: allCompletedOrCanceled,
      });
    } catch (error) {
      console.error("Error checking all completed or canceled:", error);
      return res
        .status(500)
        .json({
          success: false,
          message: "Kiểm tra lịch thất bại",
          error: error?.message || error,
        });
    }
  },

  // Lấy tất cả danh sách đặt lịch dành cho mục đích admin (có phân trang, lọc, tìm kiếm)
  getAllSchedulingsForAdmin: async (req, res) => {
    try {
      const { page = 1, limit = 20 } = req.query || {};

      const skip = (Number(page) - 1) * Number(limit);
      const [items, total] = await Promise.all([
        SupporterScheduling.find()
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .populate("supporter", projectUser)
          .populate("elderly", projectUser)
          .populate("createdBy", projectUser)
          .lean(),
        SupporterScheduling.countDocuments(),
      ]);
      const data = items.map((it) => ({
        ...it,
        address: it.address ? tryDecryptField(it.address) : "",
      }));
      return res.status(200).json({
        success: true,
        message: "Lấy danh sách đặt lịch thành công",
        data,
        pagination: { page: Number(page), limit: Number(limit), total },
      });
    } catch (error) {
      console.error("Error fetching all schedulings for admin:", error);
      return res
        .status(500)
        .json({
          success: false,
          message: "Lấy danh sách đặt lịch thất bại",
          error: error?.message || error,
        });
    }
  },

};

module.exports = schedulingController;
