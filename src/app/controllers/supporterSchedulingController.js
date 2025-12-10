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

createScheduling: async (req, res) => {
  const TAG = "[SupporterScheduling][create]";
  try {
    const schedulingData = req.body || {};
    const {
      supporter,
      elderly,
      createdBy,
      service,
      address,
      notes,
      paymentStatus, 
      paymentMethod,
      bookingType, 
      scheduleDate,
      scheduleTime,
      monthStart,
      monthEnd,
      monthSessionsPerDay, 
    } = schedulingData || {};

    if (!supporter || !elderly || !createdBy || !service || !bookingType) {
      return res.status(400).json({
        success: false,
        message:
          "Thiếu thông tin bắt buộc (supporter, elderly, createdBy, service, bookingType).",
      });
    }

    if (!address) {
      return res
        .status(400)
        .json({ success: false, message: "Thiếu địa chỉ (address)." });
    }

    const svc = await SupporterService.findById(service).lean();

    if (!svc || !svc.isActive) {
      return res.status(400).json({
        success: false,
        message: "Dịch vụ không tồn tại hoặc đang tắt.",
      });
    }

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
      status: "confirmed",
    };

    if (bookingType === "session") {
      if (!scheduleDate || !scheduleTime) {
        return res.status(400).json({
          success: false,
          message: "Thiếu scheduleDate hoặc scheduleTime cho gói theo buổi.",
        });
      }
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
        return res.status(400).json({
          success: false,
          message: "Thiếu monthStart cho gói theo tháng.",
        });
      }
      const _monthStart = new Date(monthStart);
      const _monthEnd = monthEnd
        ? new Date(monthEnd)
        : addDays(_monthStart, 29);

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

    const payStatusLower = (basePayload.paymentStatus || "").toLowerCase();

    if (payStatusLower === "paid" || payStatusLower === "unpaid") {
      try {
        const [elderlyUser, creatorUser] = await Promise.all([
          User.findById(elderly).select("role"),
          User.findById(createdBy).select("role"),
        ]);

        if (elderlyUser && creatorUser) {
          const creatorRole = creatorUser.role;

          const ensureAcceptedSupporterRelationshipInline = async (
            elderlyId,
            supporterId,
            options = {}
          ) => {
            const { relationshipLabel = "Người hỗ trợ" } = options || {};
            if (!elderlyId || !supporterId) {
              return null;
            }

            const filter = { elderly: elderlyId, family: supporterId };

            let rel = await Relationship.findOne(filter);
            if (rel) {
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
              if (
                relationshipLabel === "Người hỗ trợ" &&
                String(rel.requestedBy) !== String(supporterId)
              ) {
                rel.requestedBy = supporterId;
                changed = true;
              }

              if (changed) {
                await rel.save();
              }

              let conv = await Conversation.findOne({
                isActive: true,
                $and: [
                  { participants: { $elemMatch: { user: elderlyId } } },
                  { participants: { $elemMatch: { user: supporterId } } },
                ],
                "participants.2": { $exists: false },
              });

              if (!conv) {
                conv = new Conversation({
                  participants: [
                    { user: elderlyId },
                    { user: supporterId },
                  ],
                  isActive: true,
                });
                await conv.save();
              }

              return { relationship: rel, conversation: conv };
            }

            rel = new Relationship({
              elderly: elderlyId,
              family: supporterId,
              relationship: relationshipLabel,
              status: "accepted",
              requestedBy: supporterId,
              respondedAt: new Date(),
            });

            await rel.save();

            let conv = new Conversation({
              participants: [
                { user: elderlyId },
                { user: supporterId },
              ],
              isActive: true,
            });
            await conv.save();

            return { relationship: rel, conversation: conv };
          };

          if (creatorRole === "family") {
            const familyId = createdBy;

            const acceptedRels = await Relationship.find({
              family: familyId,
              status: "accepted",
            }).select("elderly");

            const elderlySet = new Set();
            acceptedRels.forEach((rel) => {
              if (rel.elderly) elderlySet.add(String(rel.elderly));
            });
            elderlySet.add(String(elderly));

            const elderlyIds = Array.from(elderlySet);

            for (const eid of elderlyIds) {
              await ensureAcceptedSupporterRelationshipInline(eid, supporter, {
                relationshipLabel: "Người hỗ trợ",
              });
            }
          } else if (creatorRole === "elderly") {
            await ensureAcceptedSupporterRelationshipInline(elderly, supporter, {
              relationshipLabel: "Người hỗ trợ",
            });
          } else {
            await ensureAcceptedSupporterRelationshipInline(elderly, supporter, {
              relationshipLabel: "Người hỗ trợ",
            });
          }
        }
      } catch (autoErr) {
      }
    }

    const plain = toPlain(created);
    if (plain.address) {
      plain.address = tryDecryptField(plain.address);
    }

    return res
      .status(201)
      .json({ success: true, message: "Đặt lịch thành công", data: plain });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Đặt lịch thất bại",
      error: error?.message || error,
    });
  }
},


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
          .populate("createdBy", projectUser)
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

      const scheduling = await SupporterScheduling.findById(schedulingId)
        .populate(
          "supporter",
          "fullName role phoneNumberEnc emailEnc addressEnc identityCardEnc gender avatar"
        ) 
        .populate(
          "elderly",
          "fullName role phoneNumberEnc emailEnc addressEnc identityCardEnc gender dateOfBirth avatar"
        ) 
        .populate(
          "createdBy",
          "fullName role phoneNumberEnc emailEnc addressEnc identityCardEnc gender avatar"
        )
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
      const phoneNumberCreatedBy = scheduling?.createdBy?.phoneNumberEnc
        ? tryDecryptAny(scheduling?.createdBy?.phoneNumberEnc)
        : "";
      const emailCreatedBy = scheduling?.createdBy?.emailEnc
        ? tryDecryptAny(scheduling?.createdBy?.emailEnc)
        : "";

      const responseScheduling = {
        ...scheduling,
        address: addressDecrypted, 
        phoneNumberSupporter: phoneNumberSupporter,
        emailSupporter: emailSupporter,
        phoneNumberElderly: phoneNumberElderly,
        emailElderly: emailElderly,
        phoneNumberCreatedBy: phoneNumberCreatedBy,
        emailCreatedBy: emailCreatedBy,
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
};

module.exports = schedulingController;
