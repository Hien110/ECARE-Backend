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
   * Body (tuỳ bookingType):
   * - Common: supporter, elderly, createdBy, service, address?, notes?, paymentStatus?
   * - session: scheduleDate (YYYY-MM-DD), scheduleTime ('morning'|'afternoon'|'evening')
   * - day:     scheduleDate (YYYY-MM-DD)
   * - month:   monthStart (YYYY-MM-DD), monthEnd? (auto 30d nếu không gửi), monthSessionsPerDay? (lấy từ service)
   */
    createScheduling: async (req, res) => {
  const TAG = "[SupporterScheduling][create]";
  try {
    console.log(TAG, "📥 Body nhận từ FE:", JSON.stringify(req.body, null, 2));

    const schedulingData = req.body || {};
    const {
      supporter,
      elderly,
      createdBy,
      service,
      address,
      notes,
      paymentStatus, // 'unpaid'|'paid'|'refunded' (tuỳ FE)
      paymentMethod, // 'cash'|'bank_transfer' (nếu FE gửi)
      bookingType, // 'session'|'day'|'month'
      scheduleDate,
      scheduleTime,
      monthStart,
      monthEnd,
      monthSessionsPerDay, // FE có thể không gửi: lấy từ service
    } = schedulingData || {};

    console.log(TAG, "➡️ Parsed fields:", {
      supporter,
      elderly,
      createdBy,
      service,
      bookingType,
      paymentStatus,
      paymentMethod,
      scheduleDate,
      scheduleTime,
      monthStart,
      monthEnd,
    });

    // Bắt các field bắt buộc tối thiểu theo yêu cầu business
    if (!supporter || !elderly || !createdBy || !service || !bookingType) {
      console.warn(TAG, "❌ Thiếu field bắt buộc", {
        supporter,
        elderly,
        createdBy,
        service,
        bookingType,
      });
      return res.status(400).json({
        success: false,
        message:
          "Thiếu thông tin bắt buộc (supporter, elderly, createdBy, service, bookingType).",
      });
    }
    // Tối thiểu cần địa chỉ để di chuyển (theo form của bạn)
    if (!address) {
      console.warn(TAG, "❌ Thiếu address");
      return res
        .status(400)
        .json({ success: false, message: "Thiếu địa chỉ (address)." });
    }

    // Tải service để snapshot giá + cấu hình
    console.log(TAG, "🔍 Đang tìm SupporterService:", service);
    const svc = await SupporterService.findById(service).lean();
    if (!svc) {
      console.error(TAG, "❌ Không tìm thấy service hoặc null:", service);
    } else {
      console.log(TAG, "✅ Tìm thấy service:", {
        _id: svc._id,
        name: svc.name,
        isActive: svc.isActive,
      });
    }

    if (!svc || !svc.isActive) {
      return res.status(400).json({
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

    console.log(TAG, "🧾 basePayload ban đầu:", {
      supporter: basePayload.supporter,
      elderly: basePayload.elderly,
      createdBy: basePayload.createdBy,
      bookingType: basePayload.bookingType,
      paymentStatus: basePayload.paymentStatus,
      paymentMethod: basePayload.paymentMethod,
    });

    if (bookingType === "session") {
      if (!scheduleDate || !scheduleTime) {
        console.warn(TAG, "❌ Thiếu scheduleDate/scheduleTime cho session");
        return res.status(400).json({
          success: false,
          message: "Thiếu scheduleDate hoặc scheduleTime cho gói theo buổi.",
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
        console.warn(TAG, "❌ Thiếu scheduleDate cho day");
        return res.status(400).json({
          success: false,
          message: "Thiếu scheduleDate cho gói theo ngày.",
        });
      }
      priceAtBooking = serviceSnapshot.byDay.dailyFee || 0;

      basePayload.scheduleDate = scheduleDate;
      basePayload.priceAtBooking = priceAtBooking;
    } else if (bookingType === "month") {
      if (!monthStart) {
        console.warn(TAG, "❌ Thiếu monthStart cho month");
        return res.status(400).json({
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
      console.warn(TAG, "❌ bookingType không hợp lệ:", bookingType);
      return res
        .status(400)
        .json({ success: false, message: "bookingType không hợp lệ." });
    }

    console.log(TAG, "💾 Đang tạo SupporterScheduling với payload:", {
      ...basePayload,
      address: "[ENCRYPTED]", // tránh log raw address
    });

    const created = await SupporterScheduling.create(basePayload);
    console.log(TAG, "✅ Tạo lịch thành công, _id =", created._id);

    // ================== AUTO KẾT NỐI RELATIONSHIP SAU KHI THANH TOÁN ==================
    const payStatusLower = (basePayload.paymentStatus || "").toLowerCase();
    console.log(
      TAG,
      "🔎 Kiểm tra auto-connect, paymentStatus =",
      basePayload.paymentStatus,
      "→",
      payStatusLower
    );

    if (payStatusLower === "paid" || payStatusLower === "unpaid") {
      console.log(
        TAG,
        "✅ Điều kiện auto-connect thỏa mãn (paymentStatus = 'paid' hoặc 'unpaid')"
      );

      try {
        // Lấy role của người tạo và elderly
        const [elderlyUser, creatorUser] = await Promise.all([
          User.findById(elderly).select("role"),
          User.findById(createdBy).select("role"),
        ]);

        console.log(TAG, "👤 elderlyUser:", elderlyUser && {
          _id: elderlyUser._id,
          role: elderlyUser.role,
        });
        console.log(TAG, "👤 creatorUser:", creatorUser && {
          _id: creatorUser._id,
          role: creatorUser.role,
        });

        if (!elderlyUser || !creatorUser) {
          console.log(
            TAG,
            "⚠️ Không tìm thấy elderlyUser hoặc creatorUser, bỏ qua auto-connect"
          );
        } else {
          const creatorRole = creatorUser.role;
          console.log(TAG, "ℹ️ creatorRole =", creatorRole);

          // Hàm nhỏ tạo/accept 1 relationship + đảm bảo có Conversation 1–1
          const ensureAcceptedSupporterRelationshipInline = async (
            elderlyId,
            supporterId,
            options = {}
          ) => {
            const { relationshipLabel = "Người hỗ trợ" } = options || {};
            if (!elderlyId || !supporterId) {
              console.log(
                TAG,
                "[ensureInline] ❌ thiếu elderlyId/supporterId",
                { elderlyId, supporterId }
              );
              return null;
            }

            console.log(
              TAG,
              "[ensureInline] 🔍 Tìm Relationship",
              { elderlyId, supporterId }
            );

            const filter = { elderly: elderlyId, family: supporterId };

            let rel = await Relationship.findOne(filter);
            if (rel) {
              console.log(
                TAG,
                "[ensureInline] ✅ Relationship đã tồn tại, status hiện tại =",
                rel.status
              );
              let changed = false;
              if (rel.status !== "accepted") {
                rel.status = "accepted";
                rel.respondedAt = new Date();
                changed = true;
              }
              if (rel.relationship !== relationshipLabel) {
                rel.relationship = relationshipLabel;
                changed = true;
              }
              // ✅ Với "Người hỗ trợ" thì requestedBy phải là chính supporter
              if (
                relationshipLabel === "Người hỗ trợ" &&
                String(rel.requestedBy) !== String(supporterId)
              ) {
                rel.requestedBy = supporterId;
                changed = true;
              }

              if (changed) {
                await rel.save();
                console.log(
                  TAG,
                  "[ensureInline] 💾 Đã update relationship thành accepted + requestedBy = supporter"
                );
              } else {
                console.log(
                  TAG,
                  "[ensureInline] ℹ️ Không cần update, giữ nguyên relationship"
                );
              }

              // 🔁 Đảm bảo có conversation 1–1 giữa elderly & supporter
              console.log(
                TAG,
                "[ensureInline] 🔍 Kiểm tra Conversation giữa elderly & supporter"
              );
              let conv = await Conversation.findOne({
                isActive: true,
                $and: [
                  { participants: { $elemMatch: { user: elderlyId } } },
                  { participants: { $elemMatch: { user: supporterId } } },
                ],
                "participants.2": { $exists: false }, // chỉ 2 người
              });

              if (conv) {
                console.log(
                  TAG,
                  "[ensureInline] 💬 Conversation đã tồn tại, _id =",
                  conv._id
                );
              } else {
                console.log(
                  TAG,
                  "[ensureInline] ➕ Tạo Conversation mới elderly-supporter"
                );
                conv = new Conversation({
                  participants: [
                    { user: elderlyId },
                    { user: supporterId },
                  ],
                  isActive: true, // theo schema hiện tại bạn đang dùng
                });
                await conv.save();
                console.log(
                  TAG,
                  "[ensureInline] ✅ Đã tạo Conversation mới, _id =",
                  conv._id
                );
              }

              return { relationship: rel, conversation: conv };
            }

            console.log(
              TAG,
              "[ensureInline] ➕ Tạo Relationship mới (accepted, requestedBy = supporter)"
            );
            rel = new Relationship({
              elderly: elderlyId,
              family: supporterId,
              relationship: relationshipLabel,
              status: "accepted",
              requestedBy: supporterId,   // ✅ supporter là người “gửi kết nối”
              respondedAt: new Date(),
            });

            await rel.save();
            console.log(
              TAG,
              "[ensureInline] ✅ Đã tạo relationship mới, _id =",
              rel._id
            );

            // 🔁 Tạo luôn conversation mới nếu chưa có
            console.log(
              TAG,
              "[ensureInline] ➕ Tạo Conversation mới elderly-supporter (do relationship mới)"
            );
            let conv = new Conversation({
              participants: [
                { user: elderlyId },
                { user: supporterId },
              ],
              isActive: true,
            });
            await conv.save();
            console.log(
              TAG,
              "[ensureInline] ✅ Đã tạo Conversation mới, _id =",
              conv._id
            );

            return { relationship: rel, conversation: conv };
          };

          if (creatorRole === "family") {
            // CASE 1: Người thân đặt gói hỗ trợ cho người cao tuổi
            const familyId = createdBy;
            console.log(
              TAG,
              "👨‍👩‍👧 CASE FAMILY đặt cho elderly, familyId =",
              familyId
            );

            // Lấy tất cả elderly đang connect accepted với family này
            const acceptedRels = await Relationship.find({
              family: familyId,
              status: "accepted",
            }).select("elderly");

            console.log(
              TAG,
              "📊 Số relationship accepted của family:",
              acceptedRels.length
            );

            const elderlySet = new Set();

            acceptedRels.forEach((rel) => {
              if (rel.elderly) elderlySet.add(String(rel.elderly));
            });
            // Đảm bảo có elderly hiện tại trong booking
            elderlySet.add(String(elderly));

            const elderlyIds = Array.from(elderlySet);
            console.log(
              TAG,
              "👵 elderlyIds sẽ auto-connect với supporter:",
              elderlyIds
            );

            for (const eid of elderlyIds) {
              await ensureAcceptedSupporterRelationshipInline(eid, supporter, {
                relationshipLabel: "Người hỗ trợ",
              });
            }
          } else if (creatorRole === "elderly") {
            // CASE 2: Người cao tuổi tự đặt gói hỗ trợ
            console.log(
              TAG,
              "👵 CASE ELDERLY tự đặt → connect elderly-supporter",
              { elderly, supporter }
            );

            await ensureAcceptedSupporterRelationshipInline(elderly, supporter, {
              relationshipLabel: "Người hỗ trợ",
            });
          } else {
            // CASE 3: Vai trò khác (admin, supporter tự đặt hộ, ...) → ít nhất connect elderly hiện tại
            console.log(
              TAG,
              "👤 CASE role khác (",
              creatorRole,
              ") → fallback connect elderly-supporter",
              { elderly, supporter }
            );

            await ensureAcceptedSupporterRelationshipInline(elderly, supporter, {
              relationshipLabel: "Người hỗ trợ",
            });
          }
        }
      } catch (autoErr) {
        console.error(
          TAG,
          "❌ Lỗi trong block auto-connect supporter:",
          autoErr
        );
      }
    } else {
      console.log(
        TAG,
        "ℹ️ paymentStatus KHÔNG phải 'paid' → KHÔNG auto-connect",
        basePayload.paymentStatus
      );
    }
    // ================== HẾT PHẦN AUTO KẾT NỐI ==================

    // Trả bản sao đã giải mã address để FE hiển thị
    const plain = toPlain(created);
    if (plain.address) {
      plain.address = tryDecryptField(plain.address);
    }

    console.log(TAG, "📤 Trả response thành công cho FE");
    return res
      .status(201)
      .json({ success: true, message: "Đặt lịch thành công", data: plain });
  } catch (error) {
    console.error("[SupporterScheduling][create] ❌ Error creating scheduling:", error);
    return res.status(500).json({
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
          .populate("createdBy", projectUser)
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
          .populate("createdBy", projectUser)
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

      // Populate supporter, elderly, and createdBy với các trường mã hóa từ User
      const scheduling = await SupporterScheduling.findById(schedulingId)
        .populate(
          "supporter",
          "fullName role phoneNumberEnc emailEnc addressEnc identityCardEnc gender avatar"
        ) // Populate các trường mã hóa từ User
        .populate(
          "elderly",
          "fullName role phoneNumberEnc emailEnc addressEnc identityCardEnc gender dateOfBirth avatar"
        ) // Populate elderly nếu có
        .populate(
          "createdBy",
          "fullName role phoneNumberEnc emailEnc addressEnc identityCardEnc gender avatar"
        ) // Populate createdBy nếu có
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
      const phoneNumberCreatedBy = scheduling?.createdBy?.phoneNumberEnc
        ? tryDecryptAny(scheduling?.createdBy?.phoneNumberEnc)
        : "";
      const emailCreatedBy = scheduling?.createdBy?.emailEnc
        ? tryDecryptAny(scheduling?.createdBy?.emailEnc)
        : "";

      // Tạo response với
      const responseScheduling = {
        ...scheduling,
        address: addressDecrypted, // Giải mã address bằng tryDecryptField
        phoneNumberSupporter: phoneNumberSupporter,
        emailSupporter: emailSupporter,
        phoneNumberElderly: phoneNumberElderly,
        emailElderly: emailElderly,
        phoneNumberCreatedBy: phoneNumberCreatedBy,
        emailCreatedBy: emailCreatedBy,
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
