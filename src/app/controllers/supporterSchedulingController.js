const SupporterScheduling = require("../models/SupporterScheduling");
const SupporterService = require("../models/SupporterServices");
const User = require("../models/User");
const Relationship = require("../models/Relationship");
const Conversation = require("../models/Conversation");

const { encryptField, tryDecryptField } = require("./userController");

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const projectUser = "-password -refreshToken -__v";

const toPlain = (doc) => JSON.parse(JSON.stringify(doc));

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

      // ✅ Kiểm tra xung đột lịch: supporter đã có lịch trong khoảng thời gian này chưa
      const conflictSchedule = await SupporterScheduling.findOne({
        supporter: supporter,
        status: { $nin: ["canceled"] }, // không tính lịch đã hủy
        $or: [
          // Lịch mới nằm hoàn toàn trong lịch cũ
          { startDate: { $lte: start }, endDate: { $gte: end } },
          // Lịch mới bắt đầu trong khoảng lịch cũ
          { startDate: { $lte: start }, endDate: { $gte: start, $lt: end } },
          // Lịch mới kết thúc trong khoảng lịch cũ
          { startDate: { $gt: start, $lte: end }, endDate: { $gte: end } },
          // Lịch mới bao phủ hoàn toàn lịch cũ
          { startDate: { $gte: start }, endDate: { $lte: end } },
        ],
      });

      if (conflictSchedule) {
        const conflictStartStr = new Date(conflictSchedule.startDate).toLocaleDateString('vi-VN');
        const conflictEndStr = new Date(conflictSchedule.endDate).toLocaleDateString('vi-VN');
        return res.status(409).json({
          success: false,
          message: `Supporter đã có lịch từ ${conflictStartStr} đến ${conflictEndStr}. Vui lòng chọn supporter khác hoặc thời gian khác.`,
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
        status: "confirmed",
      };

      if (address?.trim()) {
        payload.address = encryptField(address.trim());
      }

      const created = await SupporterScheduling.create(payload);
      const plain = toPlain(created);

      // ================== AUTO KẾT NỐI RELATIONSHIP + CONVERSATION VỚI SUPPORTER ==================
      try {
        const supporterUserId = supporter;

        // Hàm nhỏ: đảm bảo có Conversation 1-1 giữa 2 user
        const ensureOneToOneConversation = async (userA, userB) => {
          if (!userA || !userB) return null;
          if (String(userA) === String(userB)) return null;

          let conv = await Conversation.findOne({
            isActive: true,
            $and: [
              { participants: { $elemMatch: { user: userA } } },
              { participants: { $elemMatch: { user: userB } } },
            ],
            "participants.2": { $exists: false },
          });

          if (!conv) {
            conv = new Conversation({
              participants: [{ user: userA }, { user: userB }],
              isActive: true,
            });
            await conv.save();
          }

          return conv;
        };

        // Hàm nhỏ: tạo Relationship accepted giữa elderly/registrant và supporter nếu chưa có
        const ensureSupporterRelationship = async (userId) => {
          if (!userId || !supporterUserId) return null;
          if (String(userId) === String(supporterUserId)) return null;

          const filter = {
            elderly: userId,
            family: supporterUserId,
          };

          let rel = await Relationship.findOne(filter);
          if (!rel) {
            rel = new Relationship({
              elderly: userId,
              family: supporterUserId,
              relationship: "Người hỗ trợ",
              status: "accepted",
              requestedBy: supporterUserId,
              respondedAt: new Date(),
            });
            await rel.save();
          } else {
            let changed = false;
            if (rel.status !== "accepted") {
              rel.status = "accepted";
              rel.respondedAt = new Date();
              changed = true;
            }
            if (rel.relationship !== "Người hỗ trợ") {
              rel.relationship = "Người hỗ trợ";
              changed = true;
            }
            if (changed) {
              await rel.save();
            }
          }

          await ensureOneToOneConversation(userId, supporterUserId);
          return rel;
        };

        // 1) Tạo/đảm bảo quan hệ & conversation giữa elderly (người được hỗ trợ) và supporter
        await ensureSupporterRelationship(elderly);

        // 2) Nếu registrant khác elderly thì cũng tạo quan hệ & conversation giữa registrant và supporter
        const registrantId = registrant || supporter;
        if (String(registrantId) !== String(elderly)) {
          await ensureSupporterRelationship(registrantId);
        }
      } catch (autoErr) {
        // Không để lỗi auto-connect làm fail việc tạo lịch
        console.error(`${TAG} Auto-connect error:`, autoErr);
      }
      // ================== HẾT PHẦN AUTO KẾT NỐI ==================

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


  getSchedulingById: async (req, res) => {
    try {
      const schedulingId = req.params.id;

      // Populate supporter, elderly, registrant, and service
      const scheduling = await SupporterScheduling.findById(schedulingId)
        .populate(
          "supporter",
          "fullName role phoneNumberEnc emailEnc addressEnc identityCardEnc gender avatar"
        )
        .populate(
          "elderly",
          "fullName role phoneNumberEnc emailEnc addressEnc identityCardEnc gender dateOfBirth avatar currentAddress"
        )
        .populate("registrant", "fullName role phoneNumberEnc emailEnc addressEnc identityCardEnc gender avatar bankName bankAccountNumber bankAccountHolderName")
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
          if (s.includes(".")) return decryptGCM(s);
          if (s.includes(":")) return decryptLegacy(s);
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

      const addressDecrypted = scheduling.address
        ? tryDecryptField(scheduling.address)
        : "";

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
      const currentAddressElderly = scheduling?.elderly?.currentAddress
        ? tryDecryptAny(scheduling?.elderly?.currentAddress)
        : "";

      const phoneNumberRegistrant = scheduling?.registrant?.phoneNumberEnc
        ? tryDecryptAny(scheduling?.registrant?.phoneNumberEnc)
        : "";
      const emailRegistrant = scheduling?.registrant?.emailEnc
        ? tryDecryptAny(scheduling?.registrant?.emailEnc)
        : "";
      const bankAccountNumberRegistrant = scheduling?.registrant?.bankAccountNumber
        ? tryDecryptAny(scheduling?.registrant?.bankAccountNumber)
        : "";

      // Tạo response
      const responseScheduling = {
        ...scheduling,
        address: addressDecrypted,
        phoneNumberSupporter: phoneNumberSupporter,
        emailSupporter: emailSupporter,
        phoneNumberElderly: phoneNumberElderly,
        emailElderly: emailElderly,
        phoneNumberRegistrant: phoneNumberRegistrant,
        emailRegistrant: emailRegistrant,
        elderly: scheduling.elderly ? {
          ...scheduling.elderly,
          currentAddress: currentAddressElderly
        } : null,
        registrant: scheduling.registrant ? {
          ...scheduling.registrant,
          phoneNumber: phoneNumberRegistrant,
          email: emailRegistrant,
          bankAccountNumber: bankAccountNumberRegistrant
        } : null,
        supporter: scheduling.supporter ? {
          ...scheduling.supporter,
          phoneNumber: phoneNumberSupporter,
          email: emailSupporter
        } : null,
      };

      delete responseScheduling.phoneNumberEnc;
      delete responseScheduling.emailEnc;
      delete responseScheduling.addressEnc;
      delete responseScheduling.identityCardEnc;
      delete responseScheduling.currentAddressEnc;
      delete responseScheduling.hometownEnc;

      const mask = (x, n = 4) =>
        typeof x === "string" && x ? x.slice(0, n) + "***" : x;

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
      
      // ✅ Khi hoàn thành công việc: đổi paymentStatus thành paid
      if (status === "completed") {
        scheduling.paymentStatus = "paid";
      }
      
      await scheduling.save();

      // ✅ Khi hoàn thành công việc: đổi relationship thành cancelled + xóa conversation
      if (status === "completed") {
        const TAG_LOG = "[updateSchedulingStatus][completed]";
        console.log(TAG_LOG, "Scheduling completed. Processing relationships and conversations...");

        try {
          // 1️⃣ Đổi relationship với elderly thành cancelled
          if (scheduling.elderly) {
            const relElderly = await Relationship.findOne({
              supporter: scheduling.supporter,
              elderly: scheduling.elderly,
            });
            
            if (relElderly) {
              relElderly.status = "cancelled";
              await relElderly.save();
              console.log(TAG_LOG, "Updated relationship with elderly to cancelled");
            }

            // Xóa conversation giữa supporter và elderly
            await Conversation.deleteMany({
              $and: [
                { "participants.user": scheduling.supporter },
                { "participants.user": scheduling.elderly },
              ],
            });
            console.log(TAG_LOG, "Deleted conversation with elderly");
          }

          // 2️⃣ Đổi relationship với registrant thành cancelled
          if (scheduling.registrant) {
            const relRegistrant = await Relationship.findOne({
              supporter: scheduling.supporter,
              elderly: scheduling.registrant, // registrant có thể là elderly hoặc family
            });
            
            if (relRegistrant) {
              relRegistrant.status = "cancelled";
              await relRegistrant.save();
              console.log(TAG_LOG, "Updated relationship with registrant to cancelled");
            }

            // Xóa conversation giữa supporter và registrant
            await Conversation.deleteMany({
              $and: [
                { "participants.user": scheduling.supporter },
                { "participants.user": scheduling.registrant },
              ],
            });
            console.log(TAG_LOG, "Deleted conversation with registrant");
          }
        } catch (err) {
          console.error(TAG_LOG, "Error processing relationships/conversations:", err);
          // Không fail request, chỉ log warning
        }
      }

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

  updatePaymentStatus: async (req, res) => {
    try {
      const schedulingId = req.params.id;
      const { paymentStatus } = req.body;
      
      if (!paymentStatus) {
        return res.status(400).json({ 
          success: false, 
          message: "Thiếu paymentStatus." 
        });
      }

      const scheduling = await SupporterScheduling.findById(schedulingId);
      if (!scheduling) {
        return res.status(404).json({ 
          success: false, 
          message: "Không tìm thấy lịch hỗ trợ" 
        });
      }

      scheduling.paymentStatus = paymentStatus;
      await scheduling.save();

      const plain = toPlain(scheduling);
      if (plain.address) plain.address = tryDecryptField(plain.address);

      return res.status(200).json({
        success: true,
        message: "Cập nhật trạng thái thanh toán thành công",
        data: plain,
      });
    } catch (error) {
      console.error("Error updating payment status:", error);
      return res.status(500).json({
        success: false,
        message: "Cập nhật trạng thái thanh toán thất bại",
        error: error?.message || error,
      });
    }
  },

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

  getSupporterDetail: async (req, res) => {
  try {
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

    const supporter = await User.findById(supporterId).lean();
    if (!supporter) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy supporter.",
      });
    }

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

    const tryDecryptAny = (v) => {
      if (v == null || v === "") return null;
      const s = String(v);

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
        return s;
      } catch (e) {
        console.error("[getSupporterDetail] tryDecryptAny error:", e.message);
        return s;
      }
    };

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

    const decodeField = (encKeys = [], plainKeys = []) => {
      const rawEnc = pickFirstNonEmpty(supporter, encKeys);
      const rawPlain = pickFirstNonEmpty(supporter, plainKeys);
      const raw = rawEnc != null ? rawEnc : rawPlain;

      if (raw == null) return null;

      const decrypted = tryDecryptAny(raw);
      return decrypted != null ? String(decrypted).trim() : String(raw).trim();
    };

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

    const responseSupporter = {
      _id: supporter._id,
      fullName: supporter.fullName,
      role: supporter.role,
      gender: supporter.gender,
      avatar: supporter.avatar,

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

  // Lấy danh sách đặt lịch theo status (dùng cho Home screen)
  getSchedulingsByStatus: async (req, res) => {
    try {
      const { userId, status, limit = 10 } = req.body || {};

      if (!userId) {
        return res
          .status(400)
          .json({ success: false, message: "Thiếu userId." });
      }

      if (!status) {
        return res
          .status(400)
          .json({ success: false, message: "Thiếu status." });
      }

      const query = { supporter: userId, status };

      const items = await SupporterScheduling.find(query)
        .sort({ startDate: 1 })
        .limit(Number(limit))
        .populate("supporter", projectUser)
        .populate("elderly", "fullName role phoneNumberEnc emailEnc addressEnc identityCardEnc gender dateOfBirth avatar currentAddress")
        .populate("registrant", projectUser)
        .populate("service", "name price numberOfDays")
        .lean();

      const crypto = require("crypto");
      const ENC_KEY = Buffer.from(process.env.ENC_KEY || "", "base64");

      const decryptLegacy = (enc) => {
        if (!enc) return null;
        try {
          const [ivB64, ctB64, tagB64] = String(enc).split(":");
          const iv = Buffer.from(ivB64, "base64");
          const ct = Buffer.from(ctB64, "base64");
          const tag = Buffer.from(tagB64, "base64");
          const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
          d.setAuthTag(tag);
          return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
        } catch (e) {
          return null;
        }
      };

      const decryptGCM = (packed) => {
        if (!packed) return null;
        try {
          const [ivB64, tagB64, dataB64] = String(packed).split(".");
          const iv = Buffer.from(ivB64, "base64url");
          const tag = Buffer.from(tagB64, "base64url");
          const data = Buffer.from(dataB64, "base64url");
          const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
          d.setAuthTag(tag);
          return Buffer.concat([d.update(data), d.final()]).toString("utf8");
        } catch (e) {
          return null;
        }
      };

      const tryDecryptAny = (v) => {
        if (v == null || v === "") return null;
        const s = String(v);
        try {
          if (s.includes(".")) {
            const dec = decryptGCM(s);
            if (dec != null) return dec;
          }
          if (s.includes(":")) {
            const dec = decryptLegacy(s);
            if (dec != null) return dec;
          }
          return s;
        } catch (e) {
          return null;
        }
      };

      const pick = (obj, keys) => {
        for (const k of keys) {
          const v = obj?.[k];
          if (v != null && v !== "") return v;
        }
        return null;
      };

      const data = items.map((it) => {
        const addressDecrypted = it.address ? tryDecryptField(it.address) : "";
        const phoneNumberElderly = it.elderly?.phoneNumberEnc
          ? tryDecryptAny(it.elderly.phoneNumberEnc)
          : "";
        
        // Sử dụng pick để xử lý currentAddress (plaintext, không cần decrypt)
        const currentAddressRaw = pick(it.elderly, ["currentAddressEnc", "currentAddress"]);
        const currentAddressDecrypted = currentAddressRaw ? tryDecryptAny(currentAddressRaw) : "";
        
        return {
          ...it,
          address: addressDecrypted,
          phoneNumberElderly,
          elderly: {
            ...it.elderly,
            currentAddress: currentAddressDecrypted || "",
          },
        };
      });

      return res.status(200).json({
        success: true,
        message: "Lấy danh sách đặt lịch thành công",
        data,
      });
    } catch (error) {
      console.error("Error fetching schedulings by status:", error);
      return res.status(500).json({
        success: false,
        message: "Lấy danh sách đặt lịch thất bại",
        error: error?.message || error,
      });
    }
  },
};

module.exports = schedulingController;
