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

      // KHÔNG lọc theo permissions.bookServices nữa
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

      // ===== 0. Validate input =====
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

      // ===== 1. Lấy gói khám =====
      const pkg = await HealthPackage.findById(healthPackageId).lean();

      if (!pkg || !pkg.isActive) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy gói khám" });
      }

      // ===== 2. Tính khoảng thời gian dịch vụ người dùng đang chọn =====
      const { start, end } = calcServicePeriod(durationDays, startDate);

      // ===== 3. Lấy tất cả user role=doctor, đang active =====
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

      // ===== 4B. Tìm bác sĩ bận theo Consultation (dữ liệu kiểu mới) =====
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

      // ===== 4D. Tìm bác sĩ bận theo RegistrationHealthPackage (dựa trên expiresAt) =====
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

      // ===== 4E. Hợp 2 nguồn: Consultation + Registration =====
      const busyDoctorIds = new Set([
        ...Array.from(busyDoctorIdsFromCons),
        ...Array.from(busyDoctorIdsFromRegs),
      ]);

      // ===== 5. Lọc ra doctor còn rảnh =====
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

      // ===== 6. Lấy DoctorProfile cho bác sĩ còn rảnh =====
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

      // ===== 7. Build danh sách bác sĩ trả về app =====
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

      // filter theo chuyên khoa nếu có
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

    if (!familyId) {
      console.warn(LOG_TAG, "Unauthorized: missing user id in req.user");
      await session.abortTransaction();
      session.endSession();
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized" });
    }

    // Chỉ cho phép tài khoản family hoặc elderly đặt
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

    // Nếu là elderly tự đặt thì bắt buộc đặt cho chính mình
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

    // Với role family: phải có quan hệ Relationship được chấp nhận
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

    // Không cho đặt trùng khoảng ngày cho cùng bác sĩ
    console.log(LOG_TAG, "Checking overlapping consultations...");

    const overlapping = await Consultation.find({
      doctor: doctorId,
      "packageInfo.startDate": { $lte: end },
      "packageInfo.endDate": { $gte: start },
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

    // ===== TÍNH GIÁ GÓI THEO durations[].fee CỦA HEALTHPACKAGE =====
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
      console.warn(
        LOG_TAG,
        "Invalid package price, cannot create booking",
        { pkgPrice, parsedPrice },
      );
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

    // registrantId = người thực hiện đặt (family hoặc elderly)
    const registrantId = isFamily ? familyId : elderlyId;

    console.log(LOG_TAG, "Creating RegistrationHealthPackage...", {
      registrantId,
      elderlyId,
      doctorId,
      healthPackageId,
      totalAmount,
      payMethod,
    });

    // RegistrationHealthPackage: lưu lịch sử đăng ký & để ẩn bác sĩ
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
          status: "active",
          notes: `Đăng ký gói ${pkg.title} (${durationDays} ngày) cho elderly ${elderlyId}`,
        },
      ],
      { session },
    );

    console.log(LOG_TAG, "Registration created =", registration?._id);

    const [consultation] = await Consultation.create(
      [
        {
          elderly: elderlyId,
          doctor: doctorId,
          bookedBy: registrantId,
          consultationType: "online",
          specialization: "Gói khám sức khoẻ",
          symptoms: [],
          reason: `Đặt gói ${pkg.title} trong ${durationDays} ngày`,
          scheduledDate: start,
          timeSlot: { start: null, end: null },
          location: { address: "" },
          status: "scheduled",
          packageInfo: {
            healthPackage: healthPackageId,
            title: pkg.title,
            durationDays,
            startDate: start,
            endDate: end,
            basePrice: parsedPrice,
            registrationId: registration._id,
          },
          pricing: {
            consultationFee,
            totalAmount,
            currency: "VND",
          },
          payment: {
            method: payMethod,
            status: payMethod === "cash" ? "completed" : "pending",
            transactionId: undefined,
            paidAt: payMethod === "cash" ? now : null,
          },
          bookedAt: now,
        },
      ],
      { session },
    );

    console.log(LOG_TAG, "Consultation created =", consultation?._id);

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
          status: payMethod === "cash" ? "completed" : "pending",
          fees: {
            serviceFee: 0,
            platformFee: 0,
            paymentGatewayFee: 0,
            discount: 0,
          },
          totalAmount,
          netAmount: totalAmount,
          initiatedAt: now,
          completedAt: payMethod === "cash" ? now : null,
          notes: `Thanh toán gói ${pkg.title} cho elderly ${elderlyId}`,
        },
      ],
      { session },
    );

    console.log(LOG_TAG, "Payment created =", payment?._id);

    consultation.payment.transactionId = transactionId;
    await consultation.save({ session });

    console.log(
      LOG_TAG,
      "Consultation updated with transactionId =",
      transactionId,
    );

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

  // Bước 7: lịch sử đặt lịch của family hiện tại
  getMyBookings: async (req, res) => {
    try {
      const userId =
        (req.user && (req.user._id || req.user.id || req.user.userId)) || null;

      if (!userId) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      const query = {
        registrant: userId,
        isActive: true,
      };

      const registrations = await RegistrationHealthPackage.find(query)
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
        .sort({ registeredAt: -1, createdAt: -1 })
        .lean();

      return res.json({
        success: true,
        data: registrations,
      });
    } catch (err) {
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

      const registration = await RegistrationHealthPackage.findById(id)
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

      return res.json({
        success: true,
        data: registration,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi lấy chi tiết đăng ký gói khám",
      });
    }
  },
};

module.exports = DoctorBookingController;
