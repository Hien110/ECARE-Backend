const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const SupporterProfile = require("../models/SupporterProfile");
const SupporterScheduling = require("../models/SupporterScheduling");
const RegistrationConsulation = require("../models/RegistrationConsulation");
const ConsultationSummary = require("../models/ConsultationSummary");
const { normalizePhoneVN, hmacIndex } = require("../../utils/cryptoFields");
const crypto = require("crypto");
const XLSX = require("xlsx");
const Payment = require("../models/Payment");

if (!mongoose.models.RegistrationHealthPackage) {
  console.warn(
    "⚠️ RegistrationHealthPackage model chưa được đăng ký, đang thử require lại..."
  );
  require("../models/RegistrationConsulation");
}

// === Helper kiểm tra ObjectId hợp lệ ===
const isValidObjectId = (v) =>
  typeof v === "string" && /^[a-fA-F0-9]{24}$/.test(v);

const decryptUserData = (users) => {
  try {
    const ENC_KEY = Buffer.from(process.env.ENC_KEY || "", "base64");
    if (!ENC_KEY || ENC_KEY.length === 0) {
      console.warn("⚠️ [decryptUserData] ENC_KEY not set, skipping decryption");
      return users.map((user) => {
        const userObj = user.toObject ? user.toObject() : user;
        // Remove encrypted fields but keep original data
        delete userObj.phoneNumberEnc;
        delete userObj.emailEnc;
        delete userObj.addressEnc;
        delete userObj.identityCardEnc;
        delete userObj.currentAddressEnc;
        delete userObj.hometownEnc;
        delete userObj.phoneNumberHash;
        delete userObj.phoneNumberHashAlt;
        delete userObj.emailHash;
        delete userObj.identityCardHash;
        return userObj;
      });
    }

    const decryptLegacy = (enc) => {
      if (!enc) return null;
      try {
        const [ivB64, ctB64, tagB64] = String(enc).split(":");
        if (!ivB64 || !ctB64 || !tagB64) return null;
        const iv = Buffer.from(ivB64, "base64");
        const ct = Buffer.from(ctB64, "base64");
        const tag = Buffer.from(tagB64, "base64");
        const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
      } catch {
        return null;
      }
    };

    const decryptGCM = (packed) => {
      if (!packed) return null;
      try {
        const parts = String(packed).split(".");
        if (parts.length !== 3) return null;
        const [ivB64, tagB64, dataB64] = parts;
        const iv = Buffer.from(ivB64, "base64url");
        const tag = Buffer.from(tagB64, "base64url");
        const data = Buffer.from(dataB64, "base64url");
        const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(data), d.final()]).toString("utf8");
      } catch {
        return null;
      }
    };

    const tryDecryptAny = (v) => {
      if (v == null || v === "") return null;
      try {
        const s = String(v);
        if (s.includes(".")) {
          return decryptGCM(s);
        }
        if (s.includes(":")) {
          return decryptLegacy(s);
        }
        return s;
      } catch {
        return null;
      }
    };

    const deepDecrypt = (v, passes = 3) => {
      let cur = v;
      for (let i = 0; i < passes; i++) {
        const out = tryDecryptAny(cur);
        if (out == null) {
          return cur;
        }
        if (out === cur) {
          return out;
        }
        cur = out;
      }
      return cur;
    };

    const pick = (obj, keys) => {
      if (!obj) return null;
      for (const k of keys) {
        const v = obj[k];
        if (v != null && v !== "") return v;
      }
      return null;
    };

    return users
      .map((user) => {
        try {
          if (!user) return null;
          const userObj = user.toObject ? user.toObject() : user;
          if (!userObj || typeof userObj !== "object") return userObj;

          const phoneCipher = pick(userObj, ["phoneNumberEnc", "phoneNumber"]);
          if (phoneCipher) {
            const decryptedPhone = deepDecrypt(phoneCipher);
            userObj.phoneNumber = decryptedPhone || userObj.phoneNumber || null;
          }
          delete userObj.phoneNumberEnc;

          const emailCipher = pick(userObj, ["emailEnc", "email"]);
          if (emailCipher) {
            const decryptedEmail = deepDecrypt(emailCipher);
            if (decryptedEmail !== null && decryptedEmail !== undefined) {
              userObj.email = decryptedEmail;
            }
          }
          delete userObj.emailEnc;

          const addressCipher = pick(userObj, ["addressEnc", "address"]);
          if (addressCipher) {
            const decryptedAddress = deepDecrypt(addressCipher);
            userObj.address = decryptedAddress || userObj.address || null;
          }
          delete userObj.addressEnc;

          const identityCipher = pick(userObj, [
            "identityCardEnc",
            "identityCard",
          ]);
          if (identityCipher) {
            const decryptedIdentity = deepDecrypt(identityCipher);
            userObj.identityCard =
              decryptedIdentity || userObj.identityCard || null;
          }
          delete userObj.identityCardEnc;

          const currentAddressCipher = pick(userObj, [
            "currentAddressEnc",
            "currentAddress",
          ]);
          if (currentAddressCipher) {
            const decryptedCurrentAddress = deepDecrypt(currentAddressCipher);
            userObj.currentAddress =
              decryptedCurrentAddress || userObj.currentAddress || null;
          }
          delete userObj.currentAddressEnc;

          const hometownCipher = pick(userObj, ["hometownEnc", "hometown"]);
          if (hometownCipher) {
            const decryptedHometown = deepDecrypt(hometownCipher);
            userObj.hometown = decryptedHometown || userObj.hometown || null;
          }
          delete userObj.hometownEnc;

          delete userObj.phoneNumberHash;
          delete userObj.phoneNumberHashAlt;
          delete userObj.emailHash;
          delete userObj.identityCardHash;

          return userObj;
        } catch (userErr) {
          // Return user as-is if decryption fails
          const userObj = user.toObject ? user.toObject() : user;
          delete userObj.phoneNumberEnc;
          delete userObj.emailEnc;
          delete userObj.addressEnc;
          delete userObj.identityCardEnc;
          delete userObj.currentAddressEnc;
          delete userObj.hometownEnc;
          return userObj;
        }
      })
      .filter((u) => u !== null);
  } catch (err) {
    // Return users as-is if decryption completely fails
    return users.map((user) => {
      const userObj = user.toObject ? user.toObject() : user;
      delete userObj.phoneNumberEnc;
      delete userObj.emailEnc;
      delete userObj.addressEnc;
      delete userObj.identityCardEnc;
      delete userObj.currentAddressEnc;
      delete userObj.hometownEnc;
      return userObj;
    });
  }
};

const decryptSingleUser = (user) => {
  if (!user) return null;
  const [decrypted] = decryptUserData([user]);
  return decrypted;
};

const parseDateFromExcel = (dateInput) => {
  if (!dateInput) return null;

  // If it's already a Date object
  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? null : dateInput;
  }

  // Check if it's an Excel serial number (number between 1 and 100000)
  if (typeof dateInput === "number" && dateInput > 1 && dateInput < 100000) {
    // Excel serial number: days since 1900-01-01 (with leap year bug)
    // Convert to actual date
    const excelEpoch = new Date(1900, 0, 1); // 1900-01-01
    const date = new Date(
      excelEpoch.getTime() + (dateInput - 2) * 24 * 60 * 60 * 1000
    );

    // Validate the converted date is reasonable (between 1900 and 2100)
    if (date.getFullYear() >= 1900 && date.getFullYear() <= 2100) {
      return date;
    } else {
    }
  }

  // Convert to string and try different formats
  const dateStr = String(dateInput).trim();

  // Try different date formats
  const formats = [
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/, // YYYY-MM-DD
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // M/D/YYYY or MM/DD/YYYY
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/, // M-D-YYYY or MM-DD-YYYY
  ];

  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      let year, month, day;

      if (format.source.includes("YYYY")) {
        // Format with year first
        [, year, month, day] = match;
      } else {
        // Format with month/day first
        [, month, day, year] = match;
      }

      // Create date object
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));

      // Validate the date
      if (
        !isNaN(date.getTime()) &&
        date.getFullYear() == year &&
        date.getMonth() == month - 1 &&
        date.getDate() == day
      ) {
        return date;
      } else {
      }
    }
  }

  // Try direct parsing as last resort
  const directParse = new Date(dateStr);
  return isNaN(directParse.getTime()) ? null : directParse;
};
const validateSupporterRow = (row, rowNumber) => {
  const errors = [];

  if (!row.fullName || row.fullName.trim().length < 2) {
    errors.push("Họ tên phải có ít nhất 2 ký tự");
  }

  if (
    !row.phoneNumber ||
    !/^[0-9]{10,11}$/.test(String(row.phoneNumber).replace(/\D/g, ""))
  ) {
    errors.push("Số điện thoại không hợp lệ");
  }

  if (!row.password || String(row.password).length < 6) {
    errors.push("Mật khẩu phải có ít nhất 6 ký tự");
  }

  if (!row.dateOfBirth) {
    errors.push("Ngày sinh là bắt buộc");
  } else {
    const birthDate = parseDateFromExcel(row.dateOfBirth);

    if (!birthDate) {
      errors.push("Ngày sinh không hợp lệ");
    } else {
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();

      if (age < 18) {
        errors.push("Tuổi phải từ 18 trở lên");
      }
      if (age > 100) {
        errors.push("Tuổi không hợp lệ");
      }
    }
  }

  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
    errors.push("Email không hợp lệ");
  }

  if (!row.gender || !["Nam", "Nữ", "Khác"].includes(row.gender)) {
    errors.push("Giới tính phải là Nam, Nữ hoặc Khác");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

const validateDoctorRow = (row, rowNumber) => {
  const errors = [];

  if (!row.fullName || row.fullName.trim().length < 2) {
    errors.push("Họ tên phải có ít nhất 2 ký tự");
  }

  if (
    !row.phoneNumber ||
    !/^[0-9]{10,11}$/.test(String(row.phoneNumber).replace(/\D/g, ""))
  ) {
    errors.push("Số điện thoại không hợp lệ");
  }

  if (!row.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
    errors.push("Email là bắt buộc và phải hợp lệ");
  }

  if (!row.password || String(row.password).length < 6) {
    errors.push("Mật khẩu phải có ít nhất 6 ký tự");
  }

  if (!row.dateOfBirth) {
    errors.push("Ngày sinh là bắt buộc");
  } else {
    const birthDate = new Date(row.dateOfBirth);
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();

    if (age < 22) {
      errors.push("Tuổi phải từ 22 trở lên để trở thành bác sĩ");
    }
    if (age > 70) {
      errors.push("Tuổi không hợp lệ");
    }
  }

  if (!row.gender || !["Nam", "Nữ", "Khác"].includes(row.gender)) {
    errors.push("Giới tính phải là Nam, Nữ hoặc Khác");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

const AdminController = {
  // Admin: Lấy danh sách các gói khám mà bác sĩ đã đảm nhận
  getPackagesByDoctor: async (req, res) => {
    try {
      const { doctorId } = req.params;
      if (!isValidObjectId(doctorId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID bác sĩ không hợp lệ" });
      }

      // Tìm tất cả các đăng ký gói khám mà bác sĩ này đã đảm nhận
      let docs = await RegistrationHealthPackage.find({ doctor: doctorId })
        .populate("packageRef", "title durations price description isActive")
        .populate({
          path: "beneficiary",
          select:
            "fullName role dateOfBirth phoneNumber phoneNumberEnc email emailEnc avatar +phoneNumberEnc +emailEnc",
        })
        .populate({
          path: "registrant",
          select:
            "fullName role phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc",
        })
        .sort({ registeredAt: -1 })
        .lean();

      // Decrypt populated users (beneficiary/registrant) in batch
      const usersToDecrypt = [];
      docs.forEach((d) => {
        if (d.beneficiary && d.beneficiary._id)
          usersToDecrypt.push(d.beneficiary);
        if (d.registrant && d.registrant._id) usersToDecrypt.push(d.registrant);
      });
      // Unique by _id
      const uniq = {};
      const uniqueUsers = [];
      usersToDecrypt.forEach((u) => {
        if (!u || !u._id) return;
        const id = String(u._id);
        if (!uniq[id]) {
          uniq[id] = true;
          uniqueUsers.push(u);
        }
      });
      // Decrypt users safely
      if (uniqueUsers.length > 0) {
        try {
          const decrypted = decryptUserData(uniqueUsers);
          const decMap = {};
          decrypted.forEach((u) => {
            if (u && u._id) {
              decMap[String(u._id)] = u;
            }
          });
          // attach decrypted users back to docs
          docs = docs.map((d) => {
            if (
              d.beneficiary &&
              d.beneficiary._id &&
              decMap[String(d.beneficiary._id)]
            ) {
              d.beneficiary = decMap[String(d.beneficiary._id)];
            }
            if (
              d.registrant &&
              d.registrant._id &&
              decMap[String(d.registrant._id)]
            ) {
              d.registrant = decMap[String(d.registrant._id)];
            }
            return d;
          });
        } catch (decryptErr) {
          // Continue without decryption if it fails
        }
      }

      return res.status(200).json({
        success: true,
        data: docs,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Đã xảy ra lỗi khi lấy danh sách gói khám bác sĩ đã đảm nhận",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  },
  resetUserPassword: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isValidObjectId(userId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID người dùng không hợp lệ" });
      }
      const user = await User.findById(userId);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy người dùng" });
      }
      const newPassword = await bcrypt.hash("1", 12);
      user.password = newPassword;
      await user.save();
      return res
        .status(200)
        .json({ success: true, message: "Đã reset mật khẩu về '1'" });
    } catch (err) {
      console.error("Error resetting user password:", err);
      return res
        .status(500)
        .json({ success: false, message: "Đã xảy ra lỗi khi reset mật khẩu" });
    }
  },
  // Admin: Lấy danh sách tất cả người dùng
  getAllUsers: async (req, res) => {
    try {
      const users = await User.find({})
        .select(
          "_id fullName role isActive phoneNumber phoneNumberEnc email emailEnc address addressEnc identityCard identityCardEnc currentAddress currentAddressEnc hometown hometownEnc gender dateOfBirth createdAt avatar +phoneNumberEnc +emailEnc +addressEnc +identityCardEnc +currentAddressEnc +hometownEnc"
        )
        .sort({ createdAt: -1 });

      const decrypted = decryptUserData(users);

      return res.status(200).json({ success: true, data: decrypted });
    } catch (err) {
      console.error("❌ [AdminController.getAllUsers] Error:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi lấy danh sách người dùng",
        });
    }
  },

  // Admin: Lấy chi tiết 1 người dùng theo id
  getUserById: async (req, res) => {
    try {
      const { userId } = req.params;

      if (!isValidObjectId(userId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID người dùng không hợp lệ" });
      }

      const user = await User.findById(userId).select(
        "_id fullName role isActive phoneNumber phoneNumberEnc email emailEnc address addressEnc gender dateOfBirth createdAt avatar identityCard identityCardEnc currentAddress currentAddressEnc hometown hometownEnc +phoneNumberEnc +emailEnc +addressEnc +identityCardEnc +currentAddressEnc +hometownEnc"
      );

      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy người dùng" });
      }

      const [decrypted] = decryptUserData([user]);

      return res.status(200).json({ success: true, data: decrypted });
    } catch (err) {
      console.error("❌ [AdminController.getUserById] Error:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi lấy thông tin người dùng",
        });
    }
  },

  // Admin: Tạo tài khoản supporter
  createSupporter: async (req, res) => {
    try {
      const {
        fullName,
        phoneNumber,
        gender,
        password,
        email,
        dateOfBirth,
        address,
        identityCard,
        experience,
      } = req.body;

      if (
        !fullName ||
        !phoneNumber ||
        !gender ||
        !password ||
        !dateOfBirth ||
        !identityCard
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Thiếu thông tin bắt buộc: fullName, phoneNumber, gender, password, dateOfBirth, identityCard",
        });
      }

      if (!["Nam", "Nữ", "Khác"].includes(gender)) {
        return res
          .status(400)
          .json({ success: false, message: "Giới tính không hợp lệ" });
      }

      if (password.length < 6) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Mật khẩu phải có ít nhất 6 ký tự",
          });
      }

      const normalizedPhone = normalizePhoneVN(phoneNumber);
      if (!normalizedPhone) {
        return res
          .status(400)
          .json({ success: false, message: "Số điện thoại không hợp lệ" });
      }

      const localPhone = normalizedPhone.startsWith("84")
        ? "0" + normalizedPhone.slice(2)
        : normalizedPhone;
      const phoneHashesToCheck = [
        ...new Set(
          [
            hmacIndex(normalizedPhone),
            localPhone ? hmacIndex(localPhone) : null,
          ].filter(Boolean)
        ),
      ];

      const existingUser = await User.findOne({
        isActive: true,
        phoneNumberHash: { $in: phoneHashesToCheck },
      });
      if (existingUser) {
        return res
          .status(409)
          .json({ success: false, message: "Số điện thoại đã được sử dụng" });
      }

      // Check identityCard uniqueness
      const identityCardHash = identityCard
        ? hmacIndex(String(identityCard))
        : null;
      if (identityCardHash) {
        const existingIdentityCard = await User.findOne({
          identityCardHash,
          isActive: true,
        });
        if (existingIdentityCard) {
          return res
            .status(409)
            .json({ success: false, message: "CMND/CCCD đã được sử dụng" });
        }
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const userData = {
        fullName: fullName.trim(),
        gender,
        password: hashedPassword,
        role: "supporter",
        isActive: true,
        dateOfBirth: new Date(dateOfBirth),
        phoneNumber: normalizedPhone,
      };
      if (email?.trim()) {
        const emailNorm = email.trim().toLowerCase();
        userData.email = emailNorm;
        userData.emailHash = hmacIndex(emailNorm);
      }
      if (address?.trim()) {
        userData.address = address.trim();
      }
      if (identityCard?.toString().trim()) {
        userData.identityCard = identityCard.toString().trim();
        userData.identityCardHash = identityCardHash;
      }

      const newUser = await User.create(userData);

      // Tạo SupporterProfile
      const SupporterProfile = require("../models/SupporterProfile");
      await SupporterProfile.create({
        user: newUser._id,
        experience: {
          totalYears: experience?.totalYears || 0,
          description: experience?.description || "",
        },
      });

      return res.status(201).json({
        success: true,
        message: "Tạo tài khoản supporter thành công",
        data: {
          userId: newUser._id,
          fullName: newUser.fullName,
          role: newUser.role,
          isActive: newUser.isActive,
        },
      });
    } catch (err) {
      console.error("Error creating supporter:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi tạo tài khoản supporter",
        });
    }
  },

  // Admin: Tạo tài khoản doctor
  createDoctor: async (req, res) => {
    try {
      const {
        fullName,
        phoneNumber,
        gender,
        password,
        email,
        dateOfBirth,
        address,
        identityCard,
        specialization,
        experience,
        description,
      } = req.body;

      if (
        !fullName ||
        !phoneNumber ||
        !gender ||
        !password ||
        !dateOfBirth ||
        !identityCard
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Thiếu thông tin bắt buộc: fullName, phoneNumber, gender, password, dateOfBirth, identityCard",
        });
      }

      if (!["Nam", "Nữ", "Khác"].includes(gender)) {
        return res
          .status(400)
          .json({ success: false, message: "Giới tính không hợp lệ" });
      }

      if (password.length < 6) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Mật khẩu phải có ít nhất 6 ký tự",
          });
      }

      const normalizedPhone = normalizePhoneVN(phoneNumber);
      if (!normalizedPhone) {
        return res
          .status(400)
          .json({ success: false, message: "Số điện thoại không hợp lệ" });
      }

      const localPhone = normalizedPhone.startsWith("84")
        ? "0" + normalizedPhone.slice(2)
        : normalizedPhone;
      const phoneHashesToCheck = [
        ...new Set(
          [
            hmacIndex(normalizedPhone),
            localPhone ? hmacIndex(localPhone) : null,
          ].filter(Boolean)
        ),
      ];

      const existingUser = await User.findOne({
        isActive: true,
        phoneNumberHash: { $in: phoneHashesToCheck },
      });
      if (existingUser) {
        return res
          .status(409)
          .json({ success: false, message: "Số điện thoại đã được sử dụng" });
      }

      // Kiểm tra email nếu có
      if (email?.trim()) {
        const emailNorm = email.trim().toLowerCase();
        const emailHash = hmacIndex(emailNorm);
        const existingEmail = await User.findOne({ emailHash, isActive: true });
        if (existingEmail) {
          return res
            .status(409)
            .json({ success: false, message: "Email đã được sử dụng" });
        }
      }

      const identityCardHash = hmacIndex(identityCard);
      const existingIdentityCard = await User.findOne({
        identityCardHash,
        isActive: true,
      });
      if (existingIdentityCard) {
        return res
          .status(409)
          .json({ success: false, message: "CMND/CCCD đã được sử dụng" });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const userData = {
        fullName: fullName.trim(),
        gender,
        password: hashedPassword,
        role: "doctor",
        isActive: true,
        dateOfBirth: new Date(dateOfBirth),
        phoneNumber: normalizedPhone,
      };
      if (email?.trim()) {
        const emailNorm = email.trim().toLowerCase();
        userData.email = emailNorm;
        userData.emailHash = hmacIndex(emailNorm);
      }
      if (address?.trim()) {
        userData.address = address.trim();
      }
      if (identityCard?.trim()) {
        userData.identityCard = identityCard.trim();
        userData.identityCardHash = identityCardHash;
      }

      const newUser = await User.create(userData);

      // Tạo DoctorProfile với đầy đủ thông tin
      const DoctorProfile = require("../models/DoctorProfile");

      // Chuẩn bị dữ liệu profile
      const profileData = {
        user: newUser._id,
        specialization: specialization?.trim() || "",
        experience: parseInt(experience) || 0,
        description: description?.trim() || "",
        ratingStats: {
          averageRating: 0,
          totalRatings: 0,
        },
        stats: {
          totalConsultations: 0,
        },
      };

      const doctorProfile = await DoctorProfile.create(profileData);

      return res.status(201).json({
        success: true,
        message: "Tạo tài khoản doctor và hồ sơ chuyên môn thành công",
        data: {
          userId: newUser._id,
          doctorProfileId: doctorProfile._id,
          fullName: newUser.fullName,
          role: newUser.role,
          specialization: profileData.specialization,
          experience: profileData.experience,
          isActive: newUser.isActive,
        },
      });
    } catch (err) {
      console.error("Error creating doctor:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi tạo tài khoản doctor",
        });
    }
  },

  // Admin: Lấy thông tin supporter
  getSupporterProfile: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isValidObjectId(userId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID người dùng không hợp lệ" });
      }

      const user = await User.findById(userId).select(
        "fullName phoneNumber phoneNumberEnc email emailEnc address addressEnc identityCard identityCardEnc currentAddress currentAddressEnc hometown hometownEnc role isActive avatar gender dateOfBirth createdAt +phoneNumberEnc +emailEnc +addressEnc +identityCardEnc +currentAddressEnc +hometownEnc"
      );

      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy người dùng" });
      }
      if (user.role !== "supporter") {
        return res
          .status(400)
          .json({
            success: false,
            message: "Người dùng này không phải là supporter",
          });
      }

      const supporterProfile = await SupporterProfile.findOne({ user: userId });
      const [decryptedUser] = decryptUserData([user]);

      const combinedData = {
        ...supporterProfile?.toObject(),
        user: decryptedUser,
      };

      return res.status(200).json({ success: true, data: combinedData });
    } catch (err) {
      console.error("❌ [AdminController.getSupporterProfile] Error:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi lấy thông tin supporter",
        });
    }
  },

  // Admin: Lấy thông tin DoctorProfile của bác sĩ
  getDoctorProfile: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isValidObjectId(userId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID người dùng không hợp lệ" });
      }

      const user = await User.findById(userId).select(
        "fullName phoneNumber phoneNumberEnc email emailEnc address addressEnc identityCard identityCardEnc role isActive avatar gender dateOfBirth createdAt +phoneNumberEnc +emailEnc +addressEnc +identityCardEnc"
      );

      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy người dùng" });
      }
      if (user.role !== "doctor") {
        return res
          .status(400)
          .json({
            success: false,
            message: "Người dùng này không phải là bác sĩ",
          });
      }

      const DoctorProfile = require("../models/DoctorProfile");
      const doctorProfile = await DoctorProfile.findOne({ user: userId });
      const [decryptedUser] = decryptUserData([user]);

      const combinedData = {
        user: decryptedUser,
        profile: doctorProfile?.toObject() || null,
      };

      return res.status(200).json({ success: true, data: combinedData });
    } catch (err) {
      console.error("❌ [AdminController.getDoctorProfile] Error:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi lấy thông tin bác sĩ",
        });
    }
  },

  // Admin: Lấy danh sách RegistrationConsultation đã hoàn thành của bác sĩ
  getCompletedConsultationsByDoctor: async (req, res) => {
    try {
      const { doctorId } = req.params;
      if (!isValidObjectId(doctorId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID bác sĩ không hợp lệ" });
      }

      const RegistrationConsultation = require("../models/RegistrationConsulation");

      let consultations = await RegistrationConsultation.find({
        doctor: doctorId,
        status: "completed",
      })
        .populate({
          path: "doctor",
          select:
            "fullName role avatar phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc",
        })
        .populate({
          path: "beneficiary",
          select:
            "fullName role dateOfBirth phoneNumber phoneNumberEnc email emailEnc avatar +phoneNumberEnc +emailEnc",
        })
        .populate({
          path: "registrant",
          select:
            "fullName role phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc",
        })
        .sort({ registeredAt: -1 })
        .lean();

      // Decrypt all populated users in batch
      const usersToDecrypt = [];
      consultations.forEach((c) => {
        if (c.doctor && c.doctor._id) usersToDecrypt.push(c.doctor);
        if (c.beneficiary && c.beneficiary._id)
          usersToDecrypt.push(c.beneficiary);
        if (c.registrant && c.registrant._id) usersToDecrypt.push(c.registrant);
      });

      // Unique users
      const uniq = {};
      const uniqueUsers = [];
      usersToDecrypt.forEach((u) => {
        if (!u || !u._id) return;
        const id = String(u._id);
        if (!uniq[id]) {
          uniq[id] = true;
          uniqueUsers.push(u);
        }
      });

      const decryptedUsers = decryptUserData(uniqueUsers);
      const decryptMap = {};
      decryptedUsers.forEach((u) => {
        decryptMap[String(u._id)] = u;
      });

      const decryptedConsultations = consultations.map((c) => ({
        ...c,
        doctor: c.doctor ? decryptMap[String(c.doctor._id)] || c.doctor : null,
        beneficiary: c.beneficiary
          ? decryptMap[String(c.beneficiary._id)] || c.beneficiary
          : null,
        registrant: c.registrant
          ? decryptMap[String(c.registrant._id)] || c.registrant
          : null,
      }));

      return res.status(200).json({
        success: true,
        data: decryptedConsultations,
      });
    } catch (err) {
      console.error(
        "❌ [AdminController.getCompletedConsultationsByDoctor] Error:",
        err
      );
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi lấy danh sách tư vấn",
        });
    }
  },

  // Admin: Cập nhật trạng thái hoạt động của bất kỳ user nào
  setUserActive: async (req, res) => {
    try {
      const { userId } = req.params;
      const { isActive } = req.body;

      if (!isValidObjectId(userId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID người dùng không hợp lệ" });
      }

      if (typeof isActive !== "boolean") {
        return res
          .status(400)
          .json({
            success: false,
            message: "Trạng thái isActive phải là boolean",
          });
      }

      // Cập nhật trạng thái isActive cho bất kỳ user nào
      const user = await User.findByIdAndUpdate(
        userId,
        { isActive },
        { new: true, select: "fullName role isActive" }
      );

      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy người dùng" });

      return res.status(200).json({
        success: true,
        message: isActive ? "Đã mở khóa tài khoản" : "Đã khóa tài khoản",
        data: {
          userId: user._id,
          fullName: user.fullName,
          role: user.role,
          isActive: user.isActive,
        },
      });
    } catch (err) {
      console.error("Error updating user status:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi cập nhật trạng thái người dùng",
        });
    }
  },

  // Admin: Lấy danh sách tất cả supporters
  getAllSupporters: async (req, res) => {
    try {
      const supporters = await User.find({ role: "supporter" })
        .select(
          "_id fullName phoneNumber phoneNumberEnc email emailEnc address addressEnc identityCard identityCardEnc currentAddress currentAddressEnc hometown hometownEnc isActive createdAt gender dateOfBirth +phoneNumberEnc +emailEnc +addressEnc +identityCardEnc +currentAddressEnc +hometownEnc"
        )
        .sort({ createdAt: -1 });
      const decryptedSupporters = decryptUserData(supporters);

      return res.status(200).json({ success: true, data: decryptedSupporters });
    } catch (err) {
      console.error("❌ [AdminController.getAllSupporters] Error:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi lấy danh sách supporters",
        });
    }
  },

  // Admin: Kiểm tra trạng thái admin hiện tại
  checkAdminStatus: async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!isValidObjectId(userId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID người dùng không hợp lệ" });
      }

      const user = await User.findById(userId).select(
        "fullName phoneNumber email role isActive createdAt dateOfBirth"
      );
      if (!user)
        return res
          .status(404)
          .json({
            success: false,
            message: "Không tìm thấy người dùng trong database",
          });

      if (user.role !== "admin")
        await User.findByIdAndUpdate(userId, { role: "admin" });
      if (!user.isActive)
        await User.findByIdAndUpdate(userId, { isActive: true });

      return res.status(200).json({
        success: true,
        data: {
          userId: user._id,
          fullName: user.fullName,
          role: "admin",
          isActive: true,
          isAdmin: true,
        },
      });
    } catch (err) {
      console.error("Error checking admin status:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi kiểm tra trạng thái admin",
        });
    }
  },

  refreshAdminToken: async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!isValidObjectId(userId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID người dùng không hợp lệ" });
      }

      const user = await User.findById(userId).select(
        "fullName phoneNumber email role isActive"
      );
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy người dùng" });

      const jwt = require("jsonwebtoken");
      const SECRET_KEY = process.env.JWT_SECRET_KEY;
      const token = jwt.sign(
        { userId: user._id, role: user.role, isActive: user.isActive },
        SECRET_KEY,
        { expiresIn: "7d" }
      );

      return res.status(200).json({
        success: true,
        message: "Token đã được làm mới",
        data: {
          token,
          user: {
            userId: user._id,
            fullName: user.fullName,
            role: user.role,
            isActive: user.isActive,
          },
        },
      });
    } catch (err) {
      console.error("Error refreshing token:", err);
      return res
        .status(500)
        .json({ success: false, message: "Đã xảy ra lỗi khi làm mới token" });
    }
  },

  bulkImportSupporters: async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Không có file được upload" });
    }

    const XLSX = require("xlsx");
    const bcrypt = require("bcrypt");
    const User = require("../models/User");
    const SupporterProfile = require("../models/SupporterProfile");

    /* ================= Helpers ================= */

    const ALLOWED_GENDERS = ["Nam", "Nữ", "Khác"];

    const cleanField = (v) =>
      typeof v === "string" && v.startsWith("'") ? v.slice(1) : v;

    const normalizeGender = (genderRaw) => {
      if (!genderRaw) return genderRaw;

      const g = String(genderRaw)
        .replace(/^'+|'+$/g, "")
        .trim()
        .toLowerCase();

      if (g === "nam" || g === "male") return "Nam";
      if (g === "nữ" || g === "nu" || g === "female") return "Nữ";
      if (g === "khác" || g === "khac" || g === "other") return "Khác";

      return g.charAt(0).toUpperCase() + g.slice(1);
    };

    // ===== normalize header: xoá space, newline =====
    const normalizeRowKeys = (obj) => {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        const nk = String(k).replace(/\s+/g, "");
        out[nk] = v;
      }
      return out;
    };

    // ===== parse dateOfBirth =====
    const parseDOB = (v) => {
      if (!v) return null;

      if (v instanceof Date && !isNaN(v.getTime())) return v;

      if (typeof v === "number") {
        const parsed = XLSX.SSF.parse_date_code(v);
        if (!parsed) return null;
        const d = new Date(parsed.y, parsed.m - 1, parsed.d);
        return isNaN(d.getTime()) ? null : d;
      }

      const s = String(v).trim();
      if (!s) return null;

      const d = new Date(s);
      if (!isNaN(d.getTime())) return d;

      const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (m) {
        const dd = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        return isNaN(dd.getTime()) ? null : dd;
      }

      return null;
    };

    const validateRow = (row) => {
      const errors = [];

      if (!row.fullName) errors.push("Thiếu fullName");
      if (!row.phoneNumber) errors.push("Thiếu phoneNumber");
      if (!row.gender) errors.push("Thiếu gender");
      if (!row.password) errors.push("Thiếu password");
      if (!row.dateOfBirth) errors.push("Thiếu dateOfBirth");
      if (!row.identityCard) errors.push("Thiếu identityCard");

      if (row.gender && !ALLOWED_GENDERS.includes(row.gender)) {
        errors.push("Giới tính không hợp lệ (Nam/Nữ/Khác)");
      }

      if (row.password && String(row.password).length < 6) {
        errors.push("Mật khẩu phải ≥ 6 ký tự");
      }

      return { isValid: errors.length === 0, errors };
    };

    /* ================= Read Excel ================= */

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // defval để ô trống vẫn có key
    const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    if (!rawData.length) {
      return res
        .status(400)
        .json({ success: false, message: "File Excel không có dữ liệu" });
    }

    const results = { success: [], errors: [], total: rawData.length };

    /* ================= Process rows ================= */

    for (let i = 0; i < rawData.length; i++) {
      const rowNumber = i + 2;

      try {
        // 1) normalize header
        let row = normalizeRowKeys(rawData[i]);

        // 2) clean fields
        row = {
          ...row,
          fullName: cleanField(row.fullName),
          phoneNumber: cleanField(row.phoneNumber),
          password: cleanField(row.password),
          dateOfBirth: cleanField(row.dateOfBirth),
          email: cleanField(row.email),
          address: cleanField(row.address),
          identityCard: cleanField(row.identityCard),
        };

        // 3) normalize gender
        row.gender = normalizeGender(row.gender);

        // 4) validate
        const validation = validateRow(row);
        if (!validation.isValid) {
          results.errors.push({ row: rowNumber, errors: validation.errors, data: row });
          continue;
        }

        // ===== EXPERIENCE (FIX CHÍNH) =====
        const totalYears = Number(row["experience.totalYears"] || 0);
        const description = String(row["experience.description"] || "");

        // ===== parse DOB =====
        const dob = parseDOB(row.dateOfBirth);
        if (!dob) {
          results.errors.push({
            row: rowNumber,
            errors: ["dateOfBirth không hợp lệ"],
            data: row,
          });
          continue;
        }

        // ===== hash password =====
        const hashedPassword = await bcrypt.hash(String(row.password), 12);

        // ===== create user =====
        const user = new User();
        user.fullName = String(row.fullName).trim();
        user.gender = row.gender;
        user.password = hashedPassword;
        user.role = "supporter";
        user.isActive = true;
        user.dateOfBirth = dob;
        user.phoneNumber = String(row.phoneNumber);

        if (row.email) user.email = String(row.email).trim().toLowerCase();
        if (row.address) user.address = String(row.address).trim();
        user.identityCard = String(row.identityCard).trim();

        await user.save();

        // ===== create supporter profile =====
        await SupporterProfile.create({
          user: user._id,
          experience: {
            totalYears,
            description,
          },
        });

        results.success.push({
          row: rowNumber,
          userId: user._id,
          fullName: user.fullName,
          experience: { totalYears, description },
        });
      } catch (err) {
        console.error(`❌ bulkImport row ${rowNumber}`, err);
        results.errors.push({
          row: rowNumber,
          errors: [err.message || "Lỗi không xác định"],
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Import xong: ${results.success.length}/${results.total}`,
      data: results,
    });
  } catch (err) {
    console.error("❌ bulkImportSupporters", err);
    return res.status(500).json({
      success: false,
      message: "Lỗi server khi import Excel",
    });
  }
},


  bulkImportDoctors: async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "Không có file được upload" });
      }

      const XLSX = require("xlsx");
      const bcrypt = require("bcrypt");
      const User = require("../models/User");
      const DoctorProfile = require("../models/DoctorProfile");

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);

      if (!data || data.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "File Excel không có dữ liệu" });
      }

      const results = {
        success: [],
        errors: [],
        total: data.length,
      };

      // ===== Helpers (match createDoctor) =====
      const ALLOWED_GENDERS = ["Nam", "Nữ", "Khác"];

      const cleanField = (v) =>
        typeof v === "string" && v.startsWith("'") ? v.slice(1) : v;

      const normalizeGender = (genderRaw) => {
        if (!genderRaw) return genderRaw;
        let g = String(genderRaw)
          .replace(/^'+|'+$/g, "")
          .trim()
          .toLowerCase();

        if (g === "nam" || g === "male") return "Nam";
        if (g === "nữ" || g === "nu" || g === "female") return "Nữ";
        if (g === "khác" || g === "khac" || g === "other") return "Khác";

        return g.charAt(0).toUpperCase() + g.slice(1);
      };

      const parseDOB = (v) => {
        if (v == null || v === "") return null;

        if (v instanceof Date && !isNaN(v.getTime())) return v;

        // Excel serial number
        if (typeof v === "number") {
          const parsed = XLSX.SSF.parse_date_code(v);
          if (!parsed) return null;
          const d = new Date(parsed.y, parsed.m - 1, parsed.d);
          return isNaN(d.getTime()) ? null : d;
        }

        const s = String(v).trim();
        if (!s) return null;

        // direct parse
        const d1 = new Date(s);
        if (!isNaN(d1.getTime())) return d1;

        // dd/mm/yyyy or dd-mm-yyyy
        const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (m) {
          const day = Number(m[1]);
          const month = Number(m[2]);
          const year = Number(m[3]);
          const d2 = new Date(year, month - 1, day);
          return isNaN(d2.getTime()) ? null : d2;
        }

        return null;
      };

      const validateRowLikeCreateDoctor = (row) => {
        const errors = [];

        if (!row.fullName) errors.push("Thiếu thông tin bắt buộc: fullName");
        if (!row.phoneNumber)
          errors.push("Thiếu thông tin bắt buộc: phoneNumber");
        if (!row.gender) errors.push("Thiếu thông tin bắt buộc: gender");
        if (!row.password) errors.push("Thiếu thông tin bắt buộc: password");
        if (!row.dateOfBirth)
          errors.push("Thiếu thông tin bắt buộc: dateOfBirth");
        if (!row.identityCard)
          errors.push("Thiếu thông tin bắt buộc: identityCard");

        if (row.gender && !ALLOWED_GENDERS.includes(row.gender)) {
          errors.push("Giới tính không hợp lệ");
        }

        if (row.password && String(row.password).length < 6) {
          errors.push("Mật khẩu phải có ít nhất 6 ký tự");
        }

        return { isValid: errors.length === 0, errors };
      };

      // ===== Process rows =====
      for (let i = 0; i < data.length; i++) {
        const rowNumber = i + 2; // header at row 1
        let row = data[i];

        try {
          // clean & normalize fields
          row = {
            ...row,
            fullName: cleanField(row.fullName),
            phoneNumber: cleanField(row.phoneNumber),
            gender: normalizeGender(cleanField(row.gender)),
            password: cleanField(row.password),
            email: cleanField(row.email),
            dateOfBirth: cleanField(row.dateOfBirth),
            address: cleanField(row.address),
            identityCard: cleanField(row.identityCard),

            // doctor fields
            specialization: cleanField(row.specialization),
            experience: cleanField(row.experience),
            description: cleanField(row.description),
          };

          // validate required like createDoctor
          const validation = validateRowLikeCreateDoctor(row);
          if (!validation.isValid) {
            results.errors.push({
              row: rowNumber,
              errors: validation.errors,
              data: row,
            });
            continue;
          }

          // normalize phone like createDoctor
          const normalizedPhone = normalizePhoneVN(String(row.phoneNumber));
          if (!normalizedPhone) {
            results.errors.push({
              row: rowNumber,
              errors: ["Số điện thoại không hợp lệ"],
              data: row,
            });
            continue;
          }

          const localPhone = normalizedPhone.startsWith("84")
            ? "0" + normalizedPhone.slice(2)
            : normalizedPhone;

          const phoneHashesToCheck = [
            ...new Set(
              [
                hmacIndex(normalizedPhone),
                localPhone ? hmacIndex(localPhone) : null,
              ].filter(Boolean)
            ),
          ];

          const existingPhone = await User.findOne({
            isActive: true,
            phoneNumberHash: { $in: phoneHashesToCheck },
          });
          if (existingPhone) {
            results.errors.push({
              row: rowNumber,
              errors: ["Số điện thoại đã được sử dụng"],
              data: row,
            });
            continue;
          }

          // email check like createDoctor (only if has email)
          let emailNorm = null;
          if (row.email?.trim()) {
            emailNorm = String(row.email).trim().toLowerCase();
            const emailHash = hmacIndex(emailNorm);
            const existingEmail = await User.findOne({
              emailHash,
              isActive: true,
            });
            if (existingEmail) {
              results.errors.push({
                row: rowNumber,
                errors: ["Email đã được sử dụng"],
                data: row,
              });
              continue;
            }
          }

          // identityCard required + uniqueness like createDoctor
          const identityCardStr = String(row.identityCard).trim();
          const identityCardHash = hmacIndex(identityCardStr);
          const existingIdentityCard = await User.findOne({
            identityCardHash,
            isActive: true,
          });
          if (existingIdentityCard) {
            results.errors.push({
              row: rowNumber,
              errors: ["CMND/CCCD đã được sử dụng"],
              data: row,
            });
            continue;
          }

          // dateOfBirth parse
          const parsedDateOfBirth = parseDOB(row.dateOfBirth);
          if (!parsedDateOfBirth) {
            results.errors.push({
              row: rowNumber,
              errors: ["dateOfBirth không hợp lệ"],
              data: row,
            });
            continue;
          }

          // hash password
          const hashedPassword = await bcrypt.hash(String(row.password), 12);

          // create User (prefer setter/plugin)
          const user = new User();
          user.fullName = String(row.fullName).trim();
          user.gender = row.gender;
          user.password = hashedPassword;
          user.role = "doctor";
          user.isActive = true;
          user.dateOfBirth = parsedDateOfBirth;
          user.phoneNumber = normalizedPhone;

          if (emailNorm) {
            user.email = emailNorm;
            // nếu schema không tự set emailHash, bạn có thể set thủ công:
            // user.emailHash = hmacIndex(emailNorm);
          }

          if (row.address?.trim()) user.address = String(row.address).trim();

          user.identityCard = identityCardStr;
          // nếu schema không tự set identityCardHash, bạn có thể set thủ công:
          // user.identityCardHash = identityCardHash;

          await user.save();

          // create DoctorProfile like createDoctor
          const profileData = {
            user: user._id,
            specialization: String(row.specialization || "").trim(),
            experience: parseInt(row.experience, 10) || 0,
            description: String(row.description || "").trim(),
            ratingStats: {
              averageRating: 0,
              totalRatings: 0,
            },
            stats: {
              totalConsultations: 0,
            },
          };

          const doctorProfile = await DoctorProfile.create(profileData);

          results.success.push({
            row: rowNumber,
            userId: user._id,
            doctorProfileId: doctorProfile._id,
            fullName: user.fullName,
            phoneNumber: normalizedPhone,
            email: emailNorm || null,
            specialization: profileData.specialization,
            experience: profileData.experience,
          });
        } catch (err) {
          console.error(
            `❌ [AdminController.bulkImportDoctors] Error at row ${rowNumber}:`,
            err
          );
          results.errors.push({
            row: rowNumber,
            errors: [err?.message || "Lỗi không xác định"],
            data: row,
          });
        }
      }

      return res.status(200).json({
        success: true,
        message: `Import hoàn thành: ${results.success.length}/${results.total} thành công`,
        data: results,
      });
    } catch (err) {
      console.error("❌ [AdminController.bulkImportDoctors] Error:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi import file Excel",
        });
    }
  },

  // Admin: Lấy danh sách các đăng ký gói khám (mặc định chỉ các đăng ký có beneficiary là người già)
  getRegisteredPackages: async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page || "1"));
      const limit = Math.max(
        1,
        Math.min(100, parseInt(req.query.limit || "20"))
      );
      const skip = (page - 1) * limit;
      const { beneficiaryId, doctorId, status } = req.query;

      const query = {};
      if (beneficiaryId) {
        if (!isValidObjectId(beneficiaryId))
          return res
            .status(400)
            .json({ success: false, message: "ID người hưởng không hợp lệ" });
        query.beneficiary = beneficiaryId;
      }
      if (doctorId) {
        if (!isValidObjectId(doctorId))
          return res
            .status(400)
            .json({ success: false, message: "ID bác sĩ không hợp lệ" });
        query.doctor = doctorId;
      }
      if (status) {
        query.status = status;
      }

      // Fetch consultations with populated references
      let docs = await RegistrationConsulation.find(query)
        .populate({
          path: "doctor",
          select:
            "fullName role phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc",
        })
        .populate({
          path: "beneficiary",
          select:
            "fullName role dateOfBirth phoneNumber phoneNumberEnc email emailEnc address addressEnc avatar +phoneNumberEnc +emailEnc +addressEnc",
        })
        .populate({
          path: "registrant",
          select:
            "fullName role phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc",
        })
        .sort({ registeredAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      // Count total
      const total = await RegistrationConsulation.countDocuments(query);

      // Decrypt populated users in batch
      const usersToDecrypt = [];
      docs.forEach((d) => {
        if (d.beneficiary && d.beneficiary._id)
          usersToDecrypt.push(d.beneficiary);
        if (d.registrant && d.registrant._id) usersToDecrypt.push(d.registrant);
        if (d.doctor && d.doctor._id) usersToDecrypt.push(d.doctor);
      });

      // Unique by _id
      const uniq = {};
      const uniqueUsers = [];
      usersToDecrypt.forEach((u) => {
        if (!u || !u._id) return;
        const id = String(u._id);
        if (!uniq[id]) {
          uniq[id] = true;
          uniqueUsers.push(u);
        }
      });

      // Decrypt users safely
      if (uniqueUsers.length > 0) {
        try {
          const decrypted = decryptUserData(uniqueUsers);
          const decMap = {};
          decrypted.forEach((u) => {
            if (u && u._id) {
              decMap[String(u._id)] = u;
            }
          });

          // attach decrypted users back to docs
          docs = docs.map((d) => {
            if (
              d.beneficiary &&
              d.beneficiary._id &&
              decMap[String(d.beneficiary._id)]
            ) {
              d.beneficiary = decMap[String(d.beneficiary._id)];
            }
            if (
              d.registrant &&
              d.registrant._id &&
              decMap[String(d.registrant._id)]
            ) {
              d.registrant = decMap[String(d.registrant._id)];
            }
            if (d.doctor && d.doctor._id && decMap[String(d.doctor._id)]) {
              d.doctor = decMap[String(d.doctor._id)];
            }
            return d;
          });
        } catch (decryptErr) {
          // Continue without decryption if it fails
        }
      }

      return res.status(200).json({
        success: true,
        data: {
          total,
          page,
          limit,
          items: docs,
        },
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Đã xảy ra lỗi khi lấy danh sách lịch tư vấn",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  },

  // Admin: Lấy chi tiết 1 lịch tư vấn (có decrypt phone/email/address/currentAddress)
 getRegisteredPackageById: async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "ID lịch tư vấn không hợp lệ" });
    }

    // =========================
    // 0) Fetch registration
    // =========================
    const doc = await RegistrationConsulation.findById(id)
      .populate({
        path: "doctor",
        select:
          "fullName role gender avatar " +
          "phoneNumberEnc emailEnc addressEnc currentAddress " +
          "+phoneNumberEnc +emailEnc +addressEnc",
      })
      .populate({
        path: "beneficiary",
        select:
          "fullName role dateOfBirth gender avatar " +
          "phoneNumberEnc emailEnc addressEnc currentAddress " +
          "+phoneNumberEnc +emailEnc +addressEnc",
      })
      .populate({
        path: "registrant",
        select:
          "fullName role gender avatar " +
          "phoneNumberEnc emailEnc addressEnc currentAddress " +
          "bankName bankAccountNumber bankAccountHolderName " +
          "+phoneNumberEnc +emailEnc +addressEnc",
      })
      .lean();

    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy lịch tư vấn" });
    }

    // =========================
    // 1) Fetch ConsultationSummary
    // =========================
    let doctorNote = "";
    let consultationSummary = null;

    try {
      const summary = await ConsultationSummary.findOne({
        registration: id,
      }).lean();

      if (summary) {
        doctorNote = summary.note || "";
        consultationSummary = summary;
      }
    } catch (summaryErr) {
      console.warn(
        "⚠️ Error fetching ConsultationSummary:",
        summaryErr?.message || summaryErr
      );
    }

    // =========================
    // 2) Decrypt helpers (FIX: detect đúng ciphertext format)
    // =========================
    const crypto = require("crypto");
    const ENC_KEY = Buffer.from(process.env.ENC_KEY || "", "base64");

    const isPackedGCM = (s) => {
      // format mới: iv.tag.data (base64url) => đúng 3 phần
      const parts = String(s).split(".");
      if (parts.length !== 3) return false;
      return parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p));
    };

    const isLegacyGCM = (s) => {
      // format cũ: iv:ct:tag (base64) => đúng 3 phần
      const parts = String(s).split(":");
      if (parts.length !== 3) return false;
      return parts.every((p) => /^[A-Za-z0-9+/=]+$/.test(p));
    };

    const decryptLegacy = (enc) => {
      if (!enc) return null;
      const [ivB64, ctB64, tagB64] = String(enc).split(":");
      if (!ivB64 || !ctB64 || !tagB64) return null;

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
      if (!ivB64 || !tagB64 || !dataB64) return null;

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
        // ✅ FIX: chỉ decrypt khi đúng "shape" ciphertext
        // Tránh nhầm email dạng abc.def@gmail.com (có dấu .)
        if (isPackedGCM(s)) return decryptGCM(s);
        if (isLegacyGCM(s)) return decryptLegacy(s);

        // plain text
        return s;
      } catch (e) {
        // ✅ FIX: decrypt fail thì trả về nguyên văn (đừng trả null)
        return s;
      }
    };

    // optional: nếu có encrypt lồng nhau
    const deepDecrypt = (v, passes = 3) => {
      let cur = v;
      for (let i = 0; i < passes; i++) {
        const out = tryDecryptAny(cur);
        if (out == null || out === cur) return out;
        cur = out;
      }
      return cur;
    };

    // =========================
    // 3) Sanitize + Decrypt user object (có fallback)
    // =========================
    const sanitizeUser = (u) => {
      if (!u) return null;

      const phoneNumber =
        u.phoneNumberEnc != null && u.phoneNumberEnc !== ""
          ? deepDecrypt(u.phoneNumberEnc) ?? u.phoneNumber ?? ""
          : u.phoneNumber ?? "";

      const email =
        u.emailEnc != null && u.emailEnc !== ""
          ? deepDecrypt(u.emailEnc) ?? u.email ?? ""
          : u.email ?? "";

      const address =
        u.addressEnc != null && u.addressEnc !== ""
          ? deepDecrypt(u.addressEnc) ?? u.address ?? ""
          : u.address ?? "";

      const currentAddress =
        u.currentAddress != null && u.currentAddress !== ""
          ? deepDecrypt(u.currentAddress) ?? u.currentAddress ?? ""
          : "";

      const bankAccountNumber =
        u.bankAccountNumber != null && u.bankAccountNumber !== ""
          ? deepDecrypt(u.bankAccountNumber) ?? u.bankAccountNumber ?? ""
          : "";

      const cleaned = {
        ...u,
        phoneNumber,
        email,
        address,
        currentAddress,
        bankAccountNumber,
      };

      delete cleaned.phoneNumberEnc;
      delete cleaned.emailEnc;
      delete cleaned.addressEnc;
      delete cleaned.identityCardEnc;

      return cleaned;
    };

    // Apply decrypt to populated users
    doc.doctor = sanitizeUser(doc.doctor);
    doc.registrant = sanitizeUser(doc.registrant);
    doc.beneficiary = sanitizeUser(doc.beneficiary);

    // =========================
    // 4) Attach summary fields
    // =========================
    doc.doctorNote = doctorNote;
    doc.consultationSummary = consultationSummary;

    res.set("Cache-Control", "no-store");
    console.log("✅ getRegisteredPackageById success:", doc);
    return res.status(200).json({ success: true, data: doc });
  } catch (err) {
    console.error("❌ getRegisteredPackageById error:", err);
    return res.status(500).json({
      success: false,
      message: "Đã xảy ra lỗi khi lấy chi tiết lịch tư vấn",
      error: process.env.NODE_ENV === "development" ? err?.message : undefined,
    });
  }
},

  // Admin: Cập nhật trạng thái thanh toán cho lịch tư vấn
  updateConsultationPaymentStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { paymentStatus } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ 
          success: false, 
          message: "ID lịch tư vấn không hợp lệ" 
        });
      }

      if (!paymentStatus) {
        return res.status(400).json({ 
          success: false, 
          message: "Thiếu paymentStatus." 
        });
      }

      const registration = await RegistrationConsulation.findById(id);
      if (!registration) {
        return res.status(404).json({ 
          success: false, 
          message: "Không tìm thấy lịch tư vấn" 
        });
      }

      registration.paymentStatus = paymentStatus;
      await registration.save();

      return res.status(200).json({
        success: true,
        message: "Cập nhật trạng thái thanh toán thành công",
        data: registration,
      });
    } catch (error) {
      console.error("Error updating consultation payment status:", error);
      return res.status(500).json({
        success: false,
        message: "Cập nhật trạng thái thanh toán thất bại",
        error: error?.message || error,
      });
    }
  },


  // Admin: Lấy danh sách lịch tư vấn của một người cao tuổi
  getConsultationSchedulesByBeneficiary: async (req, res) => {
    try {
      const { beneficiaryId } = req.params;
      if (!isValidObjectId(beneficiaryId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID người cao tuổi không hợp lệ" });
      }

      const schedules = await RegistrationConsulation.find({
        beneficiary: beneficiaryId,
      })
        .populate({
          path: "doctor",
          select:
            "fullName role phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc",
        })
        .populate({
          path: "registrant",
          select:
            "fullName role phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc",
        })
        .sort({ scheduledDate: -1 })
        .lean();

      // Lấy ConsultationSummary cho mỗi lịch tư vấn
      const schedulesWithSummary = await Promise.all(
        schedules.map(async (schedule) => {
          const summary = await ConsultationSummary.findOne({
            registration: schedule._id,
          }).lean();
          return {
            ...schedule,
            consultationSummary: summary || null,
          };
        })
      );

      // Decrypt user data
      const users = [];
      schedulesWithSummary.forEach((sch) => {
        if (sch.doctor && sch.doctor._id) users.push(sch.doctor);
        if (sch.registrant && sch.registrant._id) users.push(sch.registrant);
      });

      let decryptedUsers = [];
      if (users.length > 0) {
        try {
          decryptedUsers = decryptUserData(users);
        } catch (decryptErr) {
          console.warn("⚠️ Error decrypting user data:", decryptErr.message);
        }
      }

      const decMap = {};
      decryptedUsers.forEach((u) => {
        if (u && u._id) {
          decMap[String(u._id)] = u;
        }
      });

      // Apply decrypted data
      const finalSchedules = schedulesWithSummary.map((sch) => {
        const result = { ...sch };
        if (sch.doctor && sch.doctor._id && decMap[String(sch.doctor._id)]) {
          result.doctor = decMap[String(sch.doctor._id)];
        }
        if (
          sch.registrant &&
          sch.registrant._id &&
          decMap[String(sch.registrant._id)]
        ) {
          result.registrant = decMap[String(sch.registrant._id)];
        }
        return result;
      });

      return res.status(200).json({ success: true, data: finalSchedules });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Đã xảy ra lỗi khi lấy danh sách lịch tư vấn",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  },

  // Admin: Dashboard stats
  getDashboard: async (req, res) => {
    try {
      // Counts by role
      const [totalResidents, familyMembers, activeSupporters, doctors, admins] =
        await Promise.all([
          User.countDocuments({ role: "elderly" }),
          User.countDocuments({ role: "family" }),
          User.countDocuments({ role: "supporter", isActive: true }),
          User.countDocuments({ role: "doctor" }),
          User.countDocuments({ role: "admin" }),
        ]);

      // Payments summary (group by status)
      const paymentsAgg = await Payment.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            total: { $sum: "$totalAmount" },
          },
        },
      ]);

      const paymentsByStatus = {};
      let totalRevenue = 0;
      for (const p of paymentsAgg) {
        paymentsByStatus[p._id] = { count: p.count, total: p.total };
        if (p._id === "completed") totalRevenue += p.total;
      }

      // Monthly revenue (current month, completed payments)
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const endOfMonth = new Date(startOfMonth);
      endOfMonth.setMonth(endOfMonth.getMonth() + 1);

      const monthlyAgg = await Payment.aggregate([
        {
          $match: {
            status: "completed",
            completedAt: { $gte: startOfMonth, $lt: endOfMonth },
          },
        },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]);

      const monthlyRevenue = (monthlyAgg[0] && monthlyAgg[0].total) || 0;

      return res.status(200).json({
        success: true,
        data: {
          counts: {
            totalResidents,
            familyMembers,
            activeSupporters,
            doctors,
            admins,
          },
          paymentsByStatus,
          totalRevenue,
          monthlyRevenue,
        },
      });
    } catch (err) {
      console.error("❌ [AdminController.getDashboard] Error:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi lấy dữ liệu dashboard",
        });
    }
  },

  // Admin: Lấy danh sách bác sĩ gần nhất dựa trên địa chỉ người già
  getNearbyDoctors: async (req, res) => {
    try {
      const { elderlyId, maxDistance = 50 } = req.query; // maxDistance in km, default 50km

      if (!elderlyId || !isValidObjectId(elderlyId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID người già không hợp lệ" });
      }

      // Lấy thông tin người già
      const elderly = await User.findById(elderlyId)
        .select(
          "currentLocation coordinates currentAddress address addressEnc fullName +currentLocation +coordinates +addressEnc"
        )
        .lean();

      if (!elderly) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy người già" });
      }

      // Giải mã địa chỉ nếu cần
      let elderlyLocation = null;
      if (
        elderly.currentLocation &&
        elderly.currentLocation.coordinates &&
        elderly.currentLocation.coordinates.length === 2
      ) {
        // Sử dụng GeoJSON format: [longitude, latitude]
        const [longitude, latitude] = elderly.currentLocation.coordinates;
        elderlyLocation = { latitude, longitude };
      } else if (
        elderly.coordinates &&
        elderly.coordinates.latitude &&
        elderly.coordinates.longitude
      ) {
        // Sử dụng plain object format
        elderlyLocation = {
          latitude: elderly.coordinates.latitude,
          longitude: elderly.coordinates.longitude,
        };
      }

      if (!elderlyLocation) {
        return res.status(400).json({
          success: false,
          message:
            "Người già chưa có thông tin vị trí. Vui lòng cập nhật địa chỉ.",
        });
      }

      const DoctorProfile = require("../models/DoctorProfile");

      // Tìm tất cả bác sĩ đang hoạt động
      const doctors = await User.find({
        role: "doctor",
        isActive: true,
      })
        .select(
          "fullName currentLocation coordinates phoneNumber phoneNumberEnc email emailEnc avatar +currentLocation +coordinates +phoneNumberEnc +emailEnc"
        )
        .lean();

      // Lấy thông tin profile của các bác sĩ
      const doctorIds = doctors.map((d) => d._id);
      const doctorProfiles = await DoctorProfile.find({
        user: { $in: doctorIds },
      })
        .select("user specialization experience description ratingStats")
        .lean();

      // Tạo map để dễ dàng lookup
      const profileMap = {};
      doctorProfiles.forEach((profile) => {
        profileMap[String(profile.user)] = profile;
      });

      // Tính toán khoảng cách và sắp xếp
      const doctorsWithDistance = doctors.map((doctor) => {
        let distance = null;
        let doctorLocation = null;

        // Lấy tọa độ của bác sĩ
        if (
          doctor.currentLocation &&
          doctor.currentLocation.coordinates &&
          doctor.currentLocation.coordinates.length === 2
        ) {
          const [longitude, latitude] = doctor.currentLocation.coordinates;
          doctorLocation = { latitude, longitude };
        } else if (
          doctor.coordinates &&
          doctor.coordinates.latitude &&
          doctor.coordinates.longitude
        ) {
          doctorLocation = {
            latitude: doctor.coordinates.latitude,
            longitude: doctor.coordinates.longitude,
          };
        }

        // Tính khoảng cách nếu có tọa độ
        if (doctorLocation) {
          distance = calculateDistance(
            elderlyLocation.latitude,
            elderlyLocation.longitude,
            doctorLocation.latitude,
            doctorLocation.longitude
          );
        }

        const profile = profileMap[String(doctor._id)];

        return {
          _id: doctor._id,
          fullName: doctor.fullName,
          avatar: doctor.avatar,
          phoneNumber: doctor.phoneNumber,
          email: doctor.email,
          specialization: profile?.specialization || "",
          experience: profile?.experience || 0,
          ratingStats: profile?.ratingStats || {
            averageRating: 0,
            totalRatings: 0,
          },
          distance: distance ? parseFloat(distance.toFixed(2)) : null, // km
          hasLocation: !!doctorLocation,
        };
      });

      // Lọc bác sĩ trong khoảng cách cho phép và sắp xếp theo khoảng cách
      const filteredDoctors = doctorsWithDistance
        .filter((d) => d.distance !== null && d.distance <= maxDistance)
        .sort((a, b) => {
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });

      // Giải mã thông tin bác sĩ
      const decryptedDoctors = decryptUserData(filteredDoctors);

      return res.status(200).json({
        success: true,
        data: {
          elderly: {
            _id: elderly._id,
            fullName: elderly.fullName,
            location: elderlyLocation,
          },
          doctors: decryptedDoctors,
          total: decryptedDoctors.length,
          maxDistance: parseFloat(maxDistance),
        },
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Đã xảy ra lỗi khi lấy danh sách bác sĩ gần nhất",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  },

  // Admin: Gán bác sĩ cho đăng ký gói khám
  assignDoctorToRegistration: async (req, res) => {
    try {
      const { registrationId } = req.params;
      const { doctorId } = req.body;

      if (!isValidObjectId(registrationId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID đăng ký không hợp lệ" });
      }

      if (!doctorId || !isValidObjectId(doctorId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID bác sĩ không hợp lệ" });
      }

      // Kiểm tra registration tồn tại
      const registration = await RegistrationHealthPackage.findById(
        registrationId
      );
      if (!registration) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy đăng ký gói khám" });
      }

      // Kiểm tra bác sĩ tồn tại và là bác sĩ
      const doctor = await User.findById(doctorId).select(
        "role isActive fullName"
      );
      if (!doctor) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy bác sĩ" });
      }

      if (doctor.role !== "doctor") {
        return res
          .status(400)
          .json({
            success: false,
            message: "Người dùng này không phải là bác sĩ",
          });
      }

      if (!doctor.isActive) {
        return res
          .status(400)
          .json({ success: false, message: "Bác sĩ này không còn hoạt động" });
      }

      // Cập nhật bác sĩ cho registration
      registration.doctor = doctorId;
      await registration.save();

      // Populate để trả về thông tin đầy đủ
      const updatedRegistration = await RegistrationHealthPackage.findById(
        registrationId
      )
        .populate("packageRef", "title durationDays price description isActive")
        .populate({
          path: "beneficiary",
          select:
            "fullName role dateOfBirth phoneNumber phoneNumberEnc email emailEnc avatar +phoneNumberEnc +emailEnc",
        })
        .populate({
          path: "registrant",
          select:
            "fullName role phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc",
        })
        .populate({
          path: "doctor",
          select:
            "fullName role phoneNumber phoneNumberEnc email emailEnc avatar +phoneNumberEnc +emailEnc",
        })
        .lean();

      // Giải mã thông tin người dùng
      const users = [];
      if (updatedRegistration.beneficiary)
        users.push(updatedRegistration.beneficiary);
      if (updatedRegistration.registrant)
        users.push(updatedRegistration.registrant);
      if (updatedRegistration.doctor) users.push(updatedRegistration.doctor);

      if (users.length > 0) {
        try {
          const decrypted = decryptUserData(users);
          const decMap = {};
          decrypted.forEach((u) => {
            if (u && u._id) {
              decMap[String(u._id)] = u;
            }
          });

          if (
            updatedRegistration.beneficiary &&
            decMap[String(updatedRegistration.beneficiary._id)]
          ) {
            updatedRegistration.beneficiary =
              decMap[String(updatedRegistration.beneficiary._id)];
          }
          if (
            updatedRegistration.registrant &&
            decMap[String(updatedRegistration.registrant._id)]
          ) {
            updatedRegistration.registrant =
              decMap[String(updatedRegistration.registrant._id)];
          }
          if (
            updatedRegistration.doctor &&
            decMap[String(updatedRegistration.doctor._id)]
          ) {
            updatedRegistration.doctor =
              decMap[String(updatedRegistration.doctor._id)];
          }
        } catch (decryptErr) {}
      }

      return res.status(200).json({
        success: true,
        message: "Đã gán bác sĩ thành công",
        data: updatedRegistration,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Đã xảy ra lỗi khi gán bác sĩ",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  },
  // GET /relationships/accepted-family/:familyId
  getAcceptRelationshipByFamilyIdAdmin: async (req, res) => {
    try {
      const { familyId } = req.params;
      if (!familyId || typeof familyId !== "string") {
        return res
          .status(400)
          .json({ success: false, message: "Thiếu hoặc sai familyId" });
      }
      const Relationship = require("../models/Relationship");
      const relationships = await Relationship.find({
        family: familyId,
        status: "accepted",
      })
        .populate(
          "elderly",
          "fullName avatar phoneNumber phoneNumberEnc addressEnc addressHash currentLocation _id"
        )
        .populate("requestedBy", "fullName avatar phoneNumber phoneNumberEnc");

      const decryptedRelationships =
        typeof decryptPhoneNumbers === "function"
          ? decryptPhoneNumbers(relationships)
          : relationships;

      return res.status(200).json({
        success: true,
        data: decryptedRelationships,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error?.message || error,
      });
    }
  },

  getAcceptRelationshipByElderlyIdAdmin: async (req, res) => {
    try {
      const { elderlyId } = req.params;
      if (!elderlyId || typeof elderlyId !== "string") {
        return res
          .status(400)
          .json({ success: false, message: "Thiếu hoặc sai elderlyId" });
      }
      const Relationship = require("../models/Relationship");
      const relationships = await Relationship.find({
        elderly: elderlyId,
        status: "accepted",
      })
        .populate(
          "family",
          "fullName avatar phoneNumber phoneNumberEnc addressEnc addressHash currentLocation _id"
        )
        .populate("requestedBy", "fullName avatar phoneNumber phoneNumberEnc");

      const decryptedRelationships =
        typeof decryptPhoneNumbers === "function"
          ? decryptPhoneNumbers(relationships)
          : relationships;

      return res.status(200).json({
        success: true,
        data: decryptedRelationships,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error?.message || error,
      });
    }
  },
  // Admin: Lấy danh sách lịch hẹn supporter theo status
  // Admin: Lấy lịch khám bác sĩ và lịch hẹn supporter đã hoàn thành
  getCompletedSchedules: async (req, res) => {
    try {
      // Lấy lịch khám bác sĩ có status = 'completed'
      const completedConsultations = await RegistrationConsulation.find({
        status: "completed",
      })
        .populate({ path: "doctor", select: "fullName phoneNumber email" })
        .populate({ path: "registrant", select: "fullName phoneNumber email" })
        .populate({ path: "beneficiary", select: "fullName phoneNumber email" })
        .sort({ registeredAt: -1 });

      // Lấy lịch hẹn supporter có status = 'completed'
      const completedSupporterSchedules = await SupporterScheduling.find({
        status: "completed",
      })
        .populate({ path: "supporter", select: "fullName phoneNumber email" })
        .populate({ path: "registrant", select: "fullName phoneNumber email" })
        .populate({ path: "elderly", select: "fullName phoneNumber email" })
        .populate({ path: "service", select: "name" })
        .sort({ startDate: -1 });

      return res.status(200).json({
        success: true,
        data: {
          completedConsultations,
          completedSupporterSchedules,
        },
      });
    } catch (err) {
      console.error("[getCompletedSchedules] Error:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi lấy danh sách lịch hoàn thành",
        });
    }
  },

  // Lấy toàn bộ danh sách lịch hẹn supporter
  getAllSupporterSchedules: async (req, res) => {
    try {
      const schedules = await SupporterScheduling.find()
        .populate({ path: "supporter", select: "fullName phoneNumber email" })
        .populate({ path: "elderly", select: "fullName phoneNumber email" })
        .populate({ path: "service", select: "name" })
        .sort({ createdAt: -1 });
      return res.status(200).json({ success: true, data: schedules });
    } catch (err) {
      console.error("[getAllSupporterSchedules] Error:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi lấy danh sách lịch hẹn supporter",
        });
    }
  },

  //Lấy toàn bộ danh sách lịch hẹn doctor
  getAllDoctorSchedules: async (req, res) => {
    try {
      const schedules = await RegistrationConsulation.find()
        .populate({ path: "doctor", select: "fullName phoneNumber email" })
        .populate({ path: "beneficiary", select: "fullName phoneNumber email" })
        .populate({ path: "registrant", select: "fullName phoneNumber email" })
        .sort({ createdAt: -1 });
      return res.status(200).json({ success: true, data: schedules });
    } catch (err) {
      console.error("[getAllDoctorSchedules] Error:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi lấy danh sách lịch hẹn doctor",
        });
    }
  },

  // Lấy danh sách lịch hẹn supporter theo Id

  getSupporterSchedulesById: async (req, res) => {
    try {
      const { supporterId } = req.params;
      if (!isValidObjectId(supporterId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID supporter không hợp lệ" });
      }
      // Populate các trường cần thiết
      const schedules = await SupporterScheduling.find({
        supporter: supporterId,
      })
        .populate({ path: "supporter", select: "fullName phoneNumber email" })
        .populate({ path: "elderly", select: "fullName phoneNumber email" })
        .populate({ path: "service", select: "name" })
        .sort({ createdAt: -1 });
      return res.status(200).json({ success: true, data: schedules });
    } catch (err) {
      console.error("[getSupporterSchedulesById] Error:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi lấy danh sách lịch hẹn supporter",
        });
    }
  },

  // Lấy danh sách lịch hẹn supporter theo Id người già
  getSupporterSchedulesByElderlyId: async (req, res) => {
    try {
      const { elderlyId } = req.params;
      if (!isValidObjectId(elderlyId)) {
        return res
          .status(400)
          .json({ success: false, message: "ID người già không hợp lệ" });
      }
      // Populate các trường cần thiết
      const schedules = await SupporterScheduling.find({ elderly: elderlyId })
        .populate({ path: "supporter", select: "fullName phoneNumber email" })
        .populate({ path: "elderly", select: "fullName phoneNumber email" })
        .populate({ path: "service", select: "name" })
        .sort({ createdAt: -1 });
      return res.status(200).json({ success: true, data: schedules });
    } catch (err) {
      console.error("[getSupporterSchedulesByElderlyId] Error:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Đã xảy ra lỗi khi lấy danh sách lịch hẹn supporter",
        });
    }
  },
};

// Helper function: Tính khoảng cách Haversine (km)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Bán kính Trái Đất (km)
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

module.exports = AdminController;
