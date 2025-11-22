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
      console.error("[DoctorBooking][getConnectedElderlies][ERROR]", err);
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
          "title durationOptions customDuration price service description isActive",
        )
        .sort({ createdAt: -1 })
        .lean();

      return res.json({ success: true, data: packages });
    } catch (err) {
      console.error("[DoctorBooking][listHealthPackages][ERROR]", err);
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

      const pkg = await HealthPackage.findById(id).lean();
      if (!pkg || !pkg.isActive) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy gói khám" });
      }

      return res.json({ success: true, data: pkg });
    } catch (err) {
      console.error("[DoctorBooking][getHealthPackageDetail][ERROR]", err);
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
  // controllers/DoctorBookingController.js (trong object DoctorBookingController)
getAvailableDoctors: async (req, res) => {
  try {
    const {
      healthPackageId,
      durationDays: durationInput,
      startDate,
      specialization,
    } = req.query;

    console.log('[getAvailableDoctors] RAW_QUERY =', {
      healthPackageId,
      durationInput,
      startDate,
      specialization,
    });

    if (!healthPackageId || !durationInput || !startDate) {
      return res.status(400).json({
        success: false,
        message:
          'Thiếu healthPackageId, durationDays hoặc startDate trong query',
      });
    }

    const durationDays = Number(durationInput);
    console.log('[getAvailableDoctors] PARSED_DURATION =', durationDays);

    if (!durationDays || durationDays <= 0) {
      return res
        .status(400)
        .json({ success: false, message: 'durationDays không hợp lệ' });
    }

    const pkg = await HealthPackage.findById(healthPackageId).lean();
    console.log('[getAvailableDoctors] FOUND_PACKAGE =', {
      exists: !!pkg,
      isActive: pkg?.isActive,
      _id: pkg?._id,
      title: pkg?.title,
    });

    if (!pkg || !pkg.isActive) {
      return res
        .status(404)
        .json({ success: false, message: 'Không tìm thấy gói khám' });
    }

    const { start, end } = calcServicePeriod(durationDays, startDate);
    console.log('[getAvailableDoctors] PERIOD =', { start, end });

    // ===== 1) Lấy danh sách bác sĩ đã được cấu hình cho gói (registration kiểu cấu hình) =====
    const now = new Date();
    const registrations = await RegistrationHealthPackage.find({
      packageRef: healthPackageId,
      isActive: true,
      doctor: { $ne: null },
      $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }],
    })
      .populate({
        path: 'doctor',
        select: 'fullName avatar gender isActive role',
      })
      .lean();

    console.log('[getAvailableDoctors] REGISTRATIONS =', {
      count: registrations.length,
      first: registrations[0],
    });

    if (!registrations.length) {
      console.log(
        '[getAvailableDoctors] -> NO REGISTRATIONS, trả về doctors = []',
      );
      return res.json({
        success: true,
        data: {
          package: {
            _id: pkg._id,
            title: pkg.title,
            price: pkg.price,
            durationOptions: pkg.durationOptions,
          },
          period: { start, end, durationDays },
          doctors: [],
        },
      });
    }

    const doctorIds = Array.from(
      new Set(
        registrations
          .map(r => (r.doctor && r.doctor._id ? String(r.doctor._id) : null))
          .filter(Boolean),
      ),
    );

    console.log(
      '[getAvailableDoctors] DOCTOR_IDS_FROM_REGISTRATIONS =',
      doctorIds,
    );

    if (!doctorIds.length) {
      console.log(
        '[getAvailableDoctors] -> NO DOCTOR IDS, trả về doctors = []',
      );
      return res.json({
        success: true,
        data: {
          package: {
            _id: pkg._id,
            title: pkg.title,
            price: pkg.price,
            durationOptions: pkg.durationOptions,
          },
          period: { start, end, durationDays },
          doctors: [],
        },
      });
    }

    // ===== 2) Tìm các bác sĩ đang bận (đã có registration booking trùng khoảng thời gian) =====
    const DAY_MS = 24 * 60 * 60 * 1000;

    const busyRegs = await RegistrationHealthPackage.find({
      packageRef: healthPackageId,
      doctor: { $in: doctorIds },
      isActive: true,
      registeredAt: { $lte: end },
    })
      .select('doctor registeredAt durationDays')
      .lean();

    console.log('[getAvailableDoctors] BUSY_REGISTRATIONS_RAW =', {
      count: busyRegs.length,
      first: busyRegs[0],
    });

    const busyDoctorIds = new Set();

    busyRegs.forEach(r => {
      if (!r.registeredAt || !r.durationDays) return;

      const regStart = new Date(r.registeredAt);
      const regEnd = new Date(
        regStart.getTime() + (r.durationDays - 1) * DAY_MS,
      );

      const overlap = regStart <= end && regEnd >= start;

      console.log('[getAvailableDoctors] CHECK_BUSY_REG =', {
        doctor: String(r.doctor),
        regStart,
        regEnd,
        overlap,
      });

      if (overlap) {
        busyDoctorIds.add(String(r.doctor));
      }
    });

    console.log(
      '[getAvailableDoctors] BUSY_DOCTOR_IDS =',
      Array.from(busyDoctorIds),
    );

    const availableDoctorIds = doctorIds.filter(
      id => !busyDoctorIds.has(id),
    );

    console.log(
      '[getAvailableDoctors] AVAILABLE_DOCTOR_IDS =',
      availableDoctorIds,
    );

    if (!availableDoctorIds.length) {
      console.log(
        '[getAvailableDoctors] -> ALL DOCTORS BUSY, trả về []',
      );
      return res.json({
        success: true,
        data: {
          package: {
            _id: pkg._id,
            title: pkg.title,
            price: pkg.price,
            durationOptions: pkg.durationOptions,
          },
          period: { start, end, durationDays },
          doctors: [],
        },
      });
    }

    // ===== 3) Lấy profile cho các bác sĩ còn rảnh =====
    const profiles = await DoctorProfile.find({
      user: { $in: availableDoctorIds },
    })
      .select(
        'user specializations experience hospitalName ratingStats consultationFees',
      )
      .lean();

    console.log('[getAvailableDoctors] PROFILES =', {
      count: profiles.length,
      first: profiles[0],
    });

    const profileMap = new Map();
    profiles.forEach(p => {
      profileMap.set(String(p.user), p);
    });

    const doctors = availableDoctorIds
      .map(id => {
        const reg = registrations.find(
          r => r.doctor && String(r.doctor._id) === id,
        );
        if (!reg || !reg.doctor) return null;

        const user = reg.doctor;
        if (user.role !== 'doctor' || user.isActive === false) {
          console.log(
            '[getAvailableDoctors] SKIP_USER_NOT_ACTIVE_OR_NOT_DOCTOR =',
            {
              userId: user._id,
              role: user.role,
              isActive: user.isActive,
            },
          );
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
      .filter(Boolean)
      .filter(doc => {
        if (!specialization) return true;
        const specs = Array.isArray(doc.specializations)
          ? doc.specializations
          : [];
        const keyword = String(specialization).toLowerCase();
        return specs.some(s =>
          String(s).toLowerCase().includes(keyword),
        );
      });

    console.log(
      '[getAvailableDoctors] FINAL_DOCTORS_IDS =',
      doctors.map(d => String(d.doctorId)),
    );
    console.log(
      '[getAvailableDoctors] FINAL_DOCTORS_COUNT =',
      doctors.length,
    );

    return res.json({
      success: true,
      data: {
        package: {
          _id: pkg._id,
          title: pkg.title,
          price: pkg.price,
          durationOptions: pkg.durationOptions,
        },
        period: { start, end, durationDays },
        doctors,
      },
    });
  } catch (err) {
    console.error('[DoctorBooking][getAvailableDoctors][ERROR]', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi lấy danh sách bác sĩ khả dụng',
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
      console.error("[DoctorBooking][getDoctorDetail][ERROR]", err);
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

    try {
      const rawUser = req.user || {};
      const familyId =
        rawUser._id || rawUser.id || rawUser.userId || null;
      const role = rawUser.role || null;

      const {
        elderlyId,
        healthPackageId,
        durationDays: durationInput,
        startDate,
        doctorId,
        paymentMethod,
      } = req.body || {};

      if (!familyId) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }
      if (role !== "family") {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: "Chỉ tài khoản người thân mới được đặt gói khám",
        });
      }

      if (
        !elderlyId ||
        !healthPackageId ||
        !durationInput ||
        !startDate ||
        !doctorId
      ) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message:
            "Thiếu elderlyId, healthPackageId, durationDays, startDate hoặc doctorId",
        });
      }

      const durationDays = Number(durationInput);
      if (!durationDays || durationDays <= 0) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(400)
          .json({ success: false, message: "durationDays không hợp lệ" });
      }

      // Chỉ check relationship, không check permissions nữa
      const relationship = await Relationship.findOne({
        elderly: elderlyId,
        family: familyId,
        status: "accepted",
      })
        .session(session)
        .lean();

      if (!relationship) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message:
            "Bạn không có quyền đặt dịch vụ cho người cao tuổi này (chưa kết nối hoặc bị hạn chế quyền).",
        });
      }

      const pkg = await HealthPackage.findById(healthPackageId)
        .session(session)
        .lean();

      if (!pkg || !pkg.isActive) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy gói khám" });
      }

      const { start, end } = calcServicePeriod(durationDays, startDate);

      const doctorUser = await User.findById(doctorId)
        .select("role isActive fullName")
        .session(session);

      if (
        !doctorUser ||
        doctorUser.role !== "doctor" ||
        doctorUser.isActive === false
      ) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(404)
          .json({ success: false, message: "Bác sĩ không hợp lệ" });
      }

      // Không cho đặt trùng khoảng ngày cho cùng bác sĩ
      const overlapping = await Consultation.find({
        doctor: doctorId,
        "packageInfo.startDate": { $lte: end },
        "packageInfo.endDate": { $gte: start },
        status: { $in: ["scheduled", "confirmed", "in_progress"] },
      })
        .session(session)
        .lean();

      if (overlapping.length > 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({
          success: false,
          message:
            "Bác sĩ này đã được đặt trong khoảng ngày này, vui lòng chọn bác sĩ khác hoặc ngày khác.",
        });
      }

      const factor = durationDays / 30;
      const consultationFee = Math.round(pkg.price * factor);
      const totalAmount = consultationFee;

      const now = new Date();
      const payMethod = paymentMethod || "cash";

      // RegistrationHealthPackage: lưu lịch sử đăng ký & để ẩn bác sĩ
      const [registration] = await RegistrationHealthPackage.create(
        [
          {
            packageRef: healthPackageId,
            doctor: doctorId,
            registrant: familyId,
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

      const [consultation] = await Consultation.create(
        [
          {
            elderly: elderlyId,
            doctor: doctorId,
            bookedBy: familyId,
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
              basePrice: pkg.price,
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

      const transactionId = `CONS-${consultation._id}-${Date.now()}`;

      const [payment] = await Payment.create(
        [
          {
            user: familyId,
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

      consultation.payment.transactionId = transactionId;
      await consultation.save({ session });

      await session.commitTransaction();
      session.endSession();

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
      console.error("[DoctorBooking][createBooking][ERROR]", err);
      try {
        await session.abortTransaction();
      } catch (e) {}
      session.endSession();
      return res.status(500).json({
        success: false,
        message: "Không thể tạo booking, vui lòng thử lại sau",
      });
    }
  },

  // Bước 7: lịch sử đặt lịch của family hiện tại
  getMyBookings: async (req, res) => {
    const reqId = Math.random().toString(36).slice(2, 10);
    const startedAt = Date.now();

    try {
      const userId =
        (req.user && (req.user._id || req.user.id || req.user.userId)) || null;

      console.log(
        "[DoctorBooking][getMyBookings][" + reqId + "] RAW_USER =",
        req.user
      );
      console.log(
        "[DoctorBooking][getMyBookings][" + reqId + "] RESOLVED userId =",
        userId
      );

      if (!userId) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      // ===== Query vào RegistrationHealthPackage =====
      const query = {
        registrant: userId, // người đặt (family)
        isActive: true,     // nếu bạn có field này
      };
      console.log(
        "[DoctorBooking][getMyBookings][" + reqId + "] FIND_QUERY =",
        query
      );

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

      console.log(
        "[DoctorBooking][getMyBookings][" + reqId + "] RESULT =",
        {
          count: registrations.length,
          first: registrations[0],
        }
      );

      const tookMs = Date.now() - startedAt;
      console.log(
        "[DoctorBooking][getMyBookings][" + reqId + "] TOOK_MS =",
        tookMs
      );

      return res.json({
        success: true,
        data: registrations,
      });
    } catch (err) {
      console.error(
        "[DoctorBooking][getMyBookings][ERROR]",
        err?.message,
        "\nSTACK:",
        err?.stack
      );
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
      console.error(
        "[DoctorBooking][getRegistrationDetail][ERROR]",
        err,
      );
      return res.status(500).json({
        success: false,
        message: "Lỗi lấy chi tiết đăng ký gói khám",
      });
    }
  },
};

module.exports = DoctorBookingController;
