const mongoose = require("mongoose");
const DoctorProfile = require("../models/DoctorProfile.js");
const User = require("../models/User.js");
const Rating = require("../models/Rating.js");
const {
  DAY_MIN,
  DAY_MAX,
  isValidDay,
  normalizeSlots,
} = require("../../utils/scheduleValidators");

// ---- helpers -------------------------------------------------
const USER_FIELDS = "fullName username avatar email role";

async function ensureDoctorRole(userId) {
  const user = await User.findById(userId).lean();
  if (!user) throw new Error("Không tìm thấy user");
  if (user.role !== "doctor")
    throw new Error("Chỉ bác sĩ mới được phép thao tác");
  return user;
}

async function populateProfile(profileDoc) {
  if (!profileDoc) return null;
  await profileDoc.populate({ path: "user", select: USER_FIELDS });
  return profileDoc;
}

function toNumberOr(v, fallback = undefined) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function has(v) {
  return v !== undefined && v !== null;
}

// ---- controller ----------------------------------------------
const DoctorController = {
  // Tạo hồ sơ bác sĩ
  createDoctorProfile: async (req, res) => {
    try {
      const doctorId = req.user.userId;
      await ensureDoctorRole(doctorId);

      const {
        specializations,
        experience,
        hospitalName,
        consultationFees,
        consultationDuration,
      } = req.body;

      if (!specializations || !has(experience) || !hospitalName) {
        return res
          .status(400)
          .json({ success: false, message: "Thiếu trường bắt buộc" });
      }
      if (
        !consultationFees ||
        !has(consultationFees.online) ||
        !has(consultationFees.offline)
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Thiếu consultationFees.online/offline",
          });
      }

      const existed = await DoctorProfile.findOne({ user: doctorId }).lean();
      if (existed)
        return res
          .status(409)
          .json({ success: false, message: "Hồ sơ đã tồn tại" });

      const profile = await DoctorProfile.create({
        user: doctorId,
        specializations: String(specializations).trim(),
        experience: toNumberOr(experience, 0),
        hospitalName: String(hospitalName).trim(),
        consultationFees: {
          online: toNumberOr(consultationFees.online, 0),
          offline: toNumberOr(consultationFees.offline, 0),
        },
        consultationDuration: toNumberOr(consultationDuration, 30) ?? 30,
        schedule: [],
      });

      await populateProfile(profile);
      return res.status(201).json({ success: true, data: profile });
    } catch (err) {
      console.error("createDoctorProfile error:", err);
      return res.status(500).json({
        success: false,
        message: err.message || "Không thể tạo hồ sơ bác sĩ",
      });
    }
  },

  // Chỉnh sửa hồ sơ bác sĩ
  updateDoctorProfile: async (req, res) => {
    try {
      const doctorId = req.user.userId;
      await ensureDoctorRole(doctorId);

      const allowed = [
        "specializations",
        "experience",
        "hospitalName",
        "consultationFees",
        "consultationDuration",
      ];
      const update = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) update[key] = req.body[key];
      }

      // Chuẩn hóa một số field số
      if (update.experience !== undefined)
        update.experience = toNumberOr(update.experience, 0);

      if (update.consultationDuration !== undefined)
        update.consultationDuration = toNumberOr(
          update.consultationDuration,
          30
        );

      if (update.consultationFees) {
        update.consultationFees = {
          online: toNumberOr(update.consultationFees.online, 0),
          offline: toNumberOr(update.consultationFees.offline, 0),
        };
      }

      const profile = await DoctorProfile.findOneAndUpdate(
        { user: doctorId },
        { $set: update },
        { new: true }
      );
      if (!profile)
        return res
          .status(404)
          .json({ success: false, message: "Chưa có hồ sơ để chỉnh sửa" });

      await populateProfile(profile);
      return res
        .status(200)
        .json({
          success: true,
          message: "Cập nhật hồ sơ thành công",
          data: profile,
        });
    } catch (err) {
      console.error("updateDoctorProfile error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Không thể cập nhật hồ sơ" });
    }
  },

  // Xem hồ sơ của chính mình
  getMyDoctorProfile: async (req, res) => {
    try {
      const doctorId = req.user.userId;
      await ensureDoctorRole(doctorId);

      const profile = await DoctorProfile.findOne({ user: doctorId });
      if (!profile)
        return res
          .status(404)
          .json({ success: false, message: "Chưa có hồ sơ" });

      await populateProfile(profile);
      return res.status(200).json({ success: true, data: profile });
    } catch (err) {
      console.error("getMyDoctorProfile error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Không thể lấy hồ sơ" });
    }
  },

  // Public: xem hồ sơ theo profileId
  getDoctorProfileById: async (req, res) => {
    try {
      const { profileId } = req.params;
      const profile = await DoctorProfile.findById(profileId);
      if (!profile)
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy hồ sơ" });

      await populateProfile(profile);
      return res.status(200).json({ success: true, data: profile });
    } catch (err) {
      console.error("getDoctorProfileById error:", err);
      return res
        .status(400)
        .json({
          success: false,
          message: "profileId không hợp lệ hoặc lỗi khác",
        });
    }
  },

  // --- Lịch làm việc -------------------------------------------------

  // Lấy lịch tuần của chính mình (client đang gọi getMyWeeklySchedule)
  getMyWeeklySchedule: async (req, res) => {
    try {
      const doctorId = req.user.userId;
      await ensureDoctorRole(doctorId);

      const profile = await DoctorProfile.findOne({ user: doctorId });
      if (!profile)
        return res
          .status(404)
          .json({ success: false, message: "Chưa có hồ sơ" });

      // có thể không cần populate ở đây, nhưng làm cho đồng nhất
      await populateProfile(profile);
      return res
        .status(200)
        .json({ success: true, data: { schedules: profile.schedule } });
    } catch (err) {
      console.error("getMyWeeklySchedule error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Không thể lấy lịch tuần" });
    }
  },

  // TẠO lịch cho 1 ngày (chỉ thêm mới, lỗi nếu đã tồn tại)
  createScheduleForDay: async (req, res) => {
  try {
    const doctorId = req.user.userId;
    await ensureDoctorRole(doctorId);

    const { dayOfWeek, timeSlots } = req.body;
    const day = Number(dayOfWeek);

    if (!isValidDay(day)) {
      return res.status(400).json({
        success: false,
        message: `dayOfWeek phải trong [${DAY_MIN}..${DAY_MAX}]`,
      });
    }

    const profile = await DoctorProfile.findOne({ user: doctorId });
    if (!profile) {
      return res.status(404).json({ success: false, message: "Chưa có hồ sơ" });
    }
    if (profile.schedule.findIndex(d => d.dayOfWeek === day) >= 0) {
      return res.status(409).json({ success: false, message: "Ngày này đã có lịch, không thể tạo mới" });
    }

    // ==== chuẩn hoá INLINE ====
    const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
    const toMinutes = (hhmm) => {
      const [h, m] = String(hhmm).split(":").map(Number);
      return h * 60 + m;
    };
    const normalizeOne = (raw, minWhenUsed = 5, max = 180) => {
      const start = raw?.start ?? raw?.startTime ?? raw?.from;
      const end   = raw?.end   ?? raw?.endTime   ?? raw?.to;

      if (!HHMM_RE.test(String(start)) || !HHMM_RE.test(String(end))) {
        throw new Error("Thời gian không đúng định dạng HH:MM");
      }
      if (toMinutes(start) >= toMinutes(end)) {
        throw new Error("Giờ bắt đầu phải nhỏ hơn giờ kết thúc");
      }

      const tRaw = (raw?.consultationType ?? raw?.type ?? "online").toString().toLowerCase();
      const type = ["online","offline","both"].includes(tRaw) ? tRaw : "online";
      const isAvailable = raw?.isAvailable !== false;

      const fromClientOnline =
        toNumberOr(raw?.timeForOnline) ??
        toNumberOr(raw?.onlinePerPatient) ??
        toNumberOr(raw?.onlineDurationPerPatient) ??
        toNumberOr(raw?.perPatientOnlineMinutes) ?? 0;

      const fromClientOffline =
        toNumberOr(raw?.timeForOffline) ??
        toNumberOr(raw?.offlinePerPatient) ??
        toNumberOr(raw?.offlineDurationPerPatient) ??
        toNumberOr(raw?.perPatientOfflineMinutes) ?? 0;

      let timeForOnline = 0, timeForOffline = 0;
      if (type === "online" || type === "both") {
        if (!Number.isFinite(fromClientOnline) || fromClientOnline < minWhenUsed || fromClientOnline > max) {
          throw new Error("Thời gian/1 người (Online) phải từ 5 đến 180 phút");
        }
        timeForOnline = Math.trunc(fromClientOnline);
      }
      if (type === "offline" || type === "both") {
        if (!Number.isFinite(fromClientOffline) || fromClientOffline < minWhenUsed || fromClientOffline > max) {
          throw new Error("Thời gian/1 người (Offline) phải từ 5 đến 180 phút");
        }
        timeForOffline = Math.trunc(fromClientOffline);
      }
      if (type === "online")  timeForOffline = 0;
      if (type === "offline") timeForOnline  = 0;

      return { start, end, consultationType: type, isAvailable, timeForOnline, timeForOffline };
    };

    if (!Array.isArray(timeSlots) || timeSlots.length === 0) {
      return res.status(400).json({ success: false, message: "timeSlots phải là mảng và không rỗng" });
    }
    const normalized = timeSlots
      .map(normalizeOne)
      .sort((a,b)=> toMinutes(a.start) - toMinutes(b.start));
    for (let i = 1; i < normalized.length; i++) {
      if (toMinutes(normalized[i-1].end) > toMinutes(normalized[i].start)) {
        return res.status(400).json({ success:false, message:"Các khung giờ trong ngày không được chồng lấn" });
      }
    }
    // ==== /chuẩn hoá ====

    profile.schedule.push({ dayOfWeek: day, timeSlots: normalized });
    profile.markModified("schedule");
    await profile.save();

    await populateProfile(profile);
    return res.status(201).json({
      success: true,
      message: "Tạo lịch thành công",
      data: { schedules: profile.schedule, profile },
    });
  } catch (err) {
    console.error("createScheduleForDay error:", err);
    return res.status(400).json({ success: false, message: err.message || "Không thể tạo lịch" });
  }
},

// CẬP NHẬT lịch 1 ngày (inline toàn bộ chuẩn hoá)
updateScheduleForDay: async (req, res) => {
  try {
    const doctorId = req.user.userId;
    await ensureDoctorRole(doctorId);

    const { dayOfWeek, timeSlots } = req.body;
    const day = Number(dayOfWeek);

    if (!isValidDay(day)) {
      return res.status(400).json({
        success: false,
        message: `dayOfWeek phải trong [${DAY_MIN}..${DAY_MAX}]`,
      });
    }

    const profile = await DoctorProfile.findOne({ user: doctorId });
    if (!profile) {
      return res.status(404).json({ success: false, message: "Chưa có hồ sơ" });
    }
    const idx = profile.schedule.findIndex(d => d.dayOfWeek === day);
    if (idx < 0) {
      return res.status(404).json({ success: false, message: "Ngày này chưa có lịch để cập nhật" });
    }

    // ==== chuẩn hoá INLINE (giống ở trên) ====
    const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
    const toMinutes = (hhmm) => {
      const [h, m] = String(hhmm).split(":").map(Number);
      return h * 60 + m;
    };
    const normalizeOne = (raw, minWhenUsed = 5, max = 180) => {
      const start = raw?.start ?? raw?.startTime ?? raw?.from;
      const end   = raw?.end   ?? raw?.endTime   ?? raw?.to;

      if (!HHMM_RE.test(String(start)) || !HHMM_RE.test(String(end))) {
        throw new Error("Thời gian không đúng định dạng HH:MM");
      }
      if (toMinutes(start) >= toMinutes(end)) {
        throw new Error("Giờ bắt đầu phải nhỏ hơn giờ kết thúc");
      }

      const tRaw = (raw?.consultationType ?? raw?.type ?? "online").toString().toLowerCase();
      const type = ["online","offline","both"].includes(tRaw) ? tRaw : "online";
      const isAvailable = raw?.isAvailable !== false;

      const fromClientOnline =
        toNumberOr(raw?.timeForOnline) ??
        toNumberOr(raw?.onlinePerPatient) ??
        toNumberOr(raw?.onlineDurationPerPatient) ??
        toNumberOr(raw?.perPatientOnlineMinutes) ?? 0;

      const fromClientOffline =
        toNumberOr(raw?.timeForOffline) ??
        toNumberOr(raw?.offlinePerPatient) ??
        toNumberOr(raw?.offlineDurationPerPatient) ??
        toNumberOr(raw?.perPatientOfflineMinutes) ?? 0;

      let timeForOnline = 0, timeForOffline = 0;
      if (type === "online" || type === "both") {
        if (!Number.isFinite(fromClientOnline) || fromClientOnline < minWhenUsed || fromClientOnline > max) {
          throw new Error("Thời gian/1 người (Online) phải từ 5 đến 180 phút");
        }
        timeForOnline = Math.trunc(fromClientOnline);
      }
      if (type === "offline" || type === "both") {
        if (!Number.isFinite(fromClientOffline) || fromClientOffline < minWhenUsed || fromClientOffline > max) {
          throw new Error("Thời gian/1 người (Offline) phải từ 5 đến 180 phút");
        }
        timeForOffline = Math.trunc(fromClientOffline);
      }
      if (type === "online")  timeForOffline = 0;
      if (type === "offline") timeForOnline  = 0;

      return { start, end, consultationType: type, isAvailable, timeForOnline, timeForOffline };
    };

    if (!Array.isArray(timeSlots) || timeSlots.length === 0) {
      return res.status(400).json({ success: false, message: "timeSlots phải là mảng và không rỗng" });
    }
    const normalized = timeSlots
      .map(normalizeOne)
      .sort((a,b)=> toMinutes(a.start) - toMinutes(b.start));
    for (let i = 1; i < normalized.length; i++) {
      if (toMinutes(normalized[i-1].end) > toMinutes(normalized[i].start)) {
        return res.status(400).json({ success:false, message:"Các khung giờ trong ngày không được chồng lấn" });
      }
    }
    // ==== /chuẩn hoá ====

    profile.schedule[idx].timeSlots = normalized;
    profile.markModified("schedule");
    await profile.save();

    await populateProfile(profile);
    return res.status(200).json({
      success: true,
      message: "Cập nhật lịch thành công",
      data: { schedules: profile.schedule, profile },
    });
  } catch (err) {
    console.error("updateScheduleForDay error:", err);
    return res.status(400).json({ success: false, message: err.message || "Không thể cập nhật lịch" });
  }
},

  // Sao chép lịch (ghi đè ngày đích)
  copyScheduleToDays: async (req, res) => {
    try {
      const doctorId = req.user.userId;
      await ensureDoctorRole(doctorId);

      const { fromDayOfWeek, toDays } = req.body;
      const fromDay = Number(fromDayOfWeek);

      if (!isValidDay(fromDay)) {
        return res.status(400).json({
          success: false,
          message: `fromDayOfWeek phải trong [${DAY_MIN}..${DAY_MAX}]`,
        });
      }
      if (!Array.isArray(toDays) || toDays.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "toDays phải là mảng ngày hợp lệ" });
      }
      for (const d of toDays) {
        if (!isValidDay(Number(d))) {
          return res
            .status(400)
            .json({
              success: false,
              message: `Giá trị toDays không hợp lệ: ${d}`,
            });
        }
      }

      const profile = await DoctorProfile.findOne({ user: doctorId });
      if (!profile)
        return res
          .status(404)
          .json({ success: false, message: "Chưa có hồ sơ" });

      const src = profile.schedule.find((d) => d.dayOfWeek === fromDay);
      if (!src || !src.timeSlots?.length) {
        return res
          .status(404)
          .json({
            success: false,
            message: "Ngày nguồn chưa có lịch để sao chép",
          });
      }

      const sourceSlots = src.timeSlots.map((s) => ({ ...s }));

      for (const d of toDays.map(Number)) {
        const idx = profile.schedule.findIndex((x) => x.dayOfWeek === d);
        if (idx >= 0) profile.schedule[idx].timeSlots = sourceSlots;
        else profile.schedule.push({ dayOfWeek: d, timeSlots: sourceSlots });
      }

      profile.markModified("schedule");
      await profile.save();

      await populateProfile(profile);
      return res.status(200).json({
        success: true,
        message: "Sao chép lịch thành công",
        data: { schedules: profile.schedule, profile },
      });
    } catch (err) {
      console.error("copyScheduleToDays error:", err);
      return res
        .status(400)
        .json({
          success: false,
          message: err.message || "Không thể sao chép lịch",
        });
    }
  },

  // Thống kê đánh giá
  getMyRatingStats: async (req, res) => {
    try {
      const doctorId = req.user.userId;
      await ensureDoctorRole(doctorId);

      const profile = await DoctorProfile.findOne(
        { user: doctorId },
        { ratingStats: 1 }
      ).lean();
      if (!profile)
        return res
          .status(404)
          .json({ success: false, message: "Chưa có hồ sơ" });

      const {
        averageRating = 0,
        totalRatings = 0,
        lastRatingAt = null,
      } = profile.ratingStats || {};
      return res
        .status(200)
        .json({
          success: true,
          data: { averageRating, totalRatings, lastRatingAt },
        });
    } catch (err) {
      console.error("getMyRatingStats error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Không thể lấy thống kê đánh giá" });
    }
  },
  getDoctorProfileByUserId: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!mongoose.isValidObjectId(userId)) {
        return res
          .status(400)
          .json({ success: false, message: "userId không hợp lệ" });
      }

      const user = await User.findById(userId).select("role");
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy user" });
      if (user.role !== "doctor")
        return res
          .status(400)
          .json({ success: false, message: "User không phải bác sĩ" });

      const profile = await DoctorProfile.findOne({ user: userId })
        .select("specializations experience hospitalName") // thông tin chuyên môn + kinh nghiệm (+ bệnh viện nếu muốn)
        .populate({ path: "user", select: "fullName avatar" }); // chỉ tên + avatar

      if (!profile)
        return res
          .status(404)
          .json({ success: false, message: "Bác sĩ chưa tạo hồ sơ" });

      return res.status(200).json({
        success: true,
        data: {
          user: {
            _id: profile.user?._id,
            fullName: profile.user?.fullName || "",
            avatar: profile.user?.avatar || null,
          },
          specializations: profile.specializations ?? "",
          experience: profile.experience ?? 0,
          hospitalName: profile.hospitalName ?? "",
        },
      });
    } catch (err) {
      console.error("getDoctorProfileByUserId error:", err?.stack || err);
      return res
        .status(500)
        .json({ success: false, message: "Không thể lấy thông tin bác sĩ" });
    }
  },


  getDoctorPublicWeeklySchedule: async (req, res) => {
    try {
      const { userId } = req.params;
      const { weekday } = req.query;

      const profile = await DoctorProfile.findOne({ user: userId }, { schedule: 1, consultationFees: 1 }).lean();
      if (!profile)
        return res.status(404).json({ success: false, message: "Bác sĩ chưa tạo hồ sơ" });

      if (weekday) {
        const day = Number(weekday);
        if (!isValidDay(day)) {
          return res.status(400).json({ success: false, message: `weekday phải trong [${DAY_MIN}..${DAY_MAX}]` });
        }
        const dayEntry = profile.schedule?.find((d) => d.dayOfWeek === day) || { dayOfWeek: day, timeSlots: [] };
        return res.status(200).json({ success: true, data: { consultationFees: profile.consultationFees, schedule: [dayEntry] } });
      }

      return res.status(200).json({ success: true, data: { consultationFees: profile.consultationFees, schedule: profile.schedule || [] } });
    } catch (err) {
      console.error("getDoctorPublicWeeklySchedule error:", err);
      return res.status(500).json({ success: false, message: "Không thể lấy lịch tuần" });
    }
  },

  getDoctorDailySlots: async (req, res) => {
    try {
      const { userId } = req.params;
      const { date } = req.query; // YYYY-MM-DD

      if (!date) return res.status(400).json({ success: false, message: "Thiếu date (YYYY-MM-DD)" });

      const jsDate = new Date(`${date}T00:00:00.000Z`);
      const weekdayNum = toSchemaWeekdayNumber(jsDate.getUTCDay()); // 2..8

      const profile = await DoctorProfile.findOne({ user: userId }, { schedule: 1 }).lean();
      if (!profile)
        return res.status(404).json({ success: false, message: "Bác sĩ chưa tạo hồ sơ" });

      const dayEntry = profile.schedule?.find((d) => d.dayOfWeek === weekdayNum);
      const list = (dayEntry?.timeSlots || []).map((s, idx) => ({
        id: `${date}-${idx + 1}`,
        label: timeLabel(s.start, s.end),
        status: s.isAvailable ? "available" : "booked", // nếu có Appointment thì thay tính thực
        consultationType: s.consultationType,
        maxPatients: s.maxPatients ?? 1,
      }));

      return res.status(200).json({ success: true, data: { date, weekday: weekdayNum, slots: list } });
    } catch (err) {
      console.error("getDoctorDailySlots error:", err);
      return res.status(500).json({ success: false, message: "Không thể lấy slot theo ngày" });
    }
  },
  listDoctorReviews: async (req, res) => {
    try {
      const { userId } = req.params;
      const { cursor, limit = 20 } = req.query;

      const doctorUser = await User.findById(userId).select("_id role");
      if (!doctorUser) return res.status(404).json({ success: false, message: "Không tìm thấy bác sĩ" });

      const find = Rating.find({
        reviewee: userId,
        ratingType: "doctor_profile",
        status: "active",
      })
        .populate({ path: "reviewer", select: "fullName avatar" })
        .sort({ _id: -1 })
        .limit(Math.min(Number(limit), 50));

      if (cursor) {
        find.where({ _id: { $lt: new mongoose.Types.ObjectId(cursor) } });
      }

      const items = await find.lean();
      const nextCursor = items.length ? items[items.length - 1]._id : null;

      const mapped = items.map((r) => ({
        id: r._id,
        author: r.reviewer?.fullName || "Người dùng ẩn danh",
        authorAvatar: r.reviewer?.avatar || null,
        rating: r.rating,
        content: r.comment || "",
        date: new Date(r.createdAt).toLocaleDateString("vi-VN"),
      }));

      return res.status(200).json({ success: true, data: { items: mapped, nextCursor } });
    } catch (err) {
      console.error("listDoctorReviews error:", err);
      return res.status(500).json({ success: false, message: "Không thể lấy danh sách đánh giá" });
    }
  },

  createDoctorReview: async (req, res) => {
    try {
      const { userId } = req.params; // bác sĩ được đánh giá
      const { rating, comment } = req.body;
      const reviewerId = req.user?.userId || req.body.reviewerId;

      if (!reviewerId) return res.status(401).json({ success: false, message: "Unauthorized" });
      if (!rating || rating < 1 || rating > 5)
        return res.status(400).json({ success: false, message: "rating phải trong khoảng 1..5" });

      const profile = await DoctorProfile.findOne({ user: userId }).select("_id ratingStats").lean();
      if (!profile) return res.status(404).json({ success: false, message: "Bác sĩ chưa tạo hồ sơ" });

      // (tùy chọn) kiểm tra reviewer đã từng có appointment DONE với bác sĩ

      const doc = await Rating.create({
        reviewer: reviewerId,
        reviewee: userId,
        ratingType: "doctor_profile",
        rating,
        comment: comment?.trim() || "",
        status: "active",
      });

      // update gộp ratingStats
      const stats = profile.ratingStats || { averageRating: 0, totalRatings: 0 };
      const newTotal = (stats.totalRatings || 0) + 1;
      const newAvg =
        ((stats.averageRating || 0) * (stats.totalRatings || 0) + rating) /
        newTotal;

      await DoctorProfile.updateOne(
        { _id: profile._id },
        {
          $set: {
            "ratingStats.averageRating": Number(newAvg.toFixed(2)),
            "ratingStats.totalRatings": newTotal,
            "ratingStats.lastRatingAt": new Date(),
          },
        }
      );

      return res.status(201).json({
        success: true,
        data: {
          id: doc._id,
          rating: doc.rating,
          content: doc.comment,
          date: new Date(doc.createdAt).toLocaleDateString("vi-VN"),
        },
      });
    } catch (err) {
      console.error("createDoctorReview error:", err);
      return res.status(500).json({ success: false, message: "Không thể tạo đánh giá" });
    }
  },

  getDoctorRatingSummary: async (req, res) => {
    try {
      const { userId } = req.params;

      const profile = await DoctorProfile.findOne({ user: userId }).select("_id ratingStats").lean();
      if (!profile) return res.status(404).json({ success: false, message: "Bác sĩ chưa tạo hồ sơ" });

      const rows = await Rating.aggregate([
        { $match: { reviewee: new mongoose.Types.ObjectId(userId), ratingType: "doctor_profile", status: "active" } },
        { $group: { _id: "$rating", count: { $sum: 1 } } },
      ]);

      const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      rows.forEach((r) => (breakdown[r._id] = r.count));

      const { averageRating = 0, totalRatings = 0, lastRatingAt } =
        profile.ratingStats || {};
      return res.status(200).json({
        success: true,
        data: {
          avg: averageRating,
          total: totalRatings,
          breakdown,
          lastRatingAt,
        },
      });
    } catch (err) {
      console.error("getDoctorRatingSummary error:", err);
      return res.status(500).json({ success: false, message: "Không thể lấy thống kê đánh giá" });
    }
  },

  getDoctorActivitySummary: async (req, res) => {
    try {
      const { userId } = req.params;
      const profile = await DoctorProfile.findOne({ user: userId }).select("stats").lean();
      if (!profile)
        return res.status(404).json({ success: false, message: "Bác sĩ chưa tạo hồ sơ" });

      const s = profile.stats || {};
      return res.status(200).json({
        success: true,
        data: {
          consults: s.totalConsultations || 0,
          patients: s.totalPatients || 0,
          avgMinutes: s.averageConsultationDuration || 0,
          revenue: s.totalEarnings || 0,
          lastConsultationDate: s.lastConsultationDate || null,
        },
      });
    } catch (err) {
      console.error("getDoctorActivitySummary error:", err);
      return res.status(500).json({ success: false, message: "Không thể lấy thống kê hoạt động" });
    }
  },





  deleteSchedule: async (req, res) => {
  try {
    const doctorId = req.user?.userId;
    console.log('[deleteSchedule] IN:', { userId: doctorId, body: req.body, query: req.query });

    await ensureDoctorRole(doctorId);

    const day = Number(req.body?.dayOfWeek ?? req.query?.dayOfWeek);
    const slotId = req.body?.slotId ?? req.query?.slotId;

    console.log('[deleteSchedule] parsed:', { day, slotId });

    const profile = await DoctorProfile.findOne({ user: doctorId });
    if (!profile) return res.status(404).json({ success: false, message: 'Chưa có hồ sơ' });

    const idx = profile.schedule.findIndex(d => d.dayOfWeek === day);
    console.log('[deleteSchedule] found day index:', idx);

    if (idx < 0) return res.status(404).json({ success: false, message: 'Ngày chưa có lịch' });

    if (slotId) {
      const before = profile.schedule[idx].timeSlots.length;
      profile.schedule[idx].timeSlots = profile.schedule[idx].timeSlots.filter(s =>
        (s._id?.toString?.() ?? s.id?.toString?.() ?? s.slotId?.toString?.()) !== slotId.toString()
      );
      const after = profile.schedule[idx].timeSlots.length;
      console.log('[deleteSchedule] remove slotId:', slotId, 'count:', before, '->', after);
      if (after === 0) {
        // nếu xoá hết slot thì xoá luôn ngày khỏi mảng
        profile.schedule.splice(idx, 1);
        console.log('[deleteSchedule] removed whole day because no slots left');
      }
    } else {
      // xoá cả ngày
      profile.schedule.splice(idx, 1);
      console.log('[deleteSchedule] removed whole day');
    }

    profile.markModified('schedule');
    await profile.save();

    // Trả về lịch mới để FE đồng bộ
    await profile.populate({ path: 'user', select: 'fullName username avatar email role' });
    console.log('[deleteSchedule] OUT: ok');
    return res.status(200).json({
      success: true,
      message: 'Đã xoá lịch',
      data: { schedules: profile.schedule, profile },
    });
  } catch (err) {
    console.error('[deleteSchedule] ERROR:', err);
    return res.status(400).json({ success: false, message: err.message || 'Không thể xoá lịch' });
  }
},

};

module.exports = DoctorController;
