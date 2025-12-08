// controllers/supporterScheduling.controller.js
const SupporterScheduling = require("../models/SupporterScheduling");
const SupporterService = require("../models/SupporterServices");
const User = require("../models/User");
const Relationship = require("../models/Relationship");
const Conversation = require("../models/Conversation");

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
   * Body: {
   *   supporter, elderly, registrant, service, startDate, endDate,
   *   paymentMethod?, paymentStatus?, notes?, address?, price?
   * }
   */
  createScheduling: async (req, res) => {
    const TAG = "[SupporterScheduling][create]";
    try {
      const schedulingData = req.body || {};
      const {
        supporter,
        elderly,
        registrant,
        service,
        startDate,
        endDate,
        paymentMethod = "cash",
        paymentStatus = "unpaid",
        notes = "",
        address = "",
        price,
      } = schedulingData || {};

      // Validation các field bắt buộc
      if (!supporter || !elderly || !service || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "Thiếu thông tin bắt buộc (supporter, elderly, service, startDate, endDate)",
        });
      }

      // Validate dates
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Ngày không hợp lệ",
        });
      }

      if (end < start) {
        return res.status(400).json({
          success: false,
          message: "Ngày kết thúc phải sau ngày bắt đầu",
        });
      }

      // Verify service exists
      const svc = await SupporterService.findById(service).lean();
      if (!svc) {
        return res.status(400).json({
          success: false,
          message: "Dịch vụ không tồn tại",
        });
      }

      // Create scheduling
      const payload = {
        supporter,
        elderly,
        registrant: registrant || supporter,
        service,
        startDate: start,
        endDate: end,
        paymentMethod,
        paymentStatus,
        notes: notes?.trim() || "",
        price: price || svc.price || 0,
        status: "pending",
      };

      if (address?.trim()) {
        payload.address = encryptField(address.trim());
      }

      const created = await SupporterScheduling.create(payload);
      const plain = toPlain(created);

      return res.status(201).json({
        success: true,
        message: "Tạo lịch hỗ trợ thành công",
        data: plain,
      });
    } catch (error) {
      console.error(`${TAG} Error:`, error);
      return res.status(500).json({
        success: false,
        message: "Tạo lịch hỗ trợ thất bại",
        error: error?.message || error,
      });
    }
  },

  /**
   * GET /api/schedulings/by-user
   * Query: userId, page=1, limit=20
   * -> Lịch của elderly (người được hỗ trợ)
   */
  getSchedulingsByUserId: async (req, res) => {
    try {
      const {
        userId,
        page = 1,
        limit = 20,
      } = req.body || {};

      if (!userId)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu userId." });

      const skip = (Number(page) - 1) * Number(limit);
      const query = { elderly: userId };
      // if (includeCanceled !== "true") {
      //   query.status = { $ne: "canceled" };
      // }

      const [items, total] = await Promise.all([
        SupporterScheduling.find(query)
          .skip(skip)
          .limit(Number(limit))
          .populate("supporter", projectUser)
          .populate("elderly", projectUser)
          .populate("registrant", projectUser)
          .populate("service", "name price numberOfDays")
          .lean(),
        SupporterScheduling.countDocuments(query),
      ]);

      // Giải mã address và các trường mã hóa khác nếu cần
      const data = items.map((it) => {
        const addressDecrypted = it.address ? tryDecryptField(it.address) : "";
        const phoneNumberSupporter = it.supporter?.phoneNumberEnc
          ? tryDecryptAny(it.supporter.phoneNumberEnc)
          : "";
        const emailSupporter = it.supporter?.emailEnc
          ? tryDecryptAny(it.supporter.emailEnc)
          : "";
        const phoneNumberElderly = it.elderly?.phoneNumberEnc
          ? tryDecryptAny(it.elderly.phoneNumberEnc)
          : "";
        const emailElderly = it.elderly?.emailEnc
          ? tryDecryptAny(it.elderly.emailEnc)
          : "";

        return {
          ...it,
          address: addressDecrypted,
          phoneNumberSupporter,
          emailSupporter,
          phoneNumberElderly,
          emailElderly,
        };
      });

      return res.status(200).json({
        success: true,
        message: "Lấy danh sách đặt lịch thành công",
        data,
        pagination: { page: Number(page), limit: Number(limit), total },
      });
    } catch (error) {
      console.error("Error fetching schedulings by user:", error);
      return res.status(500).json({
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
        page = 1,
        limit = 20,
      } = req.body || {};

      if (!userId)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu userId." });

      const skip = (Number(page) - 1) * Number(limit);
      const query = { supporter: userId };

      const [items, total] = await Promise.all([
        SupporterScheduling.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .populate("supporter", projectUser)
          .populate("elderly", projectUser)
          .populate("registrant", projectUser)
          .populate("service", "name price numberOfDays")
          .lean(),
        SupporterScheduling.countDocuments(query),
      ]);

      // Giải mã address và các trường mã hóa khác nếu cần
      const data = items.map((it) => {
        const addressDecrypted = it.address ? tryDecryptField(it.address) : "";
        const phoneNumberSupporter = it.supporter?.phoneNumberEnc
          ? tryDecryptAny(it.supporter.phoneNumberEnc)
          : "";
        const emailSupporter = it.supporter?.emailEnc
          ? tryDecryptAny(it.supporter.emailEnc)
          : "";
        const phoneNumberElderly = it.elderly?.phoneNumberEnc
          ? tryDecryptAny(it.elderly.phoneNumberEnc)
          : "";
        const emailElderly = it.elderly?.emailEnc
          ? tryDecryptAny(it.elderly.emailEnc)
          : "";

        return {
          ...it,
          address: addressDecrypted,
          phoneNumberSupporter,
          emailSupporter,
          phoneNumberElderly,
          emailElderly,
        };
      });

      return res.status(200).json({
        success: true,
        message: "Lấy danh sách đặt lịch thành công",
        data,
        pagination: { page: Number(page), limit: Number(limit), total },
      });
    } catch (error) {
      console.error("Error fetching schedulings by supporter:", error);
      return res.status(500).json({
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

      // Populate supporter, elderly, createdBy, and service
      const scheduling = await SupporterScheduling.findById(schedulingId)
        .populate(
          "supporter",
          "fullName role phoneNumberEnc emailEnc addressEnc identityCardEnc gender avatar"
        )
        .populate(
          "elderly",
          "fullName role phoneNumberEnc emailEnc addressEnc identityCardEnc gender dateOfBirth avatar"
        )
        .populate("registrant", "fullName role phoneNumberEnc emailEnc addressEnc identityCardEnc gender avatar")
        .populate("service", "name price numberOfDays")
        .lean();

      if (!scheduling) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy lịch hỗ trợ" });
      }

      const crypto = require("crypto");
      const ENC_KEY = Buffer.from(process.env.ENC_KEY || "", "base64");

      const decryptLegacy = (enc) => {
        if (!enc) return null;
        const [ivB64, ctB64, tagB64] = String(enc).split(":");
        const iv = Buffer.from(ivB64, "base64");
        const ct = Buffer.from(ctB64, "base64");
        const tag = Buffer.from(tagB64, "base64");
        const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
      };

      const decryptGCM = (packed) => {
        if (!packed) return null;
        const [ivB64, tagB64, dataB64] = String(packed).split(".");
        const iv = Buffer.from(ivB64, "base64url");
        const tag = Buffer.from(tagB64, "base64url");
        const data = Buffer.from(dataB64, "base64url");
        const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(data), d.final()]).toString("utf8");
      };

      const tryDecryptAny = (v) => {
        if (v == null || v === "") return null;
        const s = String(v);
        try {
          if (s.includes(".")) return decryptGCM(s); // Dữ liệu kiểu GCM
          if (s.includes(":")) return decryptLegacy(s); // Dữ liệu kiểu legacy
          return s;
        } catch {
          return null;
        }
      };

      const deepDecrypt = (v, passes = 3) => {
        let cur = v;
        for (let i = 0; i < passes; i++) {
          const out = tryDecryptAny(cur);
          if (out == null || out === cur) return out;
          cur = out;
        }
        return cur;
      };

      // Giải mã trường address bằng tryDecryptField
      const addressDecrypted = scheduling.address
        ? tryDecryptField(scheduling.address)
        : "";

      // Giải mã các trường mã hóa khác
      const phoneNumberSupporter = scheduling?.supporter?.phoneNumberEnc
        ? tryDecryptAny(scheduling?.supporter?.phoneNumberEnc)
        : "";
      const emailSupporter = scheduling?.supporter?.emailEnc
        ? tryDecryptAny(scheduling?.supporter?.emailEnc)
        : "";
      const phoneNumberElderly = scheduling?.elderly?.phoneNumberEnc
        ? tryDecryptAny(scheduling?.elderly?.phoneNumberEnc)
        : "";
      const emailElderly = scheduling?.elderly?.emailEnc
        ? tryDecryptAny(scheduling?.elderly?.emailEnc)
        : "";

      // Tạo response
      const responseScheduling = {
        ...scheduling,
        address: addressDecrypted,
        phoneNumberSupporter: phoneNumberSupporter,
        emailSupporter: emailSupporter,
        phoneNumberElderly: phoneNumberElderly,
        emailElderly: emailElderly,
      };

      // Dọn rác (xóa các trường mã hóa khỏi kết quả trả về)
      delete responseScheduling.phoneNumberEnc;
      delete responseScheduling.emailEnc;
      delete responseScheduling.addressEnc;
      delete responseScheduling.identityCardEnc;
      delete responseScheduling.currentAddressEnc;
      delete responseScheduling.hometownEnc;

      // Mask thông tin nhạy cảm như số điện thoại và email
      const mask = (x, n = 4) =>
        typeof x === "string" && x ? x.slice(0, n) + "***" : x;

      // Thiết lập no-store cho cache để bảo mật dữ liệu
      res.set("Cache-Control", "no-store");
      return res.status(200).json({ success: true, data: responseScheduling });
    } catch (error) {
      console.error("Error fetching scheduling by id:", error);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi",
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

      return res.status(200).json({
        success: true,
        message: "Cập nhật trạng thái lịch hỗ trợ thành công",
        data: plain,
      });
    } catch (error) {
      console.error("Error updating scheduling status:", error);
      return res.status(500).json({
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
        return res.status(400).json({
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
        (s) => s.status === "completed" || s.status === "canceled" || s.status === "pending"
      );

      return res.status(200).json({
        success: true,
        message: "Kiểm tra lịch thành công",
        data: allCompletedOrCanceled,
      });
    } catch (error) {
      console.error("Error checking all completed or canceled:", error);
      return res.status(500).json({
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
          .populate("registrant", projectUser)
          .populate("service", "name price numberOfDays")
          .lean(),
        SupporterScheduling.countDocuments(),
      ]);
      const data = items.map((it) => ({
        ...it,
      }));
      return res.status(200).json({
        success: true,
        message: "Lấy danh sách đặt lịch thành công",
        data,
        pagination: { page: Number(page), limit: Number(limit), total },
      });
    } catch (error) {
      console.error("Error fetching all schedulings for admin:", error);
      return res.status(500).json({
        success: false,
        message: "Lấy danh sách đặt lịch thất bại",
        error: error?.message || error,
      });
    }
  },
    /**
   * GET /api/schedulings/supporter-detail/:id
   * -> Lấy chi tiết supporter (User) + giải mã địa chỉ / số điện thoại / email
   */
  getSupporterDetail: async (req, res) => {
  try {
    // Ưu tiên lấy từ params, fallback sang query/body cho linh hoạt
    const supporterId =
      req.params.id ||
      req.params.supporterId ||
      req.query.supporterId ||
      (req.body && req.body.supporterId);

    if (!supporterId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu supporterId.",
      });
    }

    // Lấy user (supporter) từ DB
    const supporter = await User.findById(supporterId).lean();
    if (!supporter) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy supporter.",
      });
    }

    // ====== Setup giải mã ======
    const crypto = require("crypto");
    const ENC_KEY_RAW = process.env.ENC_KEY || "";
    const ENC_KEY = ENC_KEY_RAW ? Buffer.from(ENC_KEY_RAW, "base64") : null;

    const decryptLegacy = (enc) => {
      if (!enc || !ENC_KEY) return null;
      try {
        // Định dạng: ivB64:ctB64:tagB64
        const [ivB64, ctB64, tagB64] = String(enc).split(":");
        if (!ivB64 || !ctB64 || !tagB64) return null;
        const iv = Buffer.from(ivB64, "base64");
        const ct = Buffer.from(ctB64, "base64");
        const tag = Buffer.from(tagB64, "base64");
        const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
      } catch (e) {
        console.error("[getSupporterDetail] decryptLegacy error:", e.message);
        return null;
      }
    };

    const decryptGCM = (packed) => {
      if (!packed || !ENC_KEY) return null;
      try {
        // Định dạng: iv.tag.data (base64url)
        const [ivB64, tagB64, dataB64] = String(packed).split(".");
        if (!ivB64 || !tagB64 || !dataB64) return null;
        const iv = Buffer.from(ivB64, "base64url");
        const tag = Buffer.from(tagB64, "base64url");
        const data = Buffer.from(dataB64, "base64url");
        const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(data), d.final()]).toString("utf8");
      } catch (e) {
        console.error("[getSupporterDetail] decryptGCM error:", e.message);
        return null;
      }
    };

    // Thử giải mã 1 giá trị (GCM, legacy). Nếu không giải mã được thì trả lại string gốc.
    const tryDecryptAny = (v) => {
      if (v == null || v === "") return null;
      const s = String(v);

      // Không có ENC_KEY => không decrypt được, trả nguyên string (tránh crash)
      if (!ENC_KEY) return s;

      try {
        if (s.includes(".")) {
          const dec = decryptGCM(s);
          if (dec != null) return dec;
        }
        if (s.includes(":")) {
          const dec = decryptLegacy(s);
          if (dec != null) return dec;
        }
        // Không nhận dạng được format → coi là plain text
        return s;
      } catch (e) {
        console.error("[getSupporterDetail] tryDecryptAny error:", e.message);
        return s;
      }
    };

    // Helper: chọn giá trị đầu tiên khác null/"" theo list key
    const pickFirstNonEmpty = (doc, keys = []) => {
      for (const k of keys) {
        if (!k) continue;
        if (Object.prototype.hasOwnProperty.call(doc, k)) {
          const val = doc[k];
          if (val !== undefined && val !== null && val !== "") {
            return val;
          }
        }
      }
      return null;
    };

    // Helper decode 1 field với nhiều key enc + plain
    const decodeField = (encKeys = [], plainKeys = []) => {
      const rawEnc = pickFirstNonEmpty(supporter, encKeys);
      const rawPlain = pickFirstNonEmpty(supporter, plainKeys);
      const raw = rawEnc != null ? rawEnc : rawPlain;

      if (raw == null) return null;

      const decrypted = tryDecryptAny(raw);
      return decrypted != null ? String(decrypted).trim() : String(raw).trim();
    };

    // ====== Giải mã các field nhạy cảm ======
    const phoneNumberDec = decodeField(
      ["phoneNumberEnc", "phoneEnc"],
      ["phoneNumber", "phone", "mobile", "mobileNumber"]
    );
    const emailDec = decodeField(["emailEnc"], ["email"]);
    const addressDec = decodeField(
      ["addressEnc", "addrEnc"],
      ["address", "addr"]
    );
    const currentAddressDec = decodeField(
      ["currentAddressEnc"],
      ["currentAddress", "addressCurrent"]
    );
    const hometownDec = decodeField(
      ["hometownEnc"],
      ["hometown", "homeTown"]
    );

    // ====== Tạo object trả về cho FE (KHÔNG expose field mã hoá) ======
    const responseSupporter = {
      _id: supporter._id,
      fullName: supporter.fullName,
      role: supporter.role,
      gender: supporter.gender,
      avatar: supporter.avatar,

      // ƯU TIÊN GIÁ TRỊ ĐÃ GIẢI MÃ, fallback về field thô nếu vẫn null
      phoneNumber:
        phoneNumberDec ??
        supporter.phoneNumber ??
        supporter.phone ??
        null,
      email: emailDec ?? supporter.email ?? null,
      address: addressDec ?? supporter.address ?? null,
      currentAddress:
        currentAddressDec ?? supporter.currentAddress ?? null,
      hometown: hometownDec ?? supporter.hometown ?? null,
    };

    // Không cache thông tin nhạy cảm
    res.set("Cache-Control", "no-store");

    return res.status(200).json({
      success: true,
      data: responseSupporter,
      message: "Lấy chi tiết người hỗ trợ thành công",
    });
  } catch (error) {
    console.error("Error fetching supporter detail:", error);
    return res.status(500).json({
      success: false,
      message: "Lấy chi tiết supporter thất bại",
      error: error?.message || error,
    });
  }
},
};

module.exports = schedulingController;
