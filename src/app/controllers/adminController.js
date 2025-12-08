const mongoose = require('mongoose');
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const SupporterProfile = require("../models/SupporterProfile");
const SupporterScheduling = require("../models/SupporterScheduling");
const RegistrationConsulation = require("../models/RegistrationConsulation");
const { normalizePhoneVN, hmacIndex } = require("../../utils/cryptoFields");
const crypto = require('crypto');
const XLSX = require('xlsx');9
const Payment = require("../models/Payment");

if (!mongoose.models.RegistrationHealthPackage) {
  console.warn('⚠️ RegistrationHealthPackage model chưa được đăng ký, đang thử require lại...');
  require("../models/RegistrationConsulation");
}

// === Helper kiểm tra ObjectId hợp lệ ===
const isValidObjectId = (v) => typeof v === "string" && /^[a-fA-F0-9]{24}$/.test(v);


const decryptUserData = (users) => {
  try {
    const ENC_KEY = Buffer.from(process.env.ENC_KEY || '', 'base64');
    if (!ENC_KEY || ENC_KEY.length === 0) {
      console.warn('⚠️ [decryptUserData] ENC_KEY not set, skipping decryption');
      return users.map(user => {
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
        const [ivB64, ctB64, tagB64] = String(enc).split(':');
        if (!ivB64 || !ctB64 || !tagB64) return null;
        const iv  = Buffer.from(ivB64, 'base64');
        const ct  = Buffer.from(ctB64, 'base64');
        const tag = Buffer.from(tagB64, 'base64');
        const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
      } catch { return null; }
    };

    const decryptGCM = (packed) => {
      if (!packed) return null;
      try {
        const parts = String(packed).split('.');
        if (parts.length !== 3) return null;
        const [ivB64, tagB64, dataB64] = parts;
        const iv   = Buffer.from(ivB64,  'base64url');
        const tag  = Buffer.from(tagB64, 'base64url');
        const data = Buffer.from(dataB64,'base64url');
        const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(data), d.final()]).toString('utf8');
      } catch { return null; }
    };

    const tryDecryptAny = (v) => {
      if (v == null || v === '') return null;
      try {
        const s = String(v);
        if (s.includes('.')) {
          return decryptGCM(s);
        }
        if (s.includes(':')) {
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
        if (v != null && v !== '') return v;
      }
      return null;
    };

    return users.map(user => {
      try {
        if (!user) return null;
        const userObj = user.toObject ? user.toObject() : user;
        if (!userObj || typeof userObj !== 'object') return userObj;

        const phoneCipher = pick(userObj, ['phoneNumberEnc', 'phoneNumber']);
        if (phoneCipher) {
          const decryptedPhone = deepDecrypt(phoneCipher);
          userObj.phoneNumber = decryptedPhone || userObj.phoneNumber || null;
        }
        delete userObj.phoneNumberEnc;

        const emailCipher = pick(userObj, ['emailEnc', 'email']);
        if (emailCipher) {
          const decryptedEmail = deepDecrypt(emailCipher);
          if (decryptedEmail !== null && decryptedEmail !== undefined) {
            userObj.email = decryptedEmail;
          }
        }
        delete userObj.emailEnc;

        const addressCipher = pick(userObj, ['addressEnc', 'address']);
        if (addressCipher) {
          const decryptedAddress = deepDecrypt(addressCipher);
          userObj.address = decryptedAddress || userObj.address || null;
        }
        delete userObj.addressEnc;

        const identityCipher = pick(userObj, ['identityCardEnc', 'identityCard']);
        if (identityCipher) {
          const decryptedIdentity = deepDecrypt(identityCipher);
          userObj.identityCard = decryptedIdentity || userObj.identityCard || null;
        }
        delete userObj.identityCardEnc;

        const currentAddressCipher = pick(userObj, ['currentAddressEnc', 'currentAddress']);
        if (currentAddressCipher) {
          const decryptedCurrentAddress = deepDecrypt(currentAddressCipher);
          userObj.currentAddress = decryptedCurrentAddress || userObj.currentAddress || null;
        }
        delete userObj.currentAddressEnc;

        const hometownCipher = pick(userObj, ['hometownEnc', 'hometown']);
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
    }).filter(u => u !== null);
  } catch (err) {
    // Return users as-is if decryption completely fails
    return users.map(user => {
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
  if (typeof dateInput === 'number' && dateInput > 1 && dateInput < 100000) {
    // Excel serial number: days since 1900-01-01 (with leap year bug)
    // Convert to actual date
    const excelEpoch = new Date(1900, 0, 1); // 1900-01-01
    const date = new Date(excelEpoch.getTime() + (dateInput - 2) * 24 * 60 * 60 * 1000);
    
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
      
      if (format.source.includes('YYYY')) {
        // Format with year first
        [, year, month, day] = match;
      } else {
        // Format with month/day first
        [, month, day, year] = match;
      }
      
      // Create date object
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      
      // Validate the date
      if (!isNaN(date.getTime()) && 
          date.getFullYear() == year && 
          date.getMonth() == month - 1 && 
          date.getDate() == day) {
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

  if (!row.phoneNumber || !/^[0-9]{10,11}$/.test(String(row.phoneNumber).replace(/\D/g, ''))) {
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

  if (!row.gender || !['Nam', 'Nữ', 'Khác'].includes(row.gender)) {
    errors.push("Giới tính phải là Nam, Nữ hoặc Khác");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

const validateDoctorRow = (row, rowNumber) => {
  const errors = [];

  if (!row.fullName || row.fullName.trim().length < 2) {
    errors.push("Họ tên phải có ít nhất 2 ký tự");
  }

  if (!row.phoneNumber || !/^[0-9]{10,11}$/.test(String(row.phoneNumber).replace(/\D/g, ''))) {
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

  if (!row.gender || !['Nam', 'Nữ', 'Khác'].includes(row.gender)) {
    errors.push("Giới tính phải là Nam, Nữ hoặc Khác");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

const AdminController = {
  // Admin: Lấy danh sách các gói khám mà bác sĩ đã đảm nhận
  getPackagesByDoctor: async (req, res) => {
    try {
      const { doctorId } = req.params;
      if (!isValidObjectId(doctorId)) {
        return res.status(400).json({ success: false, message: "ID bác sĩ không hợp lệ" });
      }

      // Tìm tất cả các đăng ký gói khám mà bác sĩ này đã đảm nhận
      let docs = await RegistrationHealthPackage.find({ doctor: doctorId })
        .populate('packageRef', 'title durations price description isActive')
        .populate({
          path: 'beneficiary',
          select: 'fullName role dateOfBirth phoneNumber phoneNumberEnc email emailEnc avatar +phoneNumberEnc +emailEnc'
        })
        .populate({
          path: 'registrant',
          select: 'fullName role phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc'
        })
        .sort({ registeredAt: -1 })
        .lean();

      // Decrypt populated users (beneficiary/registrant) in batch
      const usersToDecrypt = [];
      docs.forEach(d => {
        if (d.beneficiary && d.beneficiary._id) usersToDecrypt.push(d.beneficiary);
        if (d.registrant && d.registrant._id) usersToDecrypt.push(d.registrant);
      });
      // Unique by _id
      const uniq = {};
      const uniqueUsers = [];
      usersToDecrypt.forEach(u => {
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
          decrypted.forEach(u => {
            if (u && u._id) {
              decMap[String(u._id)] = u;
            }
          });
          // attach decrypted users back to docs
          docs = docs.map(d => {
            if (d.beneficiary && d.beneficiary._id && decMap[String(d.beneficiary._id)]) {
              d.beneficiary = decMap[String(d.beneficiary._id)];
            }
            if (d.registrant && d.registrant._id && decMap[String(d.registrant._id)]) {
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
        data: docs
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: 'Đã xảy ra lỗi khi lấy danh sách gói khám bác sĩ đã đảm nhận',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },
  resetUserPassword: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isValidObjectId(userId)) {
        return res.status(400).json({ success: false, message: "ID người dùng không hợp lệ" });
      }
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "Không tìm thấy người dùng" });
      }
      const newPassword = await bcrypt.hash("1", 12);
      user.password = newPassword;
      await user.save();
      return res.status(200).json({ success: true, message: "Đã reset mật khẩu về '1'" });
    } catch (err) {
      console.error("Error resetting user password:", err);
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi reset mật khẩu" });
    }
  },
  // Admin: Lấy danh sách tất cả người dùng
  getAllUsers: async (req, res) => {
    try {
      
      const users = await User.find({})
        .select("fullName role isActive phoneNumber phoneNumberEnc email emailEnc address addressEnc identityCard identityCardEnc currentAddress currentAddressEnc hometown hometownEnc gender dateOfBirth createdAt avatar +phoneNumberEnc +emailEnc +addressEnc +identityCardEnc +currentAddressEnc +hometownEnc")
        .sort({ createdAt: -1 });

      const decrypted = decryptUserData(users);
      
      return res.status(200).json({ success: true, data: decrypted });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi lấy danh sách người dùng" });
    }
  },

  // Admin: Lấy chi tiết 1 người dùng theo id
  getUserById: async (req, res) => {
    try {
      const { userId } = req.params;
      
      if (!isValidObjectId(userId)) {
        return res.status(400).json({ success: false, message: "ID người dùng không hợp lệ" });
      }
      
      const user = await User.findById(userId)
        .select("fullName role isActive phoneNumber phoneNumberEnc email emailEnc address addressEnc gender dateOfBirth createdAt avatar identityCard identityCardEnc currentAddress currentAddressEnc hometown hometownEnc +phoneNumberEnc +emailEnc +addressEnc +identityCardEnc +currentAddressEnc +hometownEnc");
      
      if (!user) {
        return res.status(404).json({ success: false, message: "Không tìm thấy người dùng" });
      }

      const [decrypted] = decryptUserData([user]);
      
      return res.status(200).json({ success: true, data: decrypted });
    } catch (err) {
      console.error("❌ [AdminController.getUserById] Error:", err);
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi lấy thông tin người dùng" });
    }
  },

  // Admin: Tạo tài khoản supporter
  createSupporter: async (req, res) => {
    try {
      const { fullName, phoneNumber, gender, password, email, dateOfBirth, address, identityCard } = req.body;

      if (!fullName || !phoneNumber || !gender || !password || !dateOfBirth || !identityCard) {
        return res.status(400).json({
          success: false,
          message: "Thiếu thông tin bắt buộc: fullName, phoneNumber, gender, password, dateOfBirth, identityCard"
        });
      }

      if (!["Nam", "Nữ", "Khác"].includes(gender)) {
        return res.status(400).json({ success: false, message: "Giới tính không hợp lệ" });
      }

      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Mật khẩu phải có ít nhất 6 ký tự" });
      }

      const normalizedPhone = normalizePhoneVN(phoneNumber);
      if (!normalizedPhone) {
        return res.status(400).json({ success: false, message: "Số điện thoại không hợp lệ" });
      }

      const localPhone = normalizedPhone.startsWith('84') ? '0' + normalizedPhone.slice(2) : normalizedPhone;
      const phoneHashesToCheck = [...new Set([
        hmacIndex(normalizedPhone),
        localPhone ? hmacIndex(localPhone) : null
      ].filter(Boolean))];

      const existingUser = await User.findOne({
        isActive: true,
        phoneNumberHash: { $in: phoneHashesToCheck }
      });
      if (existingUser) {
        return res.status(409).json({ success: false, message: "Số điện thoại đã được sử dụng" });
      }

      // Check identityCard uniqueness
      const identityCardHash = identityCard ? hmacIndex(String(identityCard)) : null;
      if (identityCardHash) {
        const existingIdentityCard = await User.findOne({ identityCardHash, isActive: true });
        if (existingIdentityCard) {
          return res.status(409).json({ success: false, message: "CMND/CCCD đã được sử dụng" });
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
        phoneNumber: normalizedPhone
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

      // Không tạo SupporterProfile ở đây nữa

      return res.status(201).json({
        success: true,
        message: "Tạo tài khoản supporter thành công",
        data: {
          userId: newUser._id,
          fullName: newUser.fullName,
          role: newUser.role,
          isActive: newUser.isActive
        }
      });

    } catch (err) {
      console.error("Error creating supporter:", err);
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi tạo tài khoản supporter" });
    }
  },

  // Admin: Tạo tài khoản doctor
  createDoctor: async (req, res) => {
    try {
      const { fullName, phoneNumber, gender, password, email, dateOfBirth, address, identityCard } = req.body;

      if (!fullName || !phoneNumber || !gender || !password || !dateOfBirth || !identityCard) {
        return res.status(400).json({
          success: false,
          message: "Thiếu thông tin bắt buộc: fullName, phoneNumber, gender, password, dateOfBirth, identityCard"
        });
      }

      if (!["Nam", "Nữ", "Khác"].includes(gender)) {
        return res.status(400).json({ success: false, message: "Giới tính không hợp lệ" });
      }

      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Mật khẩu phải có ít nhất 6 ký tự" });
      }

      const normalizedPhone = normalizePhoneVN(phoneNumber);
      if (!normalizedPhone) {
        return res.status(400).json({ success: false, message: "Số điện thoại không hợp lệ" });
      }

      const localPhone = normalizedPhone.startsWith('84') ? '0' + normalizedPhone.slice(2) : normalizedPhone;
      const phoneHashesToCheck = [...new Set([
        hmacIndex(normalizedPhone),
        localPhone ? hmacIndex(localPhone) : null
      ].filter(Boolean))];

      const existingUser = await User.findOne({
        isActive: true,
        phoneNumberHash: { $in: phoneHashesToCheck }
      });
      if (existingUser) {
        return res.status(409).json({ success: false, message: "Số điện thoại đã được sử dụng" });
      }

      // Kiểm tra email nếu có
      if (email?.trim()) {
        const emailNorm = email.trim().toLowerCase();
        const emailHash = hmacIndex(emailNorm);
        const existingEmail = await User.findOne({ emailHash, isActive: true });
        if (existingEmail) {
          return res.status(409).json({ success: false, message: "Email đã được sử dụng" });
        }
      }

      const identityCardHash = hmacIndex(identityCard);
      const existingIdentityCard = await User.findOne({ identityCardHash, isActive: true });
      if (existingIdentityCard) {
        return res.status(409).json({ success: false, message: "CMND/CCCD đã được sử dụng" });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const userData = {
        fullName: fullName.trim(),
        gender,
        password: hashedPassword,
        role: "doctor",
        isActive: true,
        dateOfBirth: new Date(dateOfBirth),
        phoneNumber: normalizedPhone
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

      // Không tạo DoctorProfile ở đây nữa

      return res.status(201).json({
        success: true,
        message: "Tạo tài khoản doctor thành công",
        data: {
          userId: newUser._id,
          fullName: newUser.fullName,
          role: newUser.role,
          isActive: newUser.isActive
        }
      });

    } catch (err) {
      console.error("Error creating doctor:", err);
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi tạo tài khoản doctor" });
    }
  },

  // Admin: Lấy thông tin supporter
  getSupporterProfile: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isValidObjectId(userId)) {
        return res.status(400).json({ success: false, message: "ID người dùng không hợp lệ" });
      }

      const user = await User.findById(userId)
        .select("fullName phoneNumber phoneNumberEnc email emailEnc address addressEnc identityCard identityCardEnc currentAddress currentAddressEnc hometown hometownEnc role isActive avatar gender dateOfBirth createdAt +phoneNumberEnc +emailEnc +addressEnc +identityCardEnc +currentAddressEnc +hometownEnc");

      if (!user) {
        return res.status(404).json({ success: false, message: "Không tìm thấy người dùng" });
      }
      if (user.role !== "supporter") {
        return res.status(400).json({ success: false, message: "Người dùng này không phải là supporter" });
      }


      const supporterProfile = await SupporterProfile.findOne({ user: userId });
      const [decryptedUser] = decryptUserData([user]);

      const combinedData = {
        ...supporterProfile?.toObject(),
        user: decryptedUser
      };

      return res.status(200).json({ success: true, data: combinedData });

    } catch (err) {
      console.error("❌ [AdminController.getSupporterProfile] Error:", err);
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi lấy thông tin supporter" });
    }
  },

  // Admin: Cập nhật trạng thái hoạt động của bất kỳ user nào
  setUserActive: async (req, res) => {
    try {
      const { userId } = req.params;
      const { isActive } = req.body;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({ success: false, message: "ID người dùng không hợp lệ" });
      }

      if (typeof isActive !== "boolean") {
        return res.status(400).json({ success: false, message: "Trạng thái isActive phải là boolean" });
      }

      // Cập nhật trạng thái isActive cho bất kỳ user nào
      const user = await User.findByIdAndUpdate(userId, { isActive }, { new: true, select: "fullName role isActive" });

      if (!user) return res.status(404).json({ success: false, message: "Không tìm thấy người dùng" });

      return res.status(200).json({
        success: true,
        message: isActive ? "Đã mở khóa tài khoản" : "Đã khóa tài khoản",
        data: { userId: user._id, fullName: user.fullName, role: user.role, isActive: user.isActive }
      });

    } catch (err) {
      console.error("Error updating user status:", err);
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi cập nhật trạng thái người dùng" });
    }
  },

  // Admin: Lấy danh sách tất cả supporters
  getAllSupporters: async (req, res) => {
    try {      
      const supporters = await User.find({ role: "supporter" })
        .select("fullName phoneNumber phoneNumberEnc email emailEnc address addressEnc identityCard identityCardEnc currentAddress currentAddressEnc hometown hometownEnc isActive createdAt gender dateOfBirth +phoneNumberEnc +emailEnc +addressEnc +identityCardEnc +currentAddressEnc +hometownEnc")
        .sort({ createdAt: -1 });
      const decryptedSupporters = decryptUserData(supporters);
      
      return res.status(200).json({ success: true, data: decryptedSupporters });

    } catch (err) {
      console.error("❌ [AdminController.getAllSupporters] Error:", err);
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi lấy danh sách supporters" });
    }
  },

  // Admin: Kiểm tra trạng thái admin hiện tại
  checkAdminStatus: async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!isValidObjectId(userId)) {
        return res.status(400).json({ success: false, message: "ID người dùng không hợp lệ" });
      }

      const user = await User.findById(userId)
        .select("fullName phoneNumber email role isActive createdAt dateOfBirth");
      if (!user) return res.status(404).json({ success: false, message: "Không tìm thấy người dùng trong database" });

      if (user.role !== 'admin') await User.findByIdAndUpdate(userId, { role: 'admin' });
      if (!user.isActive) await User.findByIdAndUpdate(userId, { isActive: true });

      return res.status(200).json({
        success: true,
        data: {
          userId: user._id,
          fullName: user.fullName,
          role: 'admin',
          isActive: true,
          isAdmin: true
        }
      });

    } catch (err) {
      console.error("Error checking admin status:", err);
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi kiểm tra trạng thái admin" });
    }
  },

  refreshAdminToken: async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!isValidObjectId(userId)) {
        return res.status(400).json({ success: false, message: "ID người dùng không hợp lệ" });
      }

      const user = await User.findById(userId)
        .select("fullName phoneNumber email role isActive");
      if (!user) return res.status(404).json({ success: false, message: "Không tìm thấy người dùng" });

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
            isActive: user.isActive
          }
        }
      });

    } catch (err) {
      console.error("Error refreshing token:", err);
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi làm mới token" });
    }
  },

  bulkImportSupporters: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "Không có file được upload" });
      }

      // Đọc file Excel
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);

      if (data.length === 0) {
        return res.status(400).json({ success: false, message: "File Excel không có dữ liệu" });
      }

      const results = {
        success: [],
        errors: [],
        total: data.length
      };

      // Xử lý từng dòng dữ liệu
      for (let i = 0; i < data.length; i++) {

        const row = data[i];
        const rowNumber = i + 2; // +2 vì Excel bắt đầu từ 1 và có header
        try {
          // Loại bỏ ký tự nháy đơn ở đầu các trường có thể bị lỗi từ Excel
          const cleanField = v => (typeof v === 'string' && v.startsWith("'")) ? v.slice(1) : v;
          row.phoneNumber = cleanField(row.phoneNumber);
          row.password = cleanField(row.password);
          row.dateOfBirth = cleanField(row.dateOfBirth);
          row.identityCard = cleanField(row.identityCard);
          // Chuẩn hóa gender: loại bỏ khoảng trắng, ký tự nháy đơn, viết hoa chữ cái đầu
          if (row.gender) {
            let g = String(row.gender).replace(/^'+|'+$/g, '').trim().toLowerCase();
            if (g === 'nam' || g === 'male') row.gender = 'Nam';
            else if (g === 'nữ' || g === 'nu' || g === 'female') row.gender = 'Nữ';
            else if (g === 'khác' || g === 'other') row.gender = 'Khác';
            else {
              // Chỉ lấy đúng enum: Nam, Nữ, Khác
              if (g === 'nam') row.gender = 'Nam';
              else if (g === 'nữ') row.gender = 'Nữ';
              else if (g === 'khác') row.gender = 'Khác';
              else row.gender = g.charAt(0).toUpperCase() + g.slice(1);
            }
          }

          // Validate dữ liệu
          const validation = validateSupporterRow(row, rowNumber);
          if (!validation.isValid) {
            results.errors.push({
              row: rowNumber,
              errors: validation.errors,
              data: row
            });
            continue;
          }

          // Chuẩn hóa số điện thoại
          const normalizedPhone = normalizePhoneVN(String(row.phoneNumber));
          if (!normalizedPhone) {
            results.errors.push({
              row: rowNumber,
              errors: ["Số điện thoại không hợp lệ"],
              data: row
            });
            continue;
          }
          const localPhone = normalizedPhone.startsWith('84') ? '0' + normalizedPhone.slice(2) : normalizedPhone;
          const phoneHashesToCheck = [...new Set([
            hmacIndex(normalizedPhone),
            localPhone ? hmacIndex(localPhone) : null
          ].filter(Boolean))];

          // Kiểm tra trùng số điện thoại
          const existingUser = await User.findOne({
            isActive: true,
            phoneNumberHash: { $in: phoneHashesToCheck }
          });
          if (existingUser) {
            results.errors.push({
              row: rowNumber,
              errors: ["Số điện thoại đã được sử dụng"],
              data: row
            });
            continue;
          }

          // Kiểm tra email nếu có
          let emailNorm = null;
          if (row.email?.trim()) {
            emailNorm = row.email.trim().toLowerCase();
            const emailHash = hmacIndex(emailNorm);
            const existingEmail = await User.findOne({ emailHash, isActive: true });
            if (existingEmail) {
              results.errors.push({
                row: rowNumber,
                errors: ["Email đã được sử dụng"],
                data: row
              });
              continue;
            }
          }

          // Kiểm tra identityCard nếu có
          let identityCardStr = null;
          let identityCardHash = null;
          if (row.identityCard != null && String(row.identityCard).trim()) {
            identityCardStr = String(row.identityCard).trim();
            identityCardHash = hmacIndex(identityCardStr);
            const existingIdentityCard = await User.findOne({ identityCardHash, isActive: true });
            if (existingIdentityCard) {
              results.errors.push({
                row: rowNumber,
                errors: ["CMND/CCCD đã được sử dụng"],
                data: row
              });
              continue;
            }
          }

          // Hash password
          const hashedPassword = await bcrypt.hash(String(row.password), 12);
          const parsedDateOfBirth = parseDateFromExcel(row.dateOfBirth);

          // Tạo user qua setter để plugin hoạt động
          const user = new User();
          user.fullName = row.fullName.trim();
          user.gender = row.gender;
          user.password = hashedPassword;
          user.role = "supporter";
          user.isActive = true;
          user.dateOfBirth = parsedDateOfBirth;
          user.phoneNumber = normalizedPhone; // setter sẽ mã hóa và sinh hash
          if (emailNorm) user.email = emailNorm;
          if (row.address?.trim()) user.address = row.address.trim();
          if (identityCardStr) user.identityCard = identityCardStr;

          await user.save();

          // Tạo supporter profile
          await SupporterProfile.create({
            user: user._id,
            sessionFee: { morning: 0, afternoon: 0, evening: 0 }
          });

          results.success.push({
            row: rowNumber,
            userId: user._id,
            fullName: user.fullName,
            phoneNumber: normalizedPhone
          });

        } catch (err) {
          console.error(`❌ [AdminController.bulkImportSupporters] Error at row ${rowNumber}:`, err);
          results.errors.push({
            row: rowNumber,
            errors: [err.message || "Lỗi không xác định"],
            data: row
          });
        }
      }


      return res.status(200).json({
        success: true,
        message: `Import hoàn thành: ${results.success.length}/${results.total} thành công`,
        data: results
      });

    } catch (err) {
      console.error("❌ [AdminController.bulkImportSupporters] Error:", err);
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi import file Excel" });
    }
  },

  bulkImportDoctors: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "Không có file được upload" });
      }

      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);

      if (data.length === 0) {
        return res.status(400).json({ success: false, message: "File Excel không có dữ liệu" });
      }
      const results = {
        success: [],
        errors: [],
        total: data.length
      };

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const rowNumber = i + 2;
        try {
          // Loại bỏ ký tự nháy đơn ở đầu các trường có thể bị lỗi từ Excel
          const cleanField = v => (typeof v === 'string' && v.startsWith("'")) ? v.slice(1) : v;
          row.phoneNumber = cleanField(row.phoneNumber);
          row.password = cleanField(row.password);
          row.dateOfBirth = cleanField(row.dateOfBirth);
          row.identityCard = cleanField(row.identityCard);
          // Chuẩn hóa gender: loại bỏ khoảng trắng, ký tự nháy đơn, viết hoa chữ cái đầu
          if (row.gender) {
            let g = String(row.gender).replace(/^'+|'+$/g, '').trim().toLowerCase();
            if (g === 'nam' || g === 'male') row.gender = 'Nam';
            else if (g === 'nữ' || g === 'nu' || g === 'female') row.gender = 'Nữ';
            else if (g === 'khác' || g === 'other') row.gender = 'Khác';
            else {
              // Chỉ lấy đúng enum: Nam, Nữ, Khác
              if (g === 'nam') row.gender = 'Nam';
              else if (g === 'nữ') row.gender = 'Nữ';
              else if (g === 'khác') row.gender = 'Khác';
              else row.gender = g.charAt(0).toUpperCase() + g.slice(1);
            }
          }

          // Validate dữ liệu
          const validation = validateDoctorRow(row, rowNumber);
          if (!validation.isValid) {
            results.errors.push({
              row: rowNumber,
              errors: validation.errors,
              data: row
            });
            continue;
          }

          // Chuẩn hóa số điện thoại
          const normalizedPhone = normalizePhoneVN(String(row.phoneNumber));
          if (!normalizedPhone) {
            results.errors.push({
              row: rowNumber,
              errors: ["Số điện thoại không hợp lệ"],
              data: row
            });
            continue;
          }
          const localPhone = normalizedPhone.startsWith('84') ? '0' + normalizedPhone.slice(2) : normalizedPhone;
          const phoneHashesToCheck = [...new Set([
            hmacIndex(normalizedPhone),
            localPhone ? hmacIndex(localPhone) : null
          ].filter(Boolean))];

          // Kiểm tra trùng số điện thoại
          const existingUser = await User.findOne({
            isActive: true,
            phoneNumberHash: { $in: phoneHashesToCheck }
          });
          if (existingUser) {
            results.errors.push({
              row: rowNumber,
              errors: ["Số điện thoại đã được sử dụng"],
              data: row
            });
            continue;
          }

          // Kiểm tra email nếu có
          let emailNorm = null;
          if (row.email?.trim()) {
            emailNorm = row.email.trim().toLowerCase();
            const emailHash = hmacIndex(emailNorm);
            const existingEmail = await User.findOne({ emailHash, isActive: true });
            if (existingEmail) {
              results.errors.push({
                row: rowNumber,
                errors: ["Email đã được sử dụng"],
                data: row
              });
              continue;
            }
          }

          // Kiểm tra identityCard nếu có
          let identityCardStr = null;
          let identityCardHash = null;
          if (row.identityCard != null && String(row.identityCard).trim()) {
            identityCardStr = String(row.identityCard).trim();
            identityCardHash = hmacIndex(identityCardStr);
            const existingIdentityCard = await User.findOne({ identityCardHash, isActive: true });
            if (existingIdentityCard) {
              results.errors.push({
                row: rowNumber,
                errors: ["CMND/CCCD đã được sử dụng"],
                data: row
              });
              continue;
            }
          }

          // Hash password
          const hashedPassword = await bcrypt.hash(String(row.password), 12);
          const parsedDateOfBirth = parseDateFromExcel(row.dateOfBirth);

          // Tạo user qua setter để plugin hoạt động
          const user = new User();
          user.fullName = row.fullName.trim();
          user.gender = row.gender;
          user.password = hashedPassword;
          user.role = "doctor";
          user.isActive = true;
          user.dateOfBirth = parsedDateOfBirth;
          user.phoneNumber = normalizedPhone; // setter sẽ mã hóa và sinh hash
          if (emailNorm) user.email = emailNorm;
          if (row.address?.trim()) user.address = row.address.trim();
          if (identityCardStr) user.identityCard = identityCardStr;

          await user.save();

          results.success.push({
            row: rowNumber,
            userId: user._id,
            fullName: user.fullName,
            phoneNumber: normalizedPhone,
            email: emailNorm
          });
        } catch (err) {
          console.error(`❌ [AdminController.bulkImportDoctors] Error at row ${rowNumber}:`, err);
          results.errors.push({
            row: rowNumber,
            errors: [err.message || "Lỗi không xác định"],
            data: row
          });
        }
      }
      return res.status(200).json({
        success: true,
        message: `Import hoàn thành: ${results.success.length}/${results.total} thành công`,
        data: results
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi import file Excel" });
    }
  }

  ,

  // Admin: Lấy danh sách các đăng ký gói khám (mặc định chỉ các đăng ký có beneficiary là người già)
  getRegisteredPackages: async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page || '1'));
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '20')));
      const skip = (page - 1) * limit;
      const { beneficiaryId, doctorId, status } = req.query;

      const query = {};
      if (beneficiaryId) {
        if (!isValidObjectId(beneficiaryId)) return res.status(400).json({ success: false, message: "ID người hưởng không hợp lệ" });
        query.beneficiary = beneficiaryId;
      }
      if (doctorId) {
        if (!isValidObjectId(doctorId)) return res.status(400).json({ success: false, message: "ID bác sĩ không hợp lệ" });
        query.doctor = doctorId;
      }
      if (status) {
        query.status = status;
      }

      // Fetch consultations with populated references
      let docs = await RegistrationConsulation.find(query)
        .populate({
          path: 'doctor',
          select: 'fullName role phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc'
        })
        .populate({
          path: 'beneficiary',
          select: 'fullName role dateOfBirth phoneNumber phoneNumberEnc email emailEnc address addressEnc avatar +phoneNumberEnc +emailEnc +addressEnc'
        })
        .populate({
          path: 'registrant',
          select: 'fullName role phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc'
        })
        .sort({ registeredAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      // Count total
      const total = await RegistrationConsulation.countDocuments(query);

      // Decrypt populated users in batch
      const usersToDecrypt = [];
      docs.forEach(d => {
        if (d.beneficiary && d.beneficiary._id) usersToDecrypt.push(d.beneficiary);
        if (d.registrant && d.registrant._id) usersToDecrypt.push(d.registrant);
        if (d.doctor && d.doctor._id) usersToDecrypt.push(d.doctor);
      });
      
      // Unique by _id
      const uniq = {};
      const uniqueUsers = [];
      usersToDecrypt.forEach(u => {
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
          decrypted.forEach(u => { 
            if (u && u._id) {
              decMap[String(u._id)] = u; 
            }
          });

          // attach decrypted users back to docs
          docs = docs.map(d => {
            if (d.beneficiary && d.beneficiary._id && decMap[String(d.beneficiary._id)]) {
              d.beneficiary = decMap[String(d.beneficiary._id)];
            }
            if (d.registrant && d.registrant._id && decMap[String(d.registrant._id)]) {
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
          items: docs
        }
      });
    } catch (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Đã xảy ra lỗi khi lấy danh sách lịch tư vấn',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },

  // Admin: Lấy chi tiết 1 lịch tư vấn
  getRegisteredPackageById: async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: 'ID lịch tư vấn không hợp lệ' });

      const doc = await RegistrationConsulation.findById(id)
        .populate({
          path: 'doctor',
          select: 'fullName role phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc'
        })
        .populate({
          path: 'beneficiary',
          select: 'fullName role dateOfBirth phoneNumber phoneNumberEnc email emailEnc address addressEnc avatar +phoneNumberEnc +emailEnc +addressEnc'
        })
        .populate({
          path: 'registrant',
          select: 'fullName role phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc'
        })
        .lean();

      if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy lịch tư vấn' });

      // Decrypt any populated user objects
      const users = [];
      if (doc.beneficiary && doc.beneficiary._id) users.push(doc.beneficiary);
      if (doc.registrant && doc.registrant._id) users.push(doc.registrant);
      if (doc.doctor && doc.doctor._id) users.push(doc.doctor);

      if (users.length > 0) {
        try {
          const decrypted = decryptUserData(users);
          const decMap = {};
          decrypted.forEach(u => {
            if (u && u._id) {
              decMap[String(u._id)] = u;
            }
          });

          if (doc.beneficiary && doc.beneficiary._id && decMap[String(doc.beneficiary._id)]) {
            doc.beneficiary = decMap[String(doc.beneficiary._id)];
          }
          if (doc.registrant && doc.registrant._id && decMap[String(doc.registrant._id)]) {
            doc.registrant = decMap[String(doc.registrant._id)];
          }
          if (doc.doctor && doc.doctor._id && decMap[String(doc.doctor._id)]) {
            doc.doctor = decMap[String(doc.doctor._id)];
          }
        } catch (decryptErr) {
          // Continue without decryption if it fails
        }
      }

      return res.status(200).json({ success: true, data: doc });
    } catch (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Đã xảy ra lỗi khi lấy chi tiết lịch tư vấn',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },

  // Admin: Dashboard stats
  getDashboard: async (req, res) => {
    try {

      // Counts by role
      const [totalResidents, familyMembers, activeSupporters, doctors, admins] = await Promise.all([
        User.countDocuments({ role: 'elderly' }),
        User.countDocuments({ role: 'family' }),
        User.countDocuments({ role: 'supporter', isActive: true }),
        User.countDocuments({ role: 'doctor' }),
        User.countDocuments({ role: 'admin' }),
      ]);

      // Payments summary (group by status)
      const paymentsAgg = await Payment.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 }, total: { $sum: "$totalAmount" } } }
      ]);

      const paymentsByStatus = {};
      let totalRevenue = 0;
      for (const p of paymentsAgg) {
        paymentsByStatus[p._id] = { count: p.count, total: p.total };
        if (p._id === 'completed') totalRevenue += p.total;
      }

      // Monthly revenue (current month, completed payments)
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0,0,0,0);
      const endOfMonth = new Date(startOfMonth);
      endOfMonth.setMonth(endOfMonth.getMonth() + 1);

      const monthlyAgg = await Payment.aggregate([
        { $match: { status: 'completed', completedAt: { $gte: startOfMonth, $lt: endOfMonth } } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } }
      ]);

      const monthlyRevenue = (monthlyAgg[0] && monthlyAgg[0].total) || 0;

      return res.status(200).json({
        success: true,
        data: {
          counts: { totalResidents, familyMembers, activeSupporters, doctors, admins },
          paymentsByStatus,
          totalRevenue,
          monthlyRevenue
        }
      });
    } catch (err) {
      console.error('❌ [AdminController.getDashboard] Error:', err);
      return res.status(500).json({ success: false, message: 'Đã xảy ra lỗi khi lấy dữ liệu dashboard' });
    }
  },

  // Admin: Lấy danh sách bác sĩ gần nhất dựa trên địa chỉ người già
  getNearbyDoctors: async (req, res) => {
    try {
      const { elderlyId, maxDistance = 50 } = req.query; // maxDistance in km, default 50km

      if (!elderlyId || !isValidObjectId(elderlyId)) {
        return res.status(400).json({ success: false, message: 'ID người già không hợp lệ' });
      }

      // Lấy thông tin người già
      const elderly = await User.findById(elderlyId)
        .select('currentLocation coordinates currentAddress address addressEnc fullName +currentLocation +coordinates +addressEnc')
        .lean();

      if (!elderly) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy người già' });
      }

      // Giải mã địa chỉ nếu cần
      let elderlyLocation = null;
      if (elderly.currentLocation && elderly.currentLocation.coordinates && elderly.currentLocation.coordinates.length === 2) {
        // Sử dụng GeoJSON format: [longitude, latitude]
        const [longitude, latitude] = elderly.currentLocation.coordinates;
        elderlyLocation = { latitude, longitude };
      } else if (elderly.coordinates && elderly.coordinates.latitude && elderly.coordinates.longitude) {
        // Sử dụng plain object format
        elderlyLocation = {
          latitude: elderly.coordinates.latitude,
          longitude: elderly.coordinates.longitude
        };
      }

      if (!elderlyLocation) {
        return res.status(400).json({ 
          success: false, 
          message: 'Người già chưa có thông tin vị trí. Vui lòng cập nhật địa chỉ.' 
        });
      }

      const DoctorProfile = require("../models/DoctorProfile");

      // Tìm tất cả bác sĩ đang hoạt động
      const doctors = await User.find({ 
        role: 'doctor', 
        isActive: true 
      })
        .select('fullName currentLocation coordinates phoneNumber phoneNumberEnc email emailEnc avatar +currentLocation +coordinates +phoneNumberEnc +emailEnc')
        .lean();

      // Lấy thông tin profile của các bác sĩ
      const doctorIds = doctors.map(d => d._id);
      const doctorProfiles = await DoctorProfile.find({ user: { $in: doctorIds } })
        .select('user specializations experience hospitalName ratingStats consultationFees')
        .lean();

      // Tạo map để dễ dàng lookup
      const profileMap = {};
      doctorProfiles.forEach(profile => {
        profileMap[String(profile.user)] = profile;
      });

      // Tính toán khoảng cách và sắp xếp
      const doctorsWithDistance = doctors.map(doctor => {
        let distance = null;
        let doctorLocation = null;

        // Lấy tọa độ của bác sĩ
        if (doctor.currentLocation && doctor.currentLocation.coordinates && doctor.currentLocation.coordinates.length === 2) {
          const [longitude, latitude] = doctor.currentLocation.coordinates;
          doctorLocation = { latitude, longitude };
        } else if (doctor.coordinates && doctor.coordinates.latitude && doctor.coordinates.longitude) {
          doctorLocation = {
            latitude: doctor.coordinates.latitude,
            longitude: doctor.coordinates.longitude
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
          specializations: profile?.specializations || 'N/A',
          experience: profile?.experience || 0,
          hospitalName: profile?.hospitalName || 'N/A',
          ratingStats: profile?.ratingStats || { averageRating: 0, totalRatings: 0 },
          consultationFees: profile?.consultationFees || { online: 0, offline: 0 },
          distance: distance ? parseFloat(distance.toFixed(2)) : null, // km
          hasLocation: !!doctorLocation
        };
      });

      // Lọc bác sĩ trong khoảng cách cho phép và sắp xếp theo khoảng cách
      const filteredDoctors = doctorsWithDistance
        .filter(d => d.distance !== null && d.distance <= maxDistance)
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
            location: elderlyLocation
          },
          doctors: decryptedDoctors,
          total: decryptedDoctors.length,
          maxDistance: parseFloat(maxDistance)
        }
      });
    } catch (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Đã xảy ra lỗi khi lấy danh sách bác sĩ gần nhất',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },

  // Admin: Gán bác sĩ cho đăng ký gói khám
  assignDoctorToRegistration: async (req, res) => {
    try {
      const { registrationId } = req.params;
      const { doctorId } = req.body;

      if (!isValidObjectId(registrationId)) {
        return res.status(400).json({ success: false, message: 'ID đăng ký không hợp lệ' });
      }

      if (!doctorId || !isValidObjectId(doctorId)) {
        return res.status(400).json({ success: false, message: 'ID bác sĩ không hợp lệ' });
      }

      // Kiểm tra registration tồn tại
      const registration = await RegistrationHealthPackage.findById(registrationId);
      if (!registration) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy đăng ký gói khám' });
      }

      // Kiểm tra bác sĩ tồn tại và là bác sĩ
      const doctor = await User.findById(doctorId).select('role isActive fullName');
      if (!doctor) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy bác sĩ' });
      }

      if (doctor.role !== 'doctor') {
        return res.status(400).json({ success: false, message: 'Người dùng này không phải là bác sĩ' });
      }

      if (!doctor.isActive) {
        return res.status(400).json({ success: false, message: 'Bác sĩ này không còn hoạt động' });
      }

      // Cập nhật bác sĩ cho registration
      registration.doctor = doctorId;
      await registration.save();

      // Populate để trả về thông tin đầy đủ
      const updatedRegistration = await RegistrationHealthPackage.findById(registrationId)
        .populate('packageRef', 'title durationDays price description isActive')
        .populate({
          path: 'beneficiary',
          select: 'fullName role dateOfBirth phoneNumber phoneNumberEnc email emailEnc avatar +phoneNumberEnc +emailEnc'
        })
        .populate({
          path: 'registrant',
          select: 'fullName role phoneNumber phoneNumberEnc email emailEnc +phoneNumberEnc +emailEnc'
        })
        .populate({
          path: 'doctor',
          select: 'fullName role phoneNumber phoneNumberEnc email emailEnc avatar +phoneNumberEnc +emailEnc'
        })
        .lean();

      // Giải mã thông tin người dùng
      const users = [];
      if (updatedRegistration.beneficiary) users.push(updatedRegistration.beneficiary);
      if (updatedRegistration.registrant) users.push(updatedRegistration.registrant);
      if (updatedRegistration.doctor) users.push(updatedRegistration.doctor);

      if (users.length > 0) {
        try {
          const decrypted = decryptUserData(users);
          const decMap = {};
          decrypted.forEach(u => {
            if (u && u._id) {
              decMap[String(u._id)] = u;
            }
          });

          if (updatedRegistration.beneficiary && decMap[String(updatedRegistration.beneficiary._id)]) {
            updatedRegistration.beneficiary = decMap[String(updatedRegistration.beneficiary._id)];
          }
          if (updatedRegistration.registrant && decMap[String(updatedRegistration.registrant._id)]) {
            updatedRegistration.registrant = decMap[String(updatedRegistration.registrant._id)];
          }
          if (updatedRegistration.doctor && decMap[String(updatedRegistration.doctor._id)]) {
            updatedRegistration.doctor = decMap[String(updatedRegistration.doctor._id)];
          }
        } catch (decryptErr) {
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Đã gán bác sĩ thành công',
        data: updatedRegistration
      });
    } catch (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Đã xảy ra lỗi khi gán bác sĩ',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },
// GET /relationships/accepted-family/:familyId
getAcceptRelationshipByFamilyIdAdmin: async (req, res) => {
  try {
    const { familyId } = req.params;
    if (!familyId || typeof familyId !== 'string') {
      return res.status(400).json({ success: false, message: "Thiếu hoặc sai familyId" });
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

    const decryptedRelationships = typeof decryptPhoneNumbers === 'function' ? decryptPhoneNumbers(relationships) : relationships;

    return res.status(200).json({
      success: true,
      data: decryptedRelationships,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error?.message || error
    });
  }
},
  // Admin: Lấy danh sách lịch hẹn supporter theo status
  getSupporterSchedulesByStatus: async (req, res) => {
    try {
      const { status } = req.query;
      const query = {};
      if (status) {
        query.status = status;
      }
      // Populate các trường cần thiết
      const schedules = await SupporterScheduling.find(query)
        .populate({ path: 'supporter', select: 'fullName phoneNumber email' })
        .populate({ path: 'elderly', select: 'fullName phoneNumber email' })
        .populate({ path: 'service', select: 'name' })
        .sort({ createdAt: -1 });
      return res.status(200).json({ success: true, data: schedules });
    } catch (err) {
      console.error('[getSupporterSchedulesByStatus] Error:', err);
      return res.status(500).json({ success: false, message: 'Đã xảy ra lỗi khi lấy danh sách lịch hẹn supporter' });
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
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

module.exports = AdminController;
