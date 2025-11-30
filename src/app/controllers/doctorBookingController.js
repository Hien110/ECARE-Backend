// controllers/DoctorBookingController.js
const mongoose = require("mongoose");

const Relationship = require("../models/Relationship");
const ElderlyProfile = require("../models/ElderlyProfile");
const User = require("../models/User");
const HealthPackage = require("../models/HealthPackage");
const DoctorProfile = require("../models/DoctorProfile");
const Consultation = require("../models/Consultation");
const Payment = require("../models/Payment");
const RegistrationHealthPackage = require("../models/RegistrationHealthPackage");

// helper: lấy userId từ req.user (_id / id / userId)
function getUserIdFromReq(req) {
  if (!req || !req.user) return null;
  return req.user._id || req.user.id || req.user.userId || null;
}

function calcServicePeriod(durationDays, startDateInput) {
  if (!durationDays || durationDays <= 0) {
    throw new Error("Invalid durationDays");
  }
  const start = startDateInput ? new Date(startDateInput) : new Date();
  if (Number.isNaN(start.getTime())) {
    throw new Error("Invalid startDate");
  }
  const end = new Date(start);
  end.setDate(end.getDate() + durationDays - 1);
  return { start, end };
}

const DoctorBookingController = {
  // Bước 1: danh sách elderly đã kết nối
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

  // Bước 2: danh sách gói khám
  listHealthPackages: async (req, res) => {
    try {
      const packages = await HealthPackage.find({ isActive: true })
        .select(
          "title durationDays durations price service description isActive",
        )
        .sort({ createdAt: -1 })
        .lean();

      return res.json({ success: true, data: packages });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi lấy danh sách gói khám sức khoẻ",
      });
    }
  },

  // Bước 2 (chi tiết): 1 gói khám
  getHealthPackageDetail: async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res
          .status(400)
          .json({ success: false, message: "Thiếu id gói khám" });
      }

      const pkg = await HealthPackage.findById(id)
        .select("title durationDays durations price service description isActive")
        .lean();

      if (!pkg || !pkg.isActive) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy gói khám" });
      }

      return res.json({ success: true, data: pkg });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi lấy chi tiết gói khám",
      });
    }
  },

  /**
   * Bước 4: Lấy danh sách bác sĩ đang làm gói + chưa bị đặt trùng thời gian
   * GET /doctor-booking/available-doctors?healthPackageId=&durationDays=&startDate=&specialization=
   */
  getAvailableDoctors: async (req, res) => {
    try {
      const {
        healthPackageId,
        durationDays: durationInput,
        startDate,
        specialization,
      } = req.query;

      if (!healthPackageId || !durationInput || !startDate) {
        return res.status(400).json({
          success: false,
          message:
            "Thiếu healthPackageId, durationDays hoặc startDate trong query",
        });
      }

      const durationDays = Number(durationInput);

      if (!durationDays || durationDays <= 0) {
        return res
          .status(400)
          .json({ success: false, message: "durationDays không hợp lệ" });
      }

      const pkg = await HealthPackage.findById(healthPackageId).lean();

      if (!pkg || !pkg.isActive) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy gói khám" });
      }

      const { start, end } = calcServicePeriod(durationDays, startDate);

      const doctorUsers = await User.find({
        role: "doctor",
        isActive: { $ne: false },
      })
        .select("fullName avatar gender isActive role")
        .lean();

      if (!doctorUsers.length) {
        return res.json({
          success: true,
          data: {
            package: {
              _id: pkg._id,
              title: pkg.title,
              price: pkg.price,
              durations: pkg.durations,
            },
            period: { start, end, durationDays },
            doctors: [],
          },
        });
      }

      const doctorIds = doctorUsers.map((u) => String(u._id));

      const busyConsultations = await Consultation.find({
        doctor: { $in: doctorIds },
        status: { $in: ["scheduled", "confirmed", "in_progress"] },
        $or: [
          {
            "packageInfo.startDate": { $lte: end },
            "packageInfo.endDate": { $gte: start },
          },
          {
            startDate: { $lte: end },
            endDate: { $gte: start },
          },
        ],
      })
        .select("doctor status packageInfo startDate endDate")
        .lean();

      const busyDoctorIdsFromCons = new Set(
        busyConsultations
          .map((c) => (c.doctor ? String(c.doctor) : null))
          .filter(Boolean),
      );

      const busyRegs = await RegistrationHealthPackage.find({
        doctor: { $in: doctorIds },
        isActive: true,
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gte: start } },
        ],
      })
        .select("doctor expiresAt isActive status")
        .lean();

      const busyDoctorIdsFromRegs = new Set(
        busyRegs
          .map((r) => (r.doctor ? String(r.doctor) : null))
          .filter(Boolean),
      );

      const busyDoctorIds = new Set([
        ...Array.from(busyDoctorIdsFromCons),
        ...Array.from(busyDoctorIdsFromRegs),
      ]);

      const availableDoctorIds = doctorIds.filter(
        (id) => !busyDoctorIds.has(id),
      );

      if (!availableDoctorIds.length) {
        return res.json({
          success: true,
          data: {
            package: {
              _id: pkg._id,
              title: pkg.title,
              price: pkg.price,
              durations: pkg.durations,
            },
            period: { start, end, durationDays },
            doctors: [],
          },
        });
      }

      const profiles = await DoctorProfile.find({
        user: { $in: availableDoctorIds },
      })
        .select(
          "user specializations experience hospitalName ratingStats consultationFees",
        )
        .lean();

      const profileMap = new Map();
      profiles.forEach((p) => {
        profileMap.set(String(p.user), p);
      });

      let doctors = availableDoctorIds
        .map((id) => {
          const user = doctorUsers.find((u) => String(u._id) === id);
          if (!user) {
            return null;
          }

          if (user.role !== "doctor" || user.isActive === false) {
            return null;
          }

          const profile = profileMap.get(id);

          return {
            doctorId: user._id,
            fullName: user.fullName,
            avatar: user.avatar,
            gender: user.gender,
            specializations: profile?.specializations || [],
            experience: profile?.experience,
            hospitalName: profile?.hospitalName,
            ratingStats: profile?.ratingStats,
            consultationFees: profile?.consultationFees,
          };
        })
        .filter(Boolean);

      if (specialization) {
        const keyword = String(specialization).toLowerCase();
        doctors = doctors.filter((doc) => {
          const specs = Array.isArray(doc.specializations)
            ? doc.specializations
            : [];
          return specs.some((s) =>
            String(s).toLowerCase().includes(keyword),
          );
        });
      }

      return res.json({
        success: true,
        data: {
          package: {
            _id: pkg._id,
            title: pkg.title,
            price: pkg.price,
            durations: pkg.durations,
          },
          period: { start, end, durationDays },
          doctors,
        },
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi lấy danh sách bác sĩ khả dụng",
      });
    }
  },

  // Bước 5: chi tiết bác sĩ
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

  // Bước 6: Đặt gói khám
  createBooking: async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const LOG_TAG = "[DoctorBookingController][createBooking]";

  try {
    const rawUser = req.user || {};
    const familyId = rawUser._id || rawUser.id || rawUser.userId || null;
    const role = rawUser.role || null;
    const isFamily = role === "family";
    const isElderly = role === "elderly";

    const {
      elderlyId,
      healthPackageId,
      durationDays: durationInput,
      startDate,
      doctorId,
      paymentMethod,
    } = req.body || {};

    console.log(LOG_TAG, "START createBooking with data:", {
      user: { id: familyId, role },
      body: {
        elderlyId,
        healthPackageId,
        durationInput,
        startDate,
        doctorId,
        paymentMethod,
      },
    });

    // --- 1. Auth / Role ---
    if (!familyId) {
      console.warn(LOG_TAG, "Unauthorized: missing user id in req.user");
      await session.abortTransaction();
      session.endSession();
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized" });
    }

    if (!isFamily && !isElderly) {
      console.warn(LOG_TAG, "Forbidden: invalid role for booking:", role);
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message:
          "Chỉ tài khoản người thân hoặc người cao tuổi mới được đặt gói khám",
      });
    }

    // --- 2. Validate body ---
    if (
      !elderlyId ||
      !healthPackageId ||
      !durationInput ||
      !startDate ||
      !doctorId
    ) {
      console.warn(LOG_TAG, "BadRequest: missing required fields", {
        elderlyId,
        healthPackageId,
        durationInput,
        startDate,
        doctorId,
      });
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message:
          "Thiếu elderlyId, healthPackageId, durationDays, startDate hoặc doctorId",
      });
    }

    // Elderly chỉ được đặt cho chính mình
    if (isElderly && String(elderlyId) !== String(familyId)) {
      console.warn(
        LOG_TAG,
        "Forbidden: elderly trying to book for another elderly",
        { elderlyId, userId: familyId },
      );
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Bạn chỉ có thể đặt gói khám cho chính mình.",
      });
    }

    const durationDays = Number(durationInput);
    if (!durationDays || durationDays <= 0) {
      console.warn(LOG_TAG, "BadRequest: invalid durationDays", {
        durationInput,
        durationDays,
      });
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: "durationDays không hợp lệ" });
    }

    // --- 3. Check Relationship nếu là Family ---
    if (isFamily) {
      console.log(LOG_TAG, "Checking relationship for family booking", {
        familyId,
        elderlyId,
      });

      const relationship = await Relationship.findOne({
        elderly: elderlyId,
        family: familyId,
        status: "accepted",
      })
        .session(session)
        .lean();

      console.log(LOG_TAG, "Relationship result =", relationship);

      if (!relationship) {
        console.warn(
          LOG_TAG,
          "Forbidden: no accepted relationship between family & elderly",
          { familyId, elderlyId },
        );
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message:
            "Bạn không có quyền đặt dịch vụ cho người cao tuổi này (chưa kết nối hoặc bị hạn chế quyền).",
        });
      }
    }

    // --- 4. Lấy gói khám ---
    console.log(LOG_TAG, "Finding health package", { healthPackageId });

    const pkg = await HealthPackage.findById(healthPackageId)
      .session(session)
      .lean();

    console.log(LOG_TAG, "HealthPackage =", pkg);

    if (!pkg || !pkg.isActive) {
      console.warn(LOG_TAG, "HealthPackage not found or inactive");
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy gói khám" });
    }

    const { start, end } = calcServicePeriod(durationDays, startDate);
    console.log(LOG_TAG, "Service period =", { start, end, durationDays });

    // --- 5. Check bác sĩ ---
    console.log(LOG_TAG, "Finding doctor user", { doctorId });

    const doctorUser = await User.findById(doctorId)
      .select("role isActive fullName")
      .session(session);

    console.log(LOG_TAG, "DoctorUser =", doctorUser);

    if (
      !doctorUser ||
      doctorUser.role !== "doctor" ||
      doctorUser.isActive === false
    ) {
      console.warn(LOG_TAG, "Doctor invalid for booking");
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Bác sĩ không hợp lệ" });
    }

    // --- 6. Check trùng lịch ---
    console.log(LOG_TAG, "Checking overlapping consultations...");

    const overlapping = await Consultation.find({
      doctor: doctorId,
      scheduledDate: {
        $gte: start,
        $lte: end,
      },
      status: { $in: ["scheduled", "confirmed", "in_progress"] },
    })
      .session(session)
      .lean();

    console.log(LOG_TAG, "Overlapping consultations =", overlapping.length);

    if (overlapping.length > 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message:
          "Bác sĩ này đã được đặt trong khoảng ngày này, vui lòng chọn bác sĩ khác hoặc ngày khác.",
      });
    }

    // --- 7. Lấy giá đúng theo duration ---
    const durationsArr = Array.isArray(pkg.durations) ? pkg.durations : [];
    console.log(LOG_TAG, "Durations in package =", durationsArr);

    const matchedDuration =
      durationsArr.find((d) => Number(d.days) === durationDays) || null;

    if (!matchedDuration) {
      console.warn(LOG_TAG, "No duration option matched requested days", {
        durationDays,
        durationsArr,
      });
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message:
          "Không tìm thấy mức giá cho thời lượng gói này, vui lòng liên hệ quản trị viên.",
      });
    }

    const pkgPrice = matchedDuration.fee;
    const parsedPrice = Number(pkgPrice);

    console.log(LOG_TAG, "Raw package price from durations =", {
      durationDays,
      pkgPrice,
      parsedPrice,
    });

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      console.warn(LOG_TAG, "Invalid package price, cannot create booking", {
        pkgPrice,
        parsedPrice,
      });
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message:
          "Giá gói khám không hợp lệ, vui lòng liên hệ quản trị viên.",
      });
    }

    const consultationFee = parsedPrice;
    const totalAmount = consultationFee;

    const now = new Date();
    const payMethod = paymentMethod || "cash";
    const registrantId = isFamily ? familyId : elderlyId;

    // ✅ phân loại phương thức online vs tiền mặt
    const isOnlineMethod =
      payMethod === "qr" ||
      payMethod === "online" ||
      payMethod === "bank_transfer";

    console.log(LOG_TAG, "Payment method resolve =", {
      payMethod,
      isOnlineMethod,
    });

    // --- 8. Tạo RegistrationHealthPackage ---
    console.log(LOG_TAG, "Creating RegistrationHealthPackage...", {
      registrantId,
      elderlyId,
      doctorId,
      healthPackageId,
      totalAmount,
      payMethod,
    });

    const [registration] = await RegistrationHealthPackage.create(
      [
        {
          packageRef: healthPackageId,
          doctor: doctorId,
          registrant: registrantId,
          beneficiary: elderlyId,
          registeredAt: now,
          startDate: start,
          endDate: end,
          expiresAt: end,
          isActive: true,
          durationDays,
          price: totalAmount,
          currency: "VND",
          status: "confirmed",
          notes: `Đăng ký gói ${pkg.title} (${durationDays} ngày) cho elderly ${elderlyId}`,
        },
      ],
      { session },
    );

    console.log(LOG_TAG, "Registration created =", registration?._id);

    // --- 9. Tạo Consultation (gắn registration) ---
    const [consultation] = await Consultation.create(
      [
        {
          elderly: elderlyId,
          doctor: doctorId,
          bookedBy: registrantId,

          // 🔗 rất quan trọng để join lịch sau này
          registration: registration._id,

          consultationType: "online",
          specialization: "Gói khám sức khoẻ",
          symptoms: [],
          reason: `Đặt gói ${pkg.title} trong ${durationDays} ngày`,
          scheduledDate: start,
          timeSlot: { start: null, end: null },
          location: { address: "" },
          status: "scheduled",
          pricing: {
            consultationFee,
            totalAmount,
            currency: "VND",
          },
          payment: {
            method: payMethod,
            // ✅ ONLINE (QR/online/bank_transfer): coi là đã thanh toán
            // ✅ CASH: pending (chưa thanh toán)
            status: isOnlineMethod ? "completed" : "pending",
            transactionId: undefined,
            paidAt: isOnlineMethod ? now : null,
          },
          bookedAt: now,
        },
      ],
      { session },
    );

    console.log(LOG_TAG, "Consultation created =", consultation?._id);

    // --- 10. Tạo Payment ---
    const transactionId = `CONS-${consultation._id}-${Date.now()}`;

    const [payment] = await Payment.create(
      [
        {
          user: registrantId,
          serviceType: "consultation",
          serviceId: consultation._id,
          serviceModel: "Consultation",
          amount: totalAmount,
          currency: "VND",
          paymentMethod: payMethod,
          transactionId,
          // ✅ ONLINE: completed, ✅ CASH: pending
          status: isOnlineMethod ? "completed" : "pending",
          fees: {
            serviceFee: 0,
            platformFee: 0,
            paymentGatewayFee: 0,
            discount: 0,
          },
          totalAmount,
          netAmount: totalAmount,
          initiatedAt: now,
          completedAt: isOnlineMethod ? now : null,
          notes: `Thanh toán gói ${pkg.title} cho elderly ${elderlyId}`,
        },
      ],
      { session },
    );

    console.log(LOG_TAG, "Payment created =", payment?._id);

    // Gắn transactionId vào consultation
    consultation.payment.transactionId = transactionId;
    await consultation.save({ session });

    console.log(
      LOG_TAG,
      "Consultation updated with transactionId =",
      transactionId,
    );

    // --- 11. Commit ---
    await session.commitTransaction();
    session.endSession();

    console.log(LOG_TAG, "Booking success, returning 201");

    return res.status(201).json({
      success: true,
      message: "Đặt gói khám & thanh toán thành công.",
      data: {
        registration,
        consultation,
        payment,
      },
    });
  } catch (err) {
    console.error(
      LOG_TAG,
      "UNHANDLED ERROR in createBooking:",
      err?.message,
      err,
    );
    try {
      await session.abortTransaction();
    } catch (e) {
      console.error(LOG_TAG, "Error when abortTransaction:", e);
    }
    session.endSession();
    return res.status(500).json({
      success: false,
      message: "Không thể tạo booking, vui lòng thử lại sau",
    });
  }
},

  // Bước 7: lịch sử đặt lịch của user hiện tại
  getMyBookings: async (req, res) => {
  try {
    const userId =
      (req.user && (req.user._id || req.user.id || req.user.userId)) || null;
    const role = (req.user?.role || "").toLowerCase();

    console.log("[DoctorBookingController][getMyBookings] user =", {
      userId,
      role,
    });

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized" });
    }

    const baseQuery = {
      isActive: true,
    };

    if (role === "elderly") {
      baseQuery.$or = [{ registrant: userId }, { beneficiary: userId }];
    } else {
      baseQuery.registrant = userId;
    }

    console.log(
      "[DoctorBookingController][getMyBookings] query =",
      JSON.stringify(baseQuery),
    );

    let registrations = await RegistrationHealthPackage.find(baseQuery)
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

    console.log(
      "[DoctorBookingController][getMyBookings] RAW_COUNT =",
      registrations.length,
    );

    // ==== Bổ sung registrant object đầy đủ nếu chỉ là ObjectId ====
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

    // ==== JOIN Consultation + Payment để FE có payment.method / payment.status ====
    const regIds = registrations.map((r) => String(r._id));

    const consultations = await Consultation.find({
      registration: { $in: regIds },
    })
      .select("_id status payment registration scheduledDate bookedAt")
      .lean();

    const consByRegId = new Map();
    consultations.forEach((c) => {
      if (c.registration) {
        consByRegId.set(String(c.registration), c);
      }
    });

    const consIds = consultations.map((c) => String(c._id));
    const payments = await Payment.find({
      serviceType: "consultation",
      serviceId: { $in: consIds },
    })
      .select("_id serviceId paymentMethod status transactionId")
      .lean();

    const payByConsId = new Map();
    payments.forEach((p) => {
      payByConsId.set(String(p.serviceId), p);
    });

    const merged = registrations.map((reg) => {
      const regIdStr = String(reg._id);
      const cons = consByRegId.get(regIdStr);
      const pay = cons ? payByConsId.get(String(cons._id)) : null;

      const paymentObj =
        pay &&
        {
          method: pay.paymentMethod,
          status: pay.status,
          transactionId: pay.transactionId,
        };

      console.log(
        "[DoctorBookingController][getMyBookings][MERGE]",
        regIdStr,
        {
          consultationId: cons?._id,
          consultationStatus: cons?.status,
          paymentMethod: pay?.paymentMethod,
          paymentStatus: pay?.status,
        },
      );

      return {
        ...reg,
        consultation: cons || undefined,
        payment: paymentObj || undefined,
        // cho FE fallback
        paymentMethod: pay?.paymentMethod,
        paymentStatus: pay?.status,
      };
    });

    return res.json({
      success: true,
      data: merged,
    });
  } catch (err) {
    console.error("[DoctorBookingController][getMyBookings][ERROR]", err);
    return res.status(500).json({
      success: false,
      message: "Lỗi lấy lịch khám bác sĩ",
    });
  }
},

  // Chi tiết RegistrationHealthPackage
  getRegistrationDetail: async (req, res) => {
  try {
    const { id } = req.params || {};
    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Thiếu id đăng ký gói khám" });
    }

    let registration = await RegistrationHealthPackage.findById(id)
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

    console.log(
      "[DoctorBookingController][getRegistrationDetail] raw registrant =",
      registration.registrant,
    );

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

    // ==== JOIN Consultation + Payment cho màn chi tiết ====
    const cons = await Consultation.findOne({
      registration: registration._id,
    })
      .select(
        "_id status payment payment.method payment.status payment.transactionId scheduledDate bookedAt registration",
      )
      .lean();

    let paymentObj;
    if (cons) {
      const pay = await Payment.findOne({
        serviceType: "consultation",
        serviceId: cons._id,
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
    }

    const result = {
      ...registration,
      consultation: cons || undefined,
      payment: paymentObj || undefined,
      paymentMethod: paymentObj?.method,
      paymentStatus: paymentObj?.status,
    };

    console.log(
      "[DoctorBookingController][getRegistrationDetail][MERGED] id =",
      id,
      {
        consultationId: cons?._id,
        consultationStatus: cons?.status,
        paymentMethod: paymentObj?.method,
        paymentStatus: paymentObj?.status,
      },
    );

    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error(
      "[DoctorBookingController][getRegistrationDetail][ERROR]",
      err,
    );
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

    console.log(
      "[DoctorBookingController][getBookingsByElderlyId] params =",
      { elderlyId },
    );
    console.log(
      "[DoctorBookingController][getBookingsByElderlyId] requester =",
      { requesterId, role },
    );

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

    console.log(
      "[DoctorBookingController][getBookingsByElderlyId] query =",
      JSON.stringify(query),
    );

    let registrations = await RegistrationHealthPackage.find(query)
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

    console.log(
      "[DoctorBookingController][getBookingsByElderlyId] RAW_COUNT =",
      registrations.length,
    );

    // ==== đảm bảo registrant là object User ====
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

    // ==== JOIN Consultation + Payment (QUAN TRỌNG CHO UI) ====
    const regIds = registrations.map((r) => String(r._id));

    const consultations = await Consultation.find({
      registration: { $in: regIds },
    })
      .select("_id status payment registration scheduledDate bookedAt")
      .lean();

    const consByRegId = new Map();
    consultations.forEach((c) => {
      if (c.registration) {
        consByRegId.set(String(c.registration), c);
      }
    });

    const consIds = consultations.map((c) => String(c._id));
    const payments = await Payment.find({
      serviceType: "consultation",
      serviceId: { $in: consIds },
    })
      .select("_id serviceId paymentMethod status transactionId")
      .lean();

    const payByConsId = new Map();
    payments.forEach((p) => {
      payByConsId.set(String(p.serviceId), p);
    });

    const merged = registrations.map((reg) => {
      const regIdStr = String(reg._id);
      const cons = consByRegId.get(regIdStr);
      const pay = cons ? payByConsId.get(String(cons._id)) : null;

      const paymentObj =
        pay &&
        {
          method: pay.paymentMethod,
          status: pay.status,
          transactionId: pay.transactionId,
        };

      console.log(
        "[DoctorBookingController][getBookingsByElderlyId][MERGE]",
        regIdStr,
        {
          consultationId: cons?._id,
          consultationStatus: cons?.status,
          paymentMethod: pay?.paymentMethod,
          paymentStatus: pay?.status,
        },
      );

      return {
        ...reg,
        consultation: cons || undefined,
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
    console.error(
      "[DoctorBookingController][getBookingsByElderlyId][ERROR]",
      err,
    );
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
    const reason = req.body?.reason || "Người dùng yêu cầu hủy";

    console.log(
      LOG_TAG,
      "==== START ====",
      "\nregistrationId =", registrationId,
      "\nuserId        =", userId,
      "\nbody          =", req.body
    );

    if (!registrationId) {
      console.log(LOG_TAG, "❌ Thiếu registrationId");
      return res
        .status(400)
        .json({ success: false, message: "Thiếu id lịch tư vấn (registrationId)" });
    }

    if (!userId) {
      console.log(LOG_TAG, "❌ Không có userId (chưa đăng nhập)");
      return res
        .status(401)
        .json({ success: false, message: "Bạn chưa đăng nhập" });
    }

    const registration = await RegistrationHealthPackage
      .findById(registrationId)
      .session(session);

    if (!registration) {
      console.log(LOG_TAG, "❌ Không tìm thấy registration với id =", registrationId);
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy lịch tư vấn" });
    }

    console.log(
      LOG_TAG,
      "✅ FOUND registration:",
      "\n  _id          =", registration._id.toString(),
      "\n  status       =", registration.status,
      "\n  registrant   =", registration.registrant,
      "\n  beneficiary  =", registration.beneficiary
    );

    const userIdStr = String(userId);
    const registrantStr = String(registration.registrant || "");
    const beneficiaryStr = String(registration.beneficiary || "");
    const role = req.user?.role;

    const isOwner =
      userIdStr === registrantStr || userIdStr === beneficiaryStr;
    const isAdmin = role === "admin";

    console.log(LOG_TAG, "Check quyền:", {
      userIdStr,
      registrantStr,
      beneficiaryStr,
      role,
      isOwner,
      isAdmin,
    });

    if (!isOwner && !isAdmin) {
      console.log(LOG_TAG, "❌ FORBIDDEN: user không có quyền hủy registration này");
      return res
        .status(403)
        .json({ success: false, message: "Bạn không có quyền hủy lịch này" });
    }

    if (registration.status === "cancelled") {
      console.log(LOG_TAG, "ℹ️ Registration đã ở trạng thái 'cancelled' trước đó");
      return res.json({
        success: true,
        data: registration,
        message: "Lịch tư vấn đã được hủy trước đó",
      });
    }

    await session.startTransaction();
    console.log(LOG_TAG, "🚀 Bắt đầu transaction");

    registration.status = "cancelled";
    registration.cancelledAt = new Date();
    registration.cancelReason = reason;

    await registration.save({ session });

    console.log(
      LOG_TAG,
      "✅ Sau khi save registration:",
      "\n  _id    =", registration._id.toString(),
      "\n  status =", registration.status
    );

    // 🔗 tìm consultation theo field registration
    const consultation = await Consultation.findOne({
      registration: registration._id,
    }).session(session);

    if (consultation) {
      console.log(
        LOG_TAG,
        "FOUND consultation:",
        "\n  _id    =", consultation._id.toString(),
        "\n  status =", consultation.status
      );

      consultation.status = "cancelled";
      await consultation.save({ session });

      console.log(
        LOG_TAG,
        "✅ Sau khi save consultation:",
        "\n  _id    =", consultation._id.toString(),
        "\n  status =", consultation.status
      );

      const payment = await Payment.findOne({
        serviceType: "consultation",
        serviceId: consultation._id,
      }).session(session);

      if (payment) {
        console.log(
          LOG_TAG,
          "FOUND payment:",
          "\n  _id    =", payment._id.toString(),
          "\n  status =", payment.status
        );

        if (payment.status !== "refunded" && payment.status !== "cancelled") {
          payment.status = "cancelled";
          payment.cancelledAt = new Date();
          await payment.save({ session });

          console.log(
            LOG_TAG,
            "✅ Sau khi save payment:",
            "\n  _id    =", payment._id.toString(),
            "\n  status =", payment.status
          );
        } else {
          console.log(
            LOG_TAG,
            "Payment đã ở trạng thái",
            payment.status,
            "=> không đổi nữa"
          );
        }
      } else {
        console.log(LOG_TAG, "ℹ️ Không tìm thấy payment cho consultation này");
      }
    } else {
      console.log(
        LOG_TAG,
        "ℹ️ Không tìm thấy consultation nào gắn với registrationId này"
      );
    }

    await session.commitTransaction();
    session.endSession();
    console.log(LOG_TAG, "🎉 COMMIT transaction xong");

    const updatedRegistration =
      await RegistrationHealthPackage.findById(registrationId)
        .populate("doctor")
        .populate("beneficiary")
        .populate("registrant")
        .lean();

    console.log(
      LOG_TAG,
      "📦 UPDATED registration trả về FE:",
      "\n  _id    =", updatedRegistration?._id?.toString(),
      "\n  status =", updatedRegistration?.status
    );

    return res.json({
      success: true,
      data: updatedRegistration,
      message: "Đã hủy lịch tư vấn thành công",
    });
  } catch (err) {
    console.error(LOG_TAG, "❌ ERROR =", err);
    try {
      await session.abortTransaction();
      console.log(LOG_TAG, "⛔ Đã abort transaction");
    } catch (abortErr) {
      console.error(LOG_TAG, "abortTransaction ERROR =", abortErr);
    }
    session.endSession();
    return res
      .status(500)
      .json({ success: false, message: "Lỗi hệ thống khi hủy lịch tư vấn" });
  }
},
};

module.exports = DoctorBookingController;
