const mongoose = require("mongoose");

const Relationship = require("../models/Relationship");
const ElderlyProfile = require("../models/ElderlyProfile");
const User = require("../models/User");
const DoctorProfile = require("../models/DoctorProfile");
const Payment = require("../models/Payment");
const RegistrationConsulation = require("../models/RegistrationConsulation");
const ConsultationPrice = require("../models/ConsultationPrice");
const Conversation = require("../models/Conversation");
const ConsultationSummary = require("../models/ConsultationSummary");
const socketConfig = require("../../config/socket/socketConfig");

function getUserIdFromReq(req) {
  if (!req || !req.user) return null;
  return req.user._id || req.user.id || req.user.userId || null;
}

function parseLocalDateString(value) {
  if (!value) return null;
  const buildMidday = (year, monthIndex, day) => {
    if (
      Number.isNaN(year) ||
      Number.isNaN(monthIndex) ||
      Number.isNaN(day)
    ) {
      return null;
    }
    // Lưu lúc 12:00 trưa theo giờ local để tránh bị lùi ngày khi hiển thị UTC
    return new Date(year, monthIndex, day, 12, 0, 0, 0);
  };

  if (value instanceof Date) {
    return buildMidday(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
    );
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [yStr, mStr, dStr] = value.split("-");
    const y = Number(yStr);
    const m = Number(mStr) - 1;
    const d = Number(dStr);
    return buildMidday(y, m, d);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return buildMidday(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
  );
}

function emitBookingUpdated(registration, eventName = "consultation_booking_updated") {
  if (!registration || !socketConfig || typeof socketConfig.emitToUser !== "function") return;

  const ids = new Set();

  const addId = (field) => {
    if (!field) return;
    if (typeof field === "string") {
      ids.add(field);
    } else if (field._id) {
      ids.add(String(field._id));
    } else {
      ids.add(String(field));
    }
  };

  addId(registration.doctor);
  addId(registration.beneficiary);
  addId(registration.registrant);

  if (!ids.size) return;

  const payload = {
    registrationId: registration._id,
    status: registration.status,
    paymentStatus: registration.paymentStatus,
    cancelReason: registration.cancelReason,
  };

  ids.forEach((userId) => {
    try {
      socketConfig.emitToUser(userId, eventName, payload);
    } catch (err) {
      // Không để lỗi socket làm hỏng luồng HTTP
      // eslint-disable-next-line no-console
      console.error("[DoctorBookingController][emitBookingUpdated] Socket emit error:", err.message);
    }
  });
}

async function autoCancelOverdueWithoutSummary(registrations) {
  if (!Array.isArray(registrations) || !registrations.length) return registrations;

  const now = new Date();

  const overdueIds = [];

  registrations.forEach((reg) => {
    if (!reg || reg.status !== "confirmed" || !reg.scheduledDate || !reg.slot) {
      return;
    }

    const base = new Date(reg.scheduledDate);
    if (Number.isNaN(base.getTime())) return;

    const end = new Date(base);
    
    if (reg.slot === "morning") {
      end.setHours(11, 0, 0, 0);
    } else if (reg.slot === "afternoon") {
      end.setHours(16, 0, 0, 0);
    } else {
      return;
    }
console.log("end day 2", end);
    if (now.getTime() > end.getTime()) {
      overdueIds.push(String(reg._id));
    }
  });

  if (!overdueIds.length) return registrations;

  const summaries = await ConsultationSummary.find({
    registration: { $in: overdueIds },
  })
    .select("registration _id")
    .lean();

  const hasSummary = new Set(summaries.map((s) => String(s.registration)));

  const finalIds = overdueIds.filter((id) => !hasSummary.has(id));
  if (!finalIds.length) return registrations;

  const CANCEL_REASON = "Bác sĩ đi trễ lịch hẹn";

  await RegistrationConsulation.updateMany(
    { _id: { $in: finalIds }, status: "confirmed" },
    {
      $set: {
        status: "cancelled",
        paymentStatus: "refunded",
        cancelReason: CANCEL_REASON,
      },
    },
  );

  await Payment.updateMany(
    {
      serviceType: "consultation",
      serviceId: { $in: finalIds },
      status: { $ne: "refunded" },
    },
    {
      $set: { status: "refunded" },
    },
  );

  const idSet = new Set(finalIds);
  const updatedRegs = registrations.map((reg) => {
    if (!reg || !idSet.has(String(reg._id))) return reg;
    const updated = {
      ...reg,
      status: "cancelled",
      paymentStatus: "refunded",
      cancelReason: CANCEL_REASON,
    };

    emitBookingUpdated(updated);
    return updated;
  });

  return updatedRegs;
}

const DoctorBookingController = {
  getConnectedElderlies: async (req, res) => {
    try {
      const familyId = getUserIdFromReq(req);
      const role = req.user?.role;

      if (!familyId) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }
      if (role !== "family") {
        return res.status(403).json({
          success: false,
          message: "Chỉ tài khoản người thân mới xem được danh sách này",
        });
      }

      const relationships = await Relationship.find({
        family: familyId,
        status: "accepted",
      })
        .populate({
          path: "elderly",
          select: "fullName avatar gender dateOfBirth role isActive",
        })
        .lean();

      if (!relationships.length) {
        return res.json({ success: true, data: [] });
      }

      const elderlyIds = relationships
        .map((r) => r.elderly && r.elderly._id)
        .filter(Boolean);

      const elderlyProfiles = await ElderlyProfile.find({
        user: { $in: elderlyIds },
      })
        .select("user healthInfo")
        .lean();

      const profileMap = new Map();
      elderlyProfiles.forEach((p) => {
        profileMap.set(String(p.user), p);
      });

      const result = relationships
        .filter((r) => !!r.elderly)
        .map((r) => {
          const u = r.elderly;
          const profile = profileMap.get(String(u._id));
          return {
            relationshipId: r._id,
            elderlyId: u._id,
            fullName: u.fullName,
            avatar: u.avatar,
            gender: u.gender,
            dateOfBirth: u.dateOfBirth,
            role: u.role,
            isActive: u.isActive,
            relationship: r.relationship,
            permissions: r.permissions,
            healthInfo: profile?.healthInfo || null,
          };
        });

      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi lấy danh sách người cao tuổi đã kết nối",
      });
    }
  },

  getDoctorFreeSchedule: async (req, res) => {
    try {
      const { doctorId } = req.params;
      const { fromDate, toDate } = req.query || {};

      if (!doctorId || !mongoose.Types.ObjectId.isValid(doctorId)) {
        return res.status(400).json({
          success: false,
          message: "doctorId không hợp lệ",
        });
      }

      const today = new Date();
      const startDay = fromDate
        ? parseLocalDateString(fromDate)
        : parseLocalDateString(today);
      const endDay = toDate
        ? parseLocalDateString(toDate)
        : parseLocalDateString(startDay);

      if (!startDay || !endDay) {
        return res.status(400).json({
          success: false,
          message: "fromDate/toDate không hợp lệ",
        });
      }

      startDay.setHours(0, 0, 0, 0);
      endDay.setHours(23, 59, 59, 999);

      if (startDay > endDay) {
        return res.status(400).json({
          success: false,
          message: "fromDate phải nhỏ hơn hoặc bằng toDate",
        });
      }

      const registrations = await RegistrationConsulation.find({
        doctor: doctorId,
        status: { $nin: ["completed", "cancelled"] },
        scheduledDate: { $gte: startDay, $lte: endDay },
      })
        .select("scheduledDate slot status")
        .lean();

      const busyByDay = new Map(); 
      registrations.forEach((r) => {
        if (!r.scheduledDate) return;
        const d = new Date(r.scheduledDate);
        if (Number.isNaN(d.getTime())) return;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const key = `${y}-${m}-${day}`;
        if (!busyByDay.has(key)) {
          busyByDay.set(key, { morning: false, afternoon: false });
        }
        const dayInfo = busyByDay.get(key);
        if (r.slot === "morning") dayInfo.morning = true;
        if (r.slot === "afternoon") dayInfo.afternoon = true;
      });

      const result = [];
      const dayCursor = new Date(startDay);

     
      const now = new Date();

      const LIMIT_MINUTES = 60;
      const LIMIT_MS = LIMIT_MINUTES * 60 * 1000;

      while (dayCursor <= endDay) {
        const y = dayCursor.getFullYear();
        const m = String(dayCursor.getMonth() + 1).padStart(2, "0");
        const d = String(dayCursor.getDate()).padStart(2, "0");
        const dayKey = `${y}-${m}-${d}`;
        const busy = busyByDay.get(dayKey) || { morning: false, afternoon: false };

        const freeSlots = [];

        if (!busy.morning) {
          const start = new Date(dayCursor);
          start.setHours(8, 0, 0, 0);
          const end = new Date(dayCursor);
          end.setHours(11, 0, 0, 0);

          if (start.getTime() - now.getTime() >= LIMIT_MS) {
            freeSlots.push({
              slot: "morning",
              start,
              end,
            });
          }
        }

        // afternoon: 14h - 17h
        if (!busy.afternoon) {
          const start = new Date(dayCursor);
          start.setHours(14, 0, 0, 0);
          const end = new Date(dayCursor);
          end.setHours(17, 0, 0, 0);

          // Chỉ cho đặt nếu còn ít nhất 30 phút trước 14h
          if (start.getTime() - now.getTime() >= LIMIT_MS) {
            freeSlots.push({
              slot: "afternoon",
              start,
              end,
            });
          }
        }

        if (freeSlots.length) {
          result.push({
            date: dayKey,
            freeSlots,
          });
        }

        dayCursor.setDate(dayCursor.getDate() + 1);
      }

      return res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi lấy lịch làm việc bác sĩ",
      });
    }
  },

  logDefaultConsultationPrice: async () => {
    try {
      const doc = await ConsultationPrice.findOne({
        serviceName: "doctor_consultation",
        isActive: true,
      }).lean();

      const fallback =
        RegistrationConsulation.schema.path("price").defaultValue || 0;

      const price =
        doc && typeof doc.price === "number" ? doc.price : fallback;

      // In ra log server để kiểm tra
      console.log("[DoctorBooking] Giá dịch vụ mặc định hiện tại:", price);

      return price;
    } catch (err) {
      console.error(
        "[DoctorBooking] Lỗi khi lấy giá dịch vụ mặc định:",
        err,
      );
      return null;
    }
  },

  getDefaultConsultationPrice: async (req, res) => {
    try {
      const doc = await ConsultationPrice.findOne({
        serviceName: "doctor_consultation",
        isActive: true,
      }).lean();

      let price;

      if (doc && typeof doc.price === "number") {
        price = doc.price;
      } else {
        price =
          RegistrationConsulation.schema.path("price").defaultValue || 0;
      }

      return res.json({
        success: true,
        data: { price },
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi lấy giá dịch vụ mặc định",
      });
    }
  },

  createRegistration: async (req, res) => {
    try {
      const userId = getUserIdFromReq(req);
      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const {
        doctorId,
        elderlyId,
        registrantId,
        scheduledDate,
        slot,
        note,
        paymentMethod,
      } = req.body || {};

      if (!doctorId || !mongoose.Types.ObjectId.isValid(doctorId)) {
        return res
          .status(400)
          .json({ success: false, message: "doctorId không hợp lệ" });
      }
      if (!elderlyId || !mongoose.Types.ObjectId.isValid(elderlyId)) {
        return res
          .status(400)
          .json({ success: false, message: "elderlyId không hợp lệ" });
      }

      const validSlots = ["morning", "afternoon"];
      if (!slot || !validSlots.includes(slot)) {
        return res.status(400).json({
          success: false,
          message: "slot phải là 'morning' hoặc 'afternoon'",
        });
      }

      if (!scheduledDate) {
        return res
          .status(400)
          .json({ success: false, message: "Thiếu scheduledDate" });
      }

      const dateObj = parseLocalDateString(scheduledDate);
      if (!dateObj) {
        return res
          .status(400)
          .json({ success: false, message: "scheduledDate không hợp lệ" });
      }

      const registrantUserId =
        registrantId && mongoose.Types.ObjectId.isValid(registrantId)
          ? registrantId
          : userId;

      const existed = await RegistrationConsulation.findOne({
        doctor: doctorId,
        scheduledDate: dateObj,
        slot,
        status: { $nin: ["completed", "cancelled"] },
      }).lean();

      if (existed) {
        return res.status(409).json({
          success: false,
          message: "Lịch khám này đã được đặt. Vui lòng chọn buổi khác.",
        });
      }

      const priceConfig = await ConsultationPrice.findOne({
        serviceName: "doctor_consultation",
        isActive: true,
      }).lean();

      const resolvedPrice =
        priceConfig && typeof priceConfig.price === "number"
          ? priceConfig.price
          : RegistrationConsulation.schema.path("price").defaultValue || 0;

      const normalizedPaymentMethod =
        paymentMethod === "bank_transfer" ? "bank_transfer" : "cash";

      const initialPaymentStatus =
        normalizedPaymentMethod === "bank_transfer" ? "paid" : "unpaid";

      const registration = new RegistrationConsulation({
        doctor: doctorId,
        registrant: registrantUserId,
        beneficiary: elderlyId,
        scheduledDate: dateObj,
        slot,
        doctorNote: note || "",
        paymentMethod: normalizedPaymentMethod,
        paymentStatus: initialPaymentStatus,
        price: resolvedPrice,
      });

      await registration.save();

      try {
        const doctorUserId = doctorId;

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

        const ensureDoctorPatientRelationship = async (patientId) => {
          if (!patientId || !doctorUserId) return null;
          if (String(patientId) === String(doctorUserId)) return null;

          const filter = {
            elderly: patientId,
            family: doctorUserId,
          };

          let rel = await Relationship.findOne(filter);
          if (!rel) {
            rel = new Relationship({
              elderly: patientId,
              family: doctorUserId,
              relationship: "Bác sĩ",
              status: "accepted",
              requestedBy: doctorUserId,
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
            if (rel.relationship !== "Bác sĩ") {
              rel.relationship = "Bác sĩ";
              changed = true;
            }
            if (changed) {
              await rel.save();
            }
          }

          await ensureOneToOneConversation(patientId, doctorUserId);
          return rel;
        };

        await ensureDoctorPatientRelationship(elderlyId);

        if (String(registrantUserId) !== String(elderlyId)) {
          await ensureDoctorPatientRelationship(registrantUserId);
        }
      } catch (autoErr) {
      }

      try {
        const eventName = "consultation_booking_created";
        const payload = {
          registrationId: registration._id,
          status: registration.status,
          paymentStatus: registration.paymentStatus,
        };

        const notifyIds = new Set([
          String(doctorId),
          String(elderlyId),
          String(registrantUserId),
        ]);

        notifyIds.forEach((uid) => {
          if (!uid) return;
          try {
            socketConfig.emitToUser(uid, eventName, payload);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error("[DoctorBookingController][createRegistration] Socket emit error:", err.message);
          }
        });
      } catch (socketErr) {
        // eslint-disable-next-line no-console
        console.error("[DoctorBookingController][createRegistration] Socket outer error:", socketErr.message);
      }

      return res.status(201).json({
        success: true,
        data: registration,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi tạo lịch khám bác sĩ",
      });
    }
  },
  getAvailableDoctors: async (req, res) => {
    try {

      const { specialization } = req.query || {};

      const query = {
        role: "doctor",
        isActive: { $ne: false },
      };

      const doctorUsers = await User.find(query)
        .select("fullName role isActive")
        .lean();

      if (!doctorUsers.length) {
        return res.json({ success: true, data: [] });
      }

      let result = doctorUsers.map((u) => ({
        doctorId: u._id,
        fullName: u.fullName,
      }));

      if (specialization) {
        const keyword = String(specialization).toLowerCase();

        const doctorIds = doctorUsers.map((u) => u._id);
        const profiles = await DoctorProfile.find({
          user: { $in: doctorIds },
        })
          .select("user specializations")
          .lean();

        const allowIds = new Set();
        profiles.forEach((p) => {
          const specs = Array.isArray(p.specializations)
            ? p.specializations
            : [];
          const matched = specs.some((s) =>
            String(s).toLowerCase().includes(keyword),
          );
          if (matched) allowIds.add(String(p.user));
        });

        result = result.filter((d) => allowIds.has(String(d.doctorId)));
      }

      return res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi lấy danh sách bác sĩ",
      });
    }
  },

  getDoctorDetail: async (req, res) => {
    try {
      const { doctorId } = req.params;
      if (!doctorId) {
        return res
          .status(400)
          .json({ success: false, message: "Thiếu doctorId" });
      }

      const user = await User.findById(doctorId)
        .select(
          "fullName avatar gender dateOfBirth currentAddress role isActive",
        )
        .lean();

      if (!user || user.role !== "doctor") {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy bác sĩ" });
      }

      const profile = await DoctorProfile.findOne({ user: doctorId })
        .select(
          "specializations experience hospitalName schedule consultationFees ratingStats stats consultationDuration",
        )
        .lean();

      return res.json({
        success: true,
        data: { user, profile },
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi lấy chi tiết bác sĩ",
      });
    }
  },

  getMyBookings: async (req, res) => {
    try {
      const userId =
        (req.user && (req.user._id || req.user.id || req.user.userId)) || null;
      const role = (req.user?.role || "").toLowerCase();

      if (!userId) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

   
      if (role === "doctor") {
        let doctorRegs = await RegistrationConsulation.find({
          doctor: userId,
        })
          .populate({
            path: "doctor",
            select: "fullName avatar gender role",
          })
          .populate({
            path: "beneficiary",
            select: "fullName avatar gender dateOfBirth role",
          })
          .populate({
            path: "registrant",
            select: "fullName avatar gender currentAddress role isActive",
          })
          .sort({ registeredAt: -1, createdAt: -1 })
          .lean();

        doctorRegs = await autoCancelOverdueWithoutSummary(doctorRegs);

        const regIds = doctorRegs.map((r) => String(r._id));

        const payments = await Payment.find({
          serviceType: "consultation",
          serviceId: { $in: regIds },
        })
          .select("_id serviceId paymentMethod status transactionId")
          .lean();

        const payByReg = new Map();
        payments.forEach((p) => {
          payByReg.set(String(p.serviceId), p);
        });

        const mergedDoctor = doctorRegs.map((reg) => {
          const regId = String(reg._id);
          const pay = payByReg.get(regId) || null;

          return {
            ...reg,
            payment: pay
              ? {
                  method: pay.paymentMethod,
                  status: pay.status,
                  transactionId: pay.transactionId,
                }
              : undefined,
            paymentMethod: pay?.paymentMethod,
            paymentStatus: pay?.status,
          };
        });

        return res.json({
          success: true,
          data: mergedDoctor,
        });
      }

  
      const baseQuery = {};

      if (role === "elderly") {
        baseQuery.$or = [{ registrant: userId }, { beneficiary: userId }];
      } else {
        baseQuery.registrant = userId;
      }

      let registrations = await RegistrationConsulation.find(baseQuery)
        .populate({
          path: "doctor",
          select: "fullName avatar gender role isActive",
        })
        .populate({
          path: "beneficiary",
          select: "fullName avatar gender dateOfBirth role",
        })
        .populate({
          path: "packageRef",
          select: "title price durationOptions durations description",
        })
        .populate({
          path: "registrant",
          select: "fullName avatar gender currentAddress role isActive",
        })
        .sort({ registeredAt: -1, createdAt: -1 })
        .lean();

      registrations = await autoCancelOverdueWithoutSummary(registrations);

      const registrantIds = [];
      registrations.forEach(reg => {
        const r = reg.registrant;
        if (r && (typeof r === "string" || r instanceof mongoose.Types.ObjectId)) {
          registrantIds.push(String(r));
        }
      });

      if (registrantIds.length) {
        const users = await User.find({ _id: { $in: [...new Set(registrantIds)] } })
          .select(
            "fullName avatar gender currentAddress role isActive dateOfBirth"
          )
          .lean();

        const userMap = new Map();
        users.forEach(u => userMap.set(String(u._id), u));

        registrations = registrations.map(reg => {
          const r = reg.registrant;
          if (r && (typeof r === "string" || r instanceof mongoose.Types.ObjectId)) {
            return {
              ...reg,
              registrant: userMap.get(String(r)) || r,
            };
          }
          return reg;
        });
      }

      const regIds = registrations.map((r) => String(r._id));

      const payments = await Payment.find({
        serviceType: "consultation",
        serviceId: { $in: regIds },
      })
        .select("_id serviceId paymentMethod status transactionId")
        .lean();

      const payByRegId = new Map();
      payments.forEach((p) => payByRegId.set(String(p.serviceId), p));

      const merged = registrations.map((reg) => {
        const regId = String(reg._id);
        const pay = payByRegId.get(regId) || null;

        return {
          ...reg,
          payment: pay
            ? {
                method: pay.paymentMethod,
                status: pay.status,
                transactionId: pay.transactionId,
              }
            : undefined,
          paymentMethod: pay?.paymentMethod,
          paymentStatus: pay?.status,
        };
      });

      return res.json({
        success: true,
        data: merged,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi lấy lịch khám bác sĩ",
      });
    }
  },

  getRegistrationDetail: async (req, res) => {
    try {
      const { id } = req.params || {};
      if (!id) {
        return res
          .status(400)
          .json({ success: false, message: "Thiếu id đăng ký gói khám" });
      }

      let registration = await RegistrationConsulation.findById(id)
        .populate({
          path: "packageRef",
          select: "title price durationOptions description",
        })
        .populate({
          path: "doctor",
          select: "fullName avatar gender currentAddress role isActive",
        })
        .populate({
          path: "registrant",
          select: "fullName avatar gender currentAddress role isActive",
        })
        .populate({
          path: "beneficiary",
          select: "fullName avatar gender currentAddress role isActive",
        })
        .lean();

      if (!registration) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy đăng ký gói khám",
        });
      }

      const r = registration.registrant;
      if (
        r &&
        (typeof r === "string" || r instanceof mongoose.Types.ObjectId)
      ) {
        const user = await User.findById(r)
          .select(
            "fullName avatar gender currentAddress role isActive dateOfBirth",
          )
          .lean();
        if (user) {
          registration.registrant = user;
        }
      }

      let paymentObj;
      const pay = await Payment.findOne({
        serviceType: "consultation",
        serviceId: registration._id,
      })
        .select("_id paymentMethod status transactionId")
        .lean();

      if (pay) {
        paymentObj = {
          method: pay.paymentMethod,
          status: pay.status,
          transactionId: pay.transactionId,
        };
      }

      const result = {
        ...registration,
        payment: paymentObj || undefined,
        paymentMethod: paymentObj?.method,
        paymentStatus: paymentObj?.status,
      };

      return res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi lấy chi tiết đăng ký gói khám",
      });
    }
  },

  getBookingsByElderlyId: async (req, res) => {
    try {
      const requesterId = getUserIdFromReq(req);
      const role = (req.user?.role || "").toLowerCase();
      const { elderlyId } = req.params || {};

      if (!requesterId) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      if (!elderlyId || !mongoose.Types.ObjectId.isValid(elderlyId)) {
        return res.status(400).json({
          success: false,
          message: "elderlyId không hợp lệ",
        });
      }

      let canView = false;

      if (role === "elderly" && String(requesterId) === String(elderlyId)) {
        canView = true;
      }

      if (!canView && role === "family") {
        const rel = await Relationship.findOne({
          elderly: elderlyId,
          family: requesterId,
          status: "accepted",
        })
          .select("_id")
          .lean();

        if (rel) canView = true;
      }

      if (!canView && (role === "doctor" || role === "admin")) {
        canView = true;
      }

      if (!canView) {
        return res.status(403).json({
          success: false,
          message:
            "Bạn không có quyền xem lịch tư vấn của người cao tuổi này.",
        });
      }

      const query = {
        beneficiary: elderlyId,
        isActive: true,
      };

      let registrations = await RegistrationConsulation.find(query)
        .populate({
          path: "doctor",
          select: "fullName avatar gender role isActive",
        })
        .populate({
          path: "beneficiary",
          select: "fullName avatar gender dateOfBirth role",
        })
        .populate({
          path: "packageRef",
          select: "title price durationOptions description",
        })
        .populate({
          path: "registrant",
          select: "fullName avatar gender currentAddress role isActive",
        })
        .sort({ registeredAt: -1, createdAt: -1 })
        .lean();

      registrations = await autoCancelOverdueWithoutSummary(registrations);

      const registrantIdList = [];
      registrations.forEach((reg) => {
        const r = reg.registrant;
        if (
          r &&
          (typeof r === "string" ||
            r instanceof mongoose.Types.ObjectId)
        ) {
          registrantIdList.push(String(r));
        }
      });

      if (registrantIdList.length) {
        const uniqueIds = [...new Set(registrantIdList)];
        const users = await User.find({ _id: { $in: uniqueIds } })
          .select(
            "fullName avatar gender currentAddress role isActive dateOfBirth",
          )
          .lean();

        const userMap = new Map();
        users.forEach((u) => {
          userMap.set(String(u._id), u);
        });

        registrations = registrations.map((reg) => {
          const r = reg.registrant;
          if (
            r &&
            (typeof r === "string" ||
              r instanceof mongoose.Types.ObjectId)
          ) {
            const u = userMap.get(String(r));
            return {
              ...reg,
              registrant: u || r,
            };
          }
          return reg;
        });
      }

      const regIds = registrations.map((r) => String(r._id));

      const payments = await Payment.find({
        serviceType: "consultation",
        serviceId: { $in: regIds },
      })
        .select("_id serviceId paymentMethod status transactionId")
        .lean();

      const payByRegId = new Map();
      payments.forEach((p) => {
        payByRegId.set(String(p.serviceId), p);
      });

      const merged = registrations.map((reg) => {
        const regIdStr = String(reg._id);
        const pay = payByRegId.get(regIdStr) || null;

        const paymentObj =
          pay && {
            method: pay.paymentMethod,
            status: pay.status,
            transactionId: pay.transactionId,
          };

        return {
          ...reg,
          payment: paymentObj || undefined,
          paymentMethod: pay?.paymentMethod,
          paymentStatus: pay?.status,
        };
      });

      return res.json({
        success: true,
        data: merged,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi lấy lịch tư vấn theo người cao tuổi",
      });
    }
  },

  cancelBooking: async (req, res) => {
    const LOG_TAG = "[DoctorBookingController][cancelBooking]";
    const session = await mongoose.startSession();

    try {
      const registrationId = req.params.id;
      const userId = getUserIdFromReq(req);
      const body = req.body || {};
      const reason = body.reason || "Người dùng yêu cầu hủy";
      const desiredStatus = body.status || "cancelled";

      console.log(
        LOG_TAG,
        "==== START ====",
        "\nregistrationId =",
        registrationId,
        "\nuserId        =",
        userId,
        "\nbody          =",
        body,
        "\ndesiredStatus =",
        desiredStatus,
      );

      if (!registrationId) {
        console.log(LOG_TAG, "❌ Thiếu registrationId");
        return res.status(400).json({
          success: false,
          message: "Thiếu id lịch tư vấn (registrationId)",
        });
      }

      if (!userId) {
        console.log(LOG_TAG, "❌ Không có userId (chưa đăng nhập)");
        return res
          .status(401)
          .json({ success: false, message: "Bạn chưa đăng nhập" });
      }

      const registration = await RegistrationConsulation.findById(
        registrationId,
      ).session(session);

      if (!registration) {
        console.log(
          LOG_TAG,
          "❌ Không tìm thấy registration với id =",
          registrationId,
        );
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy lịch tư vấn",
        });
      }
      
      

      const userIdStr = String(userId);
      const registrantStr = String(registration.registrant || "");
      const beneficiaryStr = String(registration.beneficiary || "");
      const doctorStr = String(registration.doctor || "");
      const role = req.user?.role;

      const isOwner =
        userIdStr === registrantStr || userIdStr === beneficiaryStr;
      const isAdmin = role === "admin";
      const isDoctorOfBooking = role === "doctor" && userIdStr === doctorStr;

      

      if (desiredStatus === "cancelled") {
        if (!isOwner && !isAdmin) {
          console.log(
            LOG_TAG,
            "❌ FORBIDDEN: user không có quyền hủy registration này",
          );
          return res.status(403).json({
            success: false,
            message: "Bạn không có quyền hủy lịch này",
          });
        }
      } else if (["in_progress", "completed"].includes(desiredStatus)) {
        if (!isDoctorOfBooking && !isAdmin) {
          console.log(
            LOG_TAG,
            "❌ FORBIDDEN: user không phải bác sĩ của lịch khi cập nhật trạng thái",
          );
          return res.status(403).json({
            success: false,
            message: "Bạn không có quyền cập nhật lịch này",
          });
        }
      } else {
        console.log(LOG_TAG, "❌ desiredStatus không hợp lệ:", desiredStatus);
        return res.status(400).json({
          success: false,
          message: "Trạng thái cập nhật không hợp lệ",
        });
      }

      await session.startTransaction();
      console.log(LOG_TAG, "🚀 Bắt đầu transaction");

      // Với RegistrationConsulation: chỉ có confirmed/completed/cancelled.
      let finalRegistrationStatus = registration.status;

      if (desiredStatus === "cancelled") {
        finalRegistrationStatus = "cancelled";

        registration.status = finalRegistrationStatus;
        registration.cancelledAt = new Date();
        registration.cancelReason = reason;
        await registration.save({ session });

       

        const payment = await Payment.findOne({
          serviceType: "consultation",
          serviceId: registration._id,
        }).session(session);

        if (payment) {
          console.log(
            LOG_TAG,
            "FOUND payment:",
            "\n  _id    =",
            payment._id.toString(),
            "\n  status =",
            payment.status,
          );

          if (
            payment.status !== "refunded" &&
            payment.status !== "cancelled"
          ) {
            payment.status = "cancelled";
            payment.cancelledAt = new Date();
            await payment.save({ session });

          }
        } else {
          console.log(
            LOG_TAG,
            "ℹ️ Không tìm thấy payment cho registration này",
          );
        }
      } else if (["in_progress", "completed"].includes(desiredStatus)) {
        finalRegistrationStatus =
          desiredStatus === "completed" ? "completed" : "confirmed";

        registration.status = finalRegistrationStatus;
        await registration.save({ session });

        console.log(
          LOG_TAG,
          `✅ Sau khi save registration (${finalRegistrationStatus}):`,
          "\n  _id    =",
          registration._id.toString(),
          "\n  status =",
          registration.status,
        );
      }

      await session.commitTransaction();
      session.endSession();
      console.log(LOG_TAG, "🎉 COMMIT transaction xong");

      const updatedRegistration = await RegistrationConsulation.findById(
        registrationId,
      )
        .populate("doctor")
        .populate("beneficiary")
        .populate("registrant")
        .lean();

      emitBookingUpdated(updatedRegistration);

      console.log(
        LOG_TAG,
        "📦 UPDATED registration trả về FE:",
        "\n  _id    =",
        updatedRegistration?._id?.toString(),
        "\n  status =",
        updatedRegistration?.status,
      );

      return res.json({
        success: true,
        data: updatedRegistration,
        message:
          desiredStatus === "cancelled"
            ? "Đã hủy lịch tư vấn thành công"
            : "Đã cập nhật trạng thái lịch tư vấn",
      });
    } catch (err) {
      console.error(LOG_TAG, "❌ LỖI trong cancelBooking:", err);
      try {
        await session.abortTransaction();
      } catch (e) {
        console.error(LOG_TAG, "Lỗi khi abortTransaction:", e);
      }
      session.endSession();
      return res.status(500).json({
        success: false,
        message: "Lỗi xử lý hủy/cập nhật lịch tư vấn",
      });
    }
  },
};

module.exports = DoctorBookingController;
