const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const { sendSMS } = require("../../utils/smsClient");
const User = require("../models/User");
const SupporterProfile = require("../models/SupporterProfile");
const Relationship = require("../models/Relationship");
const redis = require("../../utils/redis");
const sendOTPEmail = require("../../utils/sendOTP");
const generateOTP = require("../../utils/generateOTP");
const { extractCccdFieldsWithGemini } = require("../../utils/vlm");
// Dùng các hàm chuẩn hoá từ utils/vlm
const {
  normalizeIdentity,
  normalizeName,
  normalizeDate,
  normalizeGender,
  normalizeAddress,
} = require("../../utils/vlm");
const { normalizePhoneVN, hmacIndex } = require("../../utils/cryptoFields");
const avatarDefault =
  "https://i.pinimg.com/736x/c6/e5/65/c6e56503cfdd87da299f72dc416023d4.jpg";

/* ========================= CRYPTO UTILS ========================= */
const ENC_KEY = Buffer.from(process.env.ENC_KEY || "", "base64"); // 32 bytes
const HMAC_KEY = Buffer.from(process.env.HMAC_KEY || "", "base64"); // any length

function looksLikeEncrypted(s = "") {
  const parts = String(s).split(":");
  if (parts.length !== 3) return false;
  const b64re = /^[A-Za-z0-9+/=]+$/;
  return parts.every((p) => b64re.test(p));
}
function tryDecryptField(value) {
  if (value == null) return null;
  const s = String(value);
  if (!looksLikeEncrypted(s)) return s;
  try {
    return decryptField(s);
  } catch {
    return s;
  }
}

function isValidEmail(email) {
  if (typeof email !== "string") return false;
  // Regex đơn giản kiểm tra định dạng email
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim().toLowerCase());
}

function phoneLegacyVariants(input = "") {
  // tạo đủ biến thể để truy vấn legacy
  const digits = String(input).replace(/\D/g, ""); // 0987654321 -> 0987654321
  if (!digits) return [];
  let local = digits;
  if (digits.startsWith("84")) local = "0" + digits.slice(2);
  if (!digits.startsWith("0")) local = "0" + digits; // đảm bảo có biến thể 0xxxxxxxxx

  const with84 = "84" + local.slice(1);
  const withPlus84 = "+84" + local.slice(1);

  // cũng giữ nguyên đầu vào (phòng khi DB lưu “digits” thuần)
  const uniq = new Set([local, with84, withPlus84, digits]);
  return [...uniq];
}

function ensureKeys() {
  if (!ENC_KEY || ENC_KEY.length !== 32)
    throw new Error("ENC_KEY invalid: must be base64 of 32 bytes");
  if (!HMAC_KEY || HMAC_KEY.length === 0)
    throw new Error("HMAC_KEY invalid: provide base64 key");
}

function encryptField(plain = "") {
  if (plain == null) return null;
  ensureKeys();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const ct = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${ct.toString("base64")}:${tag.toString(
    "base64"
  )}`;
}

function decryptField(enc) {
  if (!enc) return null;
  ensureKeys();
  const [ivB64, ctB64, tagB64] = String(enc).split(":");
  const iv = Buffer.from(ivB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/* ========================= HELPERS ========================= */
function generate4Digits() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/* ========================= CONTROLLER ========================= */
const UserController = {
  // Đăng ký nhanh (flow không OTP)
  registerUser: async (req, res) => {
    try {
      const { fullName, phoneNumber, password, role, gender, email } = req.body;
      if (!fullName || !phoneNumber || !password || !role || !gender)
        return res.status(400).json({ message: "Thiếu thông tin bắt buộc" });

      const normPhone = normalizePhoneVN(phoneNumber);
      const phoneHash = hmacIndex(normPhone);
      const emailHash = email ? hmacIndex(email.trim().toLowerCase()) : null;

      const existed = await User.findOne({
        phoneNumberHash: phoneHash,
        isActive: true,
      });
      if (existed)
        return res.status(409).json({ message: "Số điện thoại đã tồn tại" });

      const hashedPassword = await bcrypt.hash(password, 12);

      const user = new User({
        fullName,
        role,
        gender,
        phoneNumber: encryptField(normPhone),
        phoneNumberHash: phoneHash,
        email: email ? encryptField(email.trim().toLowerCase()) : null,
        emailHash,
        password: hashedPassword,
        avatar: avatarDefault,
        isActive: true,
      });

      const savedUser = await user.save();
      return res
        .status(201)
        .json({ data: { _id: savedUser._id }, message: "Đăng ký thành công" });
    } catch (error) {
      console.error("registerUser error:", error);
      return res.status(500).json({ message: "Đã xảy ra lỗi" });
    }
  },

  // B1: gửi OTP
  sendOTP: async (req, res) => {
    try {
      const { phoneNumber, role } = req.body;
      if (!phoneNumber || !role)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu phoneNumber hoặc role" });
      if (!["elderly", "family"].includes(role))
        return res
          .status(400)
          .json({ success: false, message: "Role không hợp lệ" });

      const norm = normalizePhoneVN(phoneNumber);
      const phoneHash = hmacIndex(norm);

      const existingActive = await User.findOne({
        phoneNumberHash: phoneHash,
        isActive: true,
      });
      if (existingActive)
        return res
          .status(409)
          .json({ success: false, message: "Số điện thoại đã được đăng ký" });

      const code = generate4Digits();
      console.log(`Generated OTP for ${norm}: ${code}`);
      
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      const key = `tempRegister:${phoneHash}`;
      const tempData = {
        phoneHash,
        phoneNumberPlain: norm,
        role,
        code,
        expiresAt,
        otpVerified: false,
      };
      await redis.set(key, JSON.stringify(tempData), "EX", 300);

      const message = `Mã xác nhận OTP của bạn là: ${code}`;
      const smsRes = await sendSMS({ to: norm, message });
      if (!smsRes.success)
        return res.status(500).json({
          success: false,
          message: "Gửi SMS thất bại: " + smsRes.message,
        });

      return res
        .status(200)
        .json({ success: true, message: "Đã gửi OTP", data: { expiresAt } });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // B2: verify OTP
  verifyOTP: async (req, res) => {
    try {
      const { phoneNumber, otp } = req.body;
      if (!phoneNumber || !otp)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu phoneNumber hoặc otp" });

      const norm = normalizePhoneVN(phoneNumber);
      const phoneHash = hmacIndex(norm);
      const key = `tempRegister:${phoneHash}`;
      const dataStr = await redis.get(key);
      if (!dataStr)
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy OTP hoặc đã hết hạn",
        });

      const data = JSON.parse(dataStr);
      if (new Date(data.expiresAt) < new Date())
        return res
          .status(400)
          .json({ success: false, message: "OTP đã hết hạn" });
      if (data.code !== otp)
        return res
          .status(400)
          .json({ success: false, message: "OTP không đúng" });

      data.otpVerified = true;
      await redis.set(key, JSON.stringify(data), "EX", 600);

      return res
        .status(200)
        .json({ success: true, message: "Xác thực OTP thành công" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /* ======================= B3: Upload CCCD (multipart) ======================= */
  uploadCCCD: async (req, res) => {
    const t0 = Date.now();

    const len = (s) => (s ? String(s).length : 0);
    const peek = (s) => (s ? String(s).slice(0, 40) + "..." : "(nil)");

    try {
      const rawPhone = (req.body?.phoneNumber ?? '').trim();
      const phoneNumber = rawPhone;
      const ct = req.headers['content-type'];
      const frontRaw = req.files?.frontImage?.[0];
      const backRaw = req.files?.backImage?.[0];
      let frontSize = 0, backSize = 0;
      try { if (frontRaw?.size) frontSize = frontRaw.size; else if (frontRaw?.path) frontSize = require('fs').statSync(frontRaw.path).size; } catch {}
      try { if (backRaw?.size) backSize = backRaw.size; else if (backRaw?.path) backSize = require('fs').statSync(backRaw.path).size; } catch {}
      console.log(`[uploadCCCD] ct='${ct}', phoneNumber='${phoneNumber}', frontSize=${frontSize}, backSize=${backSize}`);
      const frontFile = frontRaw;
      const backFile = backRaw;
      if (!phoneNumber) {
        return res.status(400).json({ success: false, message: "Thiếu số điện thoại" });
      }
      if (!frontFile && !backFile) {
        return res.status(400).json({ success: false, message: "Thiếu ảnh mặt trước hoặc mặt sau CCCD" });
      }

      // Verify đã qua OTP
      const norm = normalizePhoneVN(phoneNumber);
      const phoneHash = hmacIndex(norm);
      const key = `tempRegister:${phoneHash}`;
      const tempStr = await redis.get(key);

      if (!tempStr) {
        return res.status(404).json({
          success: false,
          message: "Session đăng ký tạm thời không tồn tại hoặc đã hết hạn",
          nextStep: "enterPhone", 
        });
      }
      const temp = JSON.parse(tempStr);
      if (!temp.otpVerified) {
        return res
          .status(400)
          .json({ success: false, message: "Chưa xác thực OTP" });
      }

      // Viettel AI OCR using API key (multipart files)
      const { callViettelIdOcr, normalizeViettelId } = require("../../utils/viettelOcr");
      const endpoint = process.env.VIETTEL_OCR_ENDPOINT;
      const token = process.env.VIETTEL_OCR_TOKEN;

      if (!endpoint || !token) {
        console.error("[uploadCCCD] Missing Viettel OCR config", {
          hasEndpoint: !!endpoint,
          hasToken: !!token,
        });
        return res.status(500).json({
          success: false,
          message: "Thiếu cấu hình Viettel OCR",
          detail: {
            VIETTEL_OCR_ENDPOINT: endpoint ? "SET" : "MISSING",
            VIETTEL_OCR_TOKEN: token ? "SET" : "MISSING",
          },
        });
      }
      const viettel = await callViettelIdOcr({
        frontPath: frontFile?.path,
        backPath: backFile?.path,
        endpoint,
        token,
      });

      // Cleanup temp files
      [frontFile?.path, backFile?.path].filter(Boolean).forEach((p) => {
        try { require("fs").unlinkSync(p); } catch (_) {}
      });

      if (!viettel.success) {
        const code = viettel.code;
        const reason = code === 401 ? "Unauthorized token"
          : code === 403 ? "Forbidden"
          : code === 429 ? "Rate limited"
          : code === 400 ? "Bad request"
          : "Upstream error";
        const preview = typeof viettel.detail === 'string' 
          ? viettel.detail.slice(0, 400) 
          : JSON.stringify(viettel.detail)?.slice(0, 400);
        console.error("[uploadCCCD][viettel-ocr] failure", { code, reason, preview });
        return res.status(502).json({ 
          success: false, 
          message: `OCR thất bại: ${reason}`, 
          code, 
          detail: viettel.detail 
        });
      }

      const mapped = normalizeViettelId(viettel.data);
      const identityCard = mapped.idNumber;
      const fullName = mapped.fullName;
      const dateOfBirth = mapped.dob;
      const gender = mapped.gender || "other";
      const address = mapped.address;
      if (!identityCard) {
        return res.status(422).json({
          success: false,
          message: "Không nhận diện được số CCCD/CMND",
        });
      }

      // Chống trùng CCCD
      const identityCardHash = hmacIndex(identityCard);
      const identityUsed = await User.findOne({ identityCardHash });
      if (identityUsed) {
        return res
          .status(409)
          .json({ success: false, message: "CCCD đã được đăng ký" });
      }

      // Lưu tạm (mã hoá)
      const updated = {
        ...temp,
        identityCardEnc: encryptField(identityCard),
        identityCardHash,
        ocrData: {
          fullName: (fullName || "").trim(),
          gender: gender || "other",
          dateOfBirth: dateOfBirth || null,
          address: address || null,
          addressEnc: address ? encryptField(address) : null,
        },
      };
      await redis.set(key, JSON.stringify(updated), "EX", 600);

      const ms = Date.now() - t0;

      return res.status(200).json({
        success: true,
        message: "Đã trích xuất CCCD",
        data: { identityCard, fullName, dateOfBirth, gender, address },
      });
    } catch (err) {
      // log thật chi tiết khi có lỗi bất ngờ

      return res.status(500).json({
        success: false,
        message: "Lỗi nội bộ khi OCR CCCD",
        debug:
          process.env.NODE_ENV !== "production"
            ? { error: err?.message }
            : undefined,
      });
    }
  },

  // B4: Hoàn tất hồ sơ
  completeProfile: async (req, res) => {
    try {
      const {
        phoneNumber,
        password,
        email,
        fullName: fullNameOverride,
        gender: genderOverride,
        dateOfBirth: dobOverride,
        address: addressOverride,
      } = req.body;

      if (!phoneNumber || !password) {
        return res
          .status(400)
          .json({ success: false, message: "Thiếu phoneNumber hoặc password" });
      }
      if (password.length < 6) {
        return res
          .status(400)
          .json({ success: false, message: "Mật khẩu phải >= 6 ký tự" });
      }

      // chuẩn hoá sđt & lấy session tạm
      const norm = normalizePhoneVN(phoneNumber);
      const phoneHash = hmacIndex(norm);
      const key = `tempRegister:${phoneHash}`;
      const dataStr = await redis.get(key);
      if (!dataStr)
        return res
          .status(404)
          .json({ success: false, message: "Session đăng ký tạm thời không tồn tại hoặc đã hết hạn", nextStep: "enterPhone" });

      const temp = JSON.parse(dataStr);
      if (!temp.otpVerified)
        return res
          .status(400)
          .json({ success: false, message: "Chưa xác thực OTP" });
      if (!temp.identityCardEnc || !temp.identityCardHash) {
        return res
          .status(400)
          .json({ success: false, message: "Chưa upload/ xác thực CCCD" });
      }

      // kiểm tra trùng số ĐT / CCCD
      const existedActive = await User.findOne({
        phoneNumberHash: phoneHash,
        isActive: true,
      });
      if (existedActive)
        return res
          .status(409)
          .json({ success: false, message: "SĐT đã được đăng ký" });

      const identityUsed = await User.findOne({
        identityCardHash: temp.identityCardHash,
      });
      if (identityUsed)
        return res
          .status(409)
          .json({ success: false, message: "CCCD đã được đăng ký" });

      // OCR + override
      const ocr = temp.ocrData || {};
      const finalFullName = (fullNameOverride || ocr.fullName || "").trim();
      const finalGender = genderOverride || ocr.gender || "other";
      let finalDOBStr = dobOverride || ocr.dateOfBirth || null;
      let finalAddress = addressOverride || ocr.address || null;

      if (!finalFullName || finalGender === "other" || !finalAddress) {
        return res.status(400).json({
          success: false,
          message: "Thiếu thông tin hồ sơ (Họ tên/giới tính/địa chỉ).",
        });
      }

      // parse dob
      let finalDOB = null;
      if (finalDOBStr) {
        const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(finalDOBStr);
        if (m) {
          const [_, dd, mm, yyyy] = m;
          finalDOB = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
        } else {
          const t = new Date(finalDOBStr);
          if (!isNaN(t.getTime())) finalDOB = t;
        }
      }

      // email (optional)
      let emailNorm = null;
      if (email) {
        if (!isValidEmail(email)) {
          return res
            .status(400)
            .json({ success: false, message: "Email không hợp lệ" });
        }
        emailNorm = email.trim().toLowerCase();
        const emailHash = hmacIndex(emailNorm);
        const emailExist = await User.findOne({ emailHash, isActive: true });
        if (emailExist) {
          return res
            .status(409)
            .json({ success: false, message: "Email đã được đăng ký" });
        }
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      // === Tạo user mới, chỉ set field raw ===
      const user = new User({
        fullName: finalFullName,
        gender: finalGender,
        dateOfBirth: finalDOB || null,
        password: hashedPassword,
        role: temp.role,
        isActive: true,
        avatar: avatarDefault,
      });

      // dùng setter của plugin
      user.set("phoneNumber", norm);
      user.set(
        "identityCard",
        temp.identityCardEnc ? decryptField(temp.identityCardEnc) : null
      );
      user.set("address", finalAddress);
      if (emailNorm) user.set("email", emailNorm);

      const savedUser = await user.save();
      await redis.del(key);

      const token = jwt.sign(
        { userId: savedUser._id, role: savedUser.role },
        process.env.JWT_SECRET_KEY || "secret"
      );

      return res.status(200).json({
        success: true,
        message: "Hoàn tất đăng ký",
        data: {
          user: {
            _id: savedUser._id,
            fullName: savedUser.fullName,
            gender: savedUser.gender,
            dateOfBirth: savedUser.dateOfBirth,
            avatar: savedUser.avatar,
          },
          token,
        },
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Lấy thông tin người dùng
  getUserInfo: async (req, res) => {
  try {
    const userId = req?.user?.userId;
    if (!userId) return res.status(401).json({ message: 'Thiếu thông tin xác thực' });

    const u = await User.findById(userId)
      .select('+phoneNumberEnc +emailEnc +addressEnc +identityCardEnc +currentAddressEnc +hometownEnc +bankAccountNumber +bankName +bankAccountHolderName')
      .lean();

    if (!u) return res.status(404).json({ message: 'Người dùng không tồn tại' });

    const crypto = require('crypto');
    const ENC_KEY = Buffer.from(process.env.ENC_KEY || '', 'base64');

    const decryptLegacy = (enc) => {
      if (!enc) return null;
      const [ivB64, ctB64, tagB64] = String(enc).split(':');
      const iv  = Buffer.from(ivB64, 'base64');
      const ct  = Buffer.from(ctB64, 'base64');
      const tag = Buffer.from(tagB64, 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
    };

    const decryptGCM = (packed) => {
      if (!packed) return null;
      const [ivB64, tagB64, dataB64] = String(packed).split('.');
      const iv   = Buffer.from(ivB64,  'base64url');
      const tag  = Buffer.from(tagB64, 'base64url');
      const data = Buffer.from(dataB64,'base64url');
      const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(data), d.final()]).toString('utf8');
    };

    const tryDecryptAny = (v) => {
      if (v == null || v === '') return null;
      const s = String(v);
      try {
        if (s.includes('.')) return decryptGCM(s);   
        if (s.includes(':')) return decryptLegacy(s); 
        return s;
      } catch { return null; }
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

    const pick = (obj, keys) => {
      for (const k of keys) {
        const v = obj?.[k];
        if (v != null && v !== '') return v;
      }
      return null;
    };

    console.log('[getUserInfo] ENC_KEY length(bytes):', ENC_KEY.length);
    console.log('[getUserInfo] enc preview:', {
      phone: u.phoneNumberEnc ? String(u.phoneNumberEnc).slice(0, 16) : undefined,
      email: u.emailEnc ? String(u.emailEnc).slice(0, 16) : undefined,
      id   : u.identityCardEnc ? String(u.identityCardEnc).slice(0, 16) : undefined,
    });

    const phoneCipher = pick(u, ['phoneNumberEnc', 'phoneNumber']);
    const emailCipher = pick(u, ['emailEnc', 'email']);
    const addrCipher  = pick(u, ['addressEnc', 'address']);
    const idCipher    = pick(u, ['identityCardEnc', 'identityCard']);
    const curAddrCiph = pick(u, ['currentAddressEnc', 'currentAddress']);
    const hometownCip = pick(u, ['hometownEnc', 'hometown']);
    const bankAccCiph = u.bankAccountNumber;

    const responseUser = {
      ...u,
      phoneNumber:    deepDecrypt(phoneCipher),
      email:          deepDecrypt(emailCipher),
      address:        deepDecrypt(addrCipher),
      identityCard:   deepDecrypt(idCipher),
      currentAddress: deepDecrypt(curAddrCiph),
      hometown:       deepDecrypt(hometownCip),
      bankAccountNumber: deepDecrypt(bankAccCiph),
      nationality:    u.nationality || 'Việt Nam',
    };

    // dọn rác
    delete responseUser.phoneNumberEnc;
    delete responseUser.phoneNumberHash;
    delete responseUser.emailEnc;
    delete responseUser.emailHash;
    delete responseUser.addressEnc;
    delete responseUser.identityCardEnc;
    delete responseUser.identityCardHash;
    delete responseUser.currentAddressEnc;
    delete responseUser.hometownEnc;

    const mask = (x,n=4)=> (typeof x === 'string' && x ? x.slice(0,n)+'***' : x);
    console.log('[getUserInfo] masked:', {
      phoneNumber: mask(responseUser.phoneNumber),
      email      : mask(responseUser.email),
      identityCard: mask(responseUser.identityCard,3),
    });

    res.set('Cache-Control','no-store');
    return res.status(200).json({ data: responseUser });
  } catch (error) {
    console.error('getUserInfo error:', error);
    return res.status(500).json({ message: 'Đã xảy ra lỗi' });
  }
},

  getUserByIdParam: async (req, res) => {
  try {
    const userId = req?.params?.userId;
    if (!userId) return res.status(401).json({ message: 'Thiếu thông tin xác thực' });

    const u = await User.findById(userId)
      .select('+phoneNumberEnc +emailEnc +addressEnc +identityCardEnc +currentAddressEnc +hometownEnc')
      .lean();

    if (!u) return res.status(404).json({ message: 'Người dùng không tồn tại' });

    const crypto = require('crypto');
    const ENC_KEY = Buffer.from(process.env.ENC_KEY || '', 'base64');

    const decryptLegacy = (enc) => {
      if (!enc) return null;
      const [ivB64, ctB64, tagB64] = String(enc).split(':');
      const iv  = Buffer.from(ivB64, 'base64');
      const ct  = Buffer.from(ctB64, 'base64');
      const tag = Buffer.from(tagB64, 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
    };

    const decryptGCM = (packed) => {
      if (!packed) return null;
      const [ivB64, tagB64, dataB64] = String(packed).split('.');
      const iv   = Buffer.from(ivB64,  'base64url');
      const tag  = Buffer.from(tagB64, 'base64url');
      const data = Buffer.from(dataB64,'base64url');
      const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(data), d.final()]).toString('utf8');
    };

    const tryDecryptAny = (v) => {
      if (v == null || v === '') return null;
      const s = String(v);
      try {
        if (s.includes('.')) return decryptGCM(s);   
        if (s.includes(':')) return decryptLegacy(s); 
        return s;
      } catch { return null; }
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

    const pick = (obj, keys) => {
      for (const k of keys) {
        const v = obj?.[k];
        if (v != null && v !== '') return v;
      }
      return null;
    };

    console.log('[getUserInfo] ENC_KEY length(bytes):', ENC_KEY.length);
    console.log('[getUserInfo] enc preview:', {
      phone: u.phoneNumberEnc ? String(u.phoneNumberEnc).slice(0, 16) : undefined,
      email: u.emailEnc ? String(u.emailEnc).slice(0, 16) : undefined,
      id   : u.identityCardEnc ? String(u.identityCardEnc).slice(0, 16) : undefined,
    });

    const phoneCipher = pick(u, ['phoneNumberEnc', 'phoneNumber']);
    const emailCipher = pick(u, ['emailEnc', 'email']);
    const addrCipher  = pick(u, ['addressEnc', 'address']);
    const idCipher    = pick(u, ['identityCardEnc', 'identityCard']);
    const curAddrCiph = pick(u, ['currentAddressEnc', 'currentAddress']);
    const hometownCip = pick(u, ['hometownEnc', 'hometown']);
    const bankAccCiph = u.bankAccountNumber;

    const responseUser = {
      ...u,
      phoneNumber:    deepDecrypt(phoneCipher),
      email:          deepDecrypt(emailCipher),
      address:        deepDecrypt(addrCipher),
      identityCard:   deepDecrypt(idCipher),
      currentAddress: deepDecrypt(curAddrCiph),
      hometown:       deepDecrypt(hometownCip),
      bankAccountNumber: deepDecrypt(bankAccCiph),
      nationality:    u.nationality || 'Việt Nam',
    };

    // dọn rác
    delete responseUser.phoneNumberEnc;
    delete responseUser.phoneNumberHash;
    delete responseUser.emailEnc;
    delete responseUser.emailHash;
    delete responseUser.addressEnc;
    delete responseUser.identityCardEnc;
    delete responseUser.identityCardHash;
    delete responseUser.currentAddressEnc;
    delete responseUser.hometownEnc;

    const mask = (x,n=4)=> (typeof x === 'string' && x ? x.slice(0,n)+'***' : x);
    console.log('[getUserByIdParam] masked:', {
      phoneNumber: mask(responseUser.phoneNumber),
      email      : mask(responseUser.email),
      identityCard: mask(responseUser.identityCard,3),
    });

    res.set('Cache-Control','no-store');
    return res.status(200).json({ data: responseUser });
  } catch (error) {
    console.error('getUserByIdParam error:', error);
    return res.status(500).json({ message: 'Đã xảy ra lỗi' });
  }
},
  // Quên mật khẩu – gửi OTP
  sendForgotPasswordOTP: async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu số điện thoại" });

      const norm = normalizePhoneVN(phoneNumber);
      const phoneHash = hmacIndex(norm);

      const user = await User.findOne({
        phoneNumberHash: phoneHash,
        isActive: true,
      });
      if (!user)
        return res.status(404).json({
          success: false,
          message: "Số điện thoại không tồn tại trong hệ thống",
        });

      const code = generate4Digits();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      user.otp = { code, expiresAt };
      await user.save({ validateBeforeSave: false });

      const message = `Mã xác nhận đặt lại mật khẩu của bạn là: ${code}`;
      const smsRes = await sendSMS({ to: norm, message });
      if (!smsRes.success)
        return res.status(500).json({
          success: false,
          message: "Gửi SMS thất bại: " + smsRes.message,
        });

      return res
        .status(200)
        .json({ success: true, message: "Đã gửi mã OTP", data: { expiresAt } });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  verifyForgotPasswordOTP: async (req, res) => {
    try {
      const { phoneNumber, otp } = req.body;
      if (!phoneNumber || !otp)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu số điện thoại hoặc mã OTP" });

      const norm = normalizePhoneVN(phoneNumber);
      const phoneHash = hmacIndex(norm);
      const user = await User.findOne({
        phoneNumberHash: phoneHash,
        isActive: true,
      });
      if (!user || !user.otp?.code)
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy mã OTP" });

      if (user.otp.expiresAt < new Date())
        return res
          .status(400)
          .json({ success: false, message: "Mã OTP đã hết hạn" });
      if (user.otp.code !== otp)
        return res
          .status(400)
          .json({ success: false, message: "Mã OTP không đúng" });

      const resetToken = jwt.sign(
        { userId: user._id, purpose: "reset-password" },
        process.env.JWT_SECRET_KEY || "secret",
        { expiresIn: "10m" }
      );

      user.otp = { code: null, expiresAt: null };
      await user.save({ validateBeforeSave: false });

      return res.status(200).json({
        success: true,
        message: "Xác thực OTP thành công",
        data: { resetToken },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  resetPassword: async (req, res) => {
    try {
      const { resetToken, newPassword } = req.body;
      if (!resetToken || !newPassword)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu token hoặc mật khẩu mới" });

      let decoded;
      try {
        decoded = jwt.verify(
          resetToken,
          process.env.JWT_SECRET_KEY || "secret"
        );
        if (decoded.purpose !== "reset-password")
          throw new Error("Invalid token purpose");
      } catch {
        return res.status(401).json({
          success: false,
          message: "Token không hợp lệ hoặc đã hết hạn",
        });
      }

      const user = await User.findById(decoded.userId).select("+password");
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "Người dùng không tồn tại" });

      user.password = await bcrypt.hash(newPassword, 12);
      await user.save();

      return res
        .status(200)
        .json({ success: true, message: "Đặt lại mật khẩu thành công" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Đổi mật khẩu
  changePassword: async (req, res) => {
    try {
      const { oldPassword, newPassword } = req.body;
      if (!oldPassword || !newPassword)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu mật khẩu cũ hoặc mới" });

      const user = await User.findById(req.user.userId).select("+password");
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "Người dùng không tồn tại" });

      const ok = await bcrypt.compare(oldPassword, user.password);
      if (!ok)
        return res
          .status(400)
          .json({ success: false, message: "Mật khẩu cũ không đúng" });

      user.password = await bcrypt.hash(newPassword, 12);
      await user.save();

      return res
        .status(200)
        .json({ success: true, message: "Thay đổi mật khẩu thành công" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Đổi số điện thoại (OTP)
  changePhoneSendOTP: async (req, res) => {
    try {
      const userId = req.user?.userId;
      const { phoneNumber } = req.body;

      if (!userId)
        return res
          .status(401)
          .json({ success: false, message: "Chưa đăng nhập" });
      if (!phoneNumber)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu phoneNumber" });

      const norm = normalizePhoneVN(phoneNumber);
      const phoneHash = hmacIndex(norm);

      const existed = await User.findOne({
        phoneNumberHash: phoneHash,
        isActive: true,
      });
      if (existed)
        return res
          .status(409)
          .json({ success: false, message: "Số điện thoại đã được đăng ký" });


      const code = generateOTP(4);
      const codeHmac = hmacIndex(`otp:changePhone:${code}`);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await redis.set(
        `changePhone:${userId}`,
        JSON.stringify({
          phoneNumberNorm: norm,
          phoneHash,
          codeHmac,
          expiresAt,
          attempts: 0,
        }),
        "EX",
        300
      );

      const message = `Mã xác nhận đổi số điện thoại của bạn là: ${code}`;
      const smsRes = await sendSMS({ to: norm, message });
      if (!smsRes.success)
        return res.status(500).json({
          success: false,
          message: "Gửi SMS thất bại: " + smsRes.message,
        });

      return res.status(200).json({
        success: true,
        message: "Đã gửi OTP tới số điện thoại mới",
        data: { expiresAt },
      });
    } catch (err) {
      console.error("changePhoneSendOTP error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  changePhoneVerify: async (req, res) => {
    try {
      const userId = req.user?.userId;
      const { phoneNumber, otp } = req.body;

      if (!userId)
        return res
          .status(401)
          .json({ success: false, message: "Chưa đăng nhập" });
      if (!phoneNumber || !otp)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu phoneNumber hoặc otp" });

      const norm = normalizePhoneVN(phoneNumber);
      const phoneHash = hmacIndex(norm);
      const key = `changePhone:${userId}`;
      const dataStr = await redis.get(key);

      if (!dataStr)
        return res
          .status(404)
          .json({
            success: false,
            message: "OTP không tồn tại hoặc đã hết hạn",
          });

      const data = JSON.parse(dataStr);
      if (data.phoneHash !== phoneHash)
        return res
          .status(400)
          .json({
            success: false,
            message: "Số điện thoại không khớp với OTP",
          });
      if (new Date(data.expiresAt) < new Date())
        return res
          .status(400)
          .json({ success: false, message: "OTP đã hết hạn" });

      if (hmacIndex(`otp:changePhone:${otp}`) !== data.codeHmac) {
        data.attempts = (data.attempts || 0) + 1;
        await redis.set(key, JSON.stringify(data), "EX", 300);
        return res
          .status(400)
          .json({ success: false, message: "OTP không đúng" });
      }

      const user = await User.findById(userId);
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "Người dùng không tồn tại" });

      user.phoneNumber = encryptField(norm);
      user.phoneNumberHash = phoneHash;
      await user.save();

      await redis.del(key);

      return res
        .status(200)
        .json({ success: true, message: "Đổi số điện thoại thành công" });
    } catch (err) {
      console.error("changePhoneVerify error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Đổi email (OTP)
  changeEmailSendOTP: async (req, res) => {
    try {
      const userId = req.user?.userId;
      const { email } = req.body || {};

      if (!userId)
        return res
          .status(401)
          .json({ success: false, message: "Chưa đăng nhập" });
      if (!email)
        return res.status(400).json({ success: false, message: "Thiếu email" });
      if (!isValidEmail(email))
        return res
          .status(400)
          .json({ success: false, message: "Email không hợp lệ" });

      const emailNorm = email.trim().toLowerCase();
      const emailHash = hmacIndex(emailNorm);

      const existed = await User.findOne({ emailHash, isActive: true });
      if (existed)
        return res
          .status(409)
          .json({ success: false, message: "Email đã được đăng ký" });

      const code = generateOTP(4);
      const codeHmac = hmacIndex(`otp:changeEmail:${code}`);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await redis.set(
        `changeEmail:${userId}`,
        JSON.stringify({
          emailNorm,
          emailHash,
          codeHmac,
          expiresAt,
          attempts: 0,
        }),
        "EX",
        600
      );

      if (process.env.EMAIL_BYPASS === "1") {
        console.log("[DEV][EMAIL_BYPASS] OTP email:", emailNorm, "code:", code);
        return res.status(200).json({
          success: true,
          message: "Đã tạo OTP (DEV bypass)",
          data: { expiresAt, devOTP: code },
        });
      }

      const mailRes = await sendOTPEmail(emailNorm, code);
      if (!mailRes?.success)
        return res
          .status(500)
          .json({ success: false, message: "Gửi email thất bại" });

      return res.status(200).json({
        success: true,
        message: "Đã gửi OTP tới email của bạn",
        data: { expiresAt },
      });
    } catch (err) {
      console.error("changeEmailSendOTP error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  changeEmailVerify: async (req, res) => {
    try {
      const userId = req.user?.userId;
      const { email, otp } = req.body || {};

      if (!userId)
        return res
          .status(401)
          .json({ success: false, message: "Chưa đăng nhập" });
      if (!email || !otp)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu email hoặc otp" });

      const emailNorm = email.trim().toLowerCase();
      const emailHash = hmacIndex(emailNorm);
      const key = `changeEmail:${userId}`;
      const dataStr = await redis.get(key);

      if (!dataStr)
        return res
          .status(404)
          .json({
            success: false,
            message: "OTP không tồn tại hoặc đã hết hạn",
          });

      const data = JSON.parse(dataStr);
      if (data.emailHash !== emailHash)
        return res
          .status(400)
          .json({ success: false, message: "Email không khớp với OTP" });
      if (new Date(data.expiresAt) < new Date())
        return res
          .status(400)
          .json({ success: false, message: "OTP đã hết hạn" });

      if (hmacIndex(`otp:changeEmail:${otp}`) !== data.codeHmac) {
        data.attempts = (data.attempts || 0) + 1;
        await redis.set(key, JSON.stringify(data), "EX", 600);
        return res
          .status(400)
          .json({ success: false, message: "OTP không đúng" });
      }

      const user = await User.findById(userId);
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "Người dùng không tồn tại" });

      user.email = encryptField(emailNorm);
      user.emailHash = emailHash;
      await user.save();

      await redis.del(key);

      return res
        .status(200)
        .json({ success: true, message: "Đổi email thành công" });
    } catch (err) {
      console.error("changeEmailVerify error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Danh sách người già
  getAllElderly: async (req, res) => {
    try {
      const elderlyUsers = await User.find({ role: "elderly" }).select(
        "-password"
      );
      return res.status(200).json({ success: true, data: elderlyUsers });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Cập nhật avatar (multipart + multer)
  updateAvatar: async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId)
        return res
          .status(401)
          .json({ success: false, message: "Chưa đăng nhập" });
      if (!req.file)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu file avatar" });

      // Nếu đang chạy Node >= 18 có Blob/FormData sẵn
      const fileBlob = new Blob([req.file.buffer], { type: req.file.mimetype });
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const uploadPreset = "ecareproject";

      const formData = new FormData();
      formData.append("file", fileBlob, req.file.originalname);
      formData.append("upload_preset", uploadPreset);

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        { method: "POST", body: formData }
      );
      if (!response.ok)
        return res.status(500).json({
          success: false,
          message: `Lỗi upload Cloudinary: ${response.status}`,
        });

      const data = await response.json();
      if (!data.secure_url)
        return res.status(500).json({
          success: false,
          message: "Upload thành công nhưng không có secure_url",
        });

      const user = await User.findById(userId);
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "Người dùng không tồn tại" });

      user.avatar = data.secure_url;
      await user.save({ validateBeforeSave: false });

      return res.status(200).json({
        success: true,
        message: "Cập nhật avatar thành công",
        data: { avatar: user.avatar },
      });
    } catch (err) {
      console.error("updateAvatar error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Đã xảy ra lỗi khi cập nhật avatar" });
    }
  },

  // Cleanup Redis session
  cleanupTemp: async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu số điện thoại" });
      const norm = normalizePhoneVN(phoneNumber);
      const phoneHash = hmacIndex(norm);
      const key = `tempRegister:${phoneHash}`;
      await redis.del(key);
      return res
        .status(200)
        .json({ success: true, message: "Đã xoá session tạm" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Tra cứu session tạm
  getTempRegister: async (req, res) => {
    try {
      const { phoneNumber } = req.query;
      if (!phoneNumber)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu số điện thoại" });
      const norm = normalizePhoneVN(phoneNumber);
      const phoneHash = hmacIndex(norm);
      const key = `tempRegister:${phoneHash}`;
      const dataStr = await redis.get(key);
      if (!dataStr)
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy session tạm" });

      const data = JSON.parse(dataStr);
      return res.status(200).json({
        success: true,
        data: {
          role: data.role,
          otpVerified: !!data.otpVerified,
          expiresAt: data.expiresAt || null,
        },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Cập nhật địa chỉ hiện tại
  updateCurrentAddress: async (req, res) => {
    try {
      const { currentAddress, currentLocation } = req.body;
      
      if (!currentAddress || !currentAddress.trim()) {
        return res.status(400).json({ 
          success: false, 
          message: "Địa chỉ hiện tại không được để trống" 
        });
      }

      // Validate currentLocation if provided
      if (currentLocation) {
        const { latitude, longitude } = currentLocation;
        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
          return res.status(400).json({
            success: false,
            message: "Tọa độ không hợp lệ"
          });
        }
      }

      const userId = req.user.userId;
      
      // Prepare update data
      const updateData = {
        currentAddress: encryptField(currentAddress.trim())
      };

      // Add currentLocation if provided
      if (currentLocation) {
        updateData.currentLocation = {
          type: "Point",
          coordinates: [currentLocation.longitude, currentLocation.latitude]
        };
      }

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        updateData,
        { new: true, select: '-password' }
      );

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy người dùng"
        });
      }

      // Decrypt sensitive fields for response
      const responseUser = {
        ...updatedUser.toObject(),
        currentAddress: tryDecryptField(updatedUser.currentAddress),
        phoneNumber: tryDecryptField(updatedUser.phoneNumber),
        email: tryDecryptField(updatedUser.email),
        address: tryDecryptField(updatedUser.address),
        identityCard: tryDecryptField(updatedUser.identityCard)
      };

      return res.status(200).json({
        success: true,
        message: "Cập nhật địa chỉ hiện tại thành công",
        data: responseUser
      });
    } catch (err) {
      console.error("updateCurrentAddress error:", err);
      return res.status(500).json({
        success: false,
        message: "Lỗi server khi cập nhật địa chỉ"
      });
    }
  },

  getAllSupporters: async (req, res) => {
    try {
      const supporters = await User.find({ role: "supporter" }).select(
        "-password"
      );
      return res.status(200).json({ success: true, data: supporters });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },
  
  getAllSupporterProfiles: async (req, res) => {
    try {
      const supporters = await SupporterProfile.find().populate('user', '-password');
      return res.status(200).json({ success: true, data: supporters });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  getSupporterProfileByUserId: async (req, res) => {
    try {
      const { supporterId } = req.params;
      if (!supporterId) {
        return res.status(400).json({ success: false, message: "Thiếu supporterId" });
      }
      const profile = await SupporterProfile.findOne({ user: supporterId }).populate('user', '-password');
      if (!profile) {
        return res.status(404).json({ success: false, message: "Không tìm thấy hồ sơ người hỗ trợ" });
      }
      return res.status(200).json({ success: true, data: profile });
    } catch (err) {
      console.error('getSupporterProfileByUserId error:', err);
      return res.status(500).json({ success: false, message: err.message });
    } 
  },

  // Hàm lấy tất cả family members theo elderlyID
  getFamilyMembersByElderlyId: async (req, res) => {
    try {
      const { elderlyId } = req.params;
      if (!elderlyId) {
        return res.status(400).json({ success: false, message: "Thiếu elderlyId" });
      }

      const relationships = await Relationship.find({
        elderly: elderlyId,
        status: 'accepted',
        relationship: { $ne: 'Bác sĩ' }
      }).populate('family', '-password');

      // 🆕 Sắp xếp: "Người hỗ trợ" lên đầu
      const supporters = relationships.filter(rel => rel.relationship === 'Người hỗ trợ');
      const others = relationships.filter(rel => rel.relationship !== 'Người hỗ trợ');
      const sortedRelationships = [...supporters, ...others];

      const familyMembers = sortedRelationships.map(rel => rel.family);

      return res.status(200).json({ success: true, data: familyMembers });
    } catch (err) {
      console.error('getFamilyMembersByElderlyId error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Tìm kiếm người già theo số điện thoại (dùng chuẩn hoá + hash như login)
  searchElderlyByPhone: async (req, res) => {
    try {
      const raw = req.query.phoneNumber || req.query.phone || req.body?.phoneNumber;
      if (!raw) {
        return res.status(400).json({ success: false, message: "Thiếu số điện thoại" });
      }

      // Tạo danh sách biến thể giống login
      const variants = phoneLegacyVariants(raw);
      const variantHashes = [...new Set(variants.map(v => hmacIndex(normalizePhoneVN(v))))];

      // Truy vấn theo hash, chỉ lấy role elderly, active
      const elderlyUsers = await User.find({
        role: 'elderly',
        isActive: true,
        phoneNumberHash: { $in: variantHashes },
      }).select('-password');

      // Chuẩn hoá dữ liệu trả về (giải mã các field nhạy cảm nếu cần hiển thị)
      const data = elderlyUsers.map(u => ({
        _id: u._id,
        fullName: u.fullName,
        gender: u.gender,
        dateOfBirth: u.dateOfBirth,
        avatar: u.avatar,
        // Các field dưới đây có thể đã được plugin mã hoá; dùng tryDecryptField để hiển thị an toàn
        address: tryDecryptField(u.address),
        phoneNumber: tryDecryptField(u.phoneNumber),
      }));

      return res.status(200).json({ success: true, data });
    } catch (err) {
      console.error('searchElderlyByPhone error:', err);
      return res.status(500).json({ success: false, message: 'Đã xảy ra lỗi' });
    }
  },

  // Cập nhật thông tin tài khoản ngân hàng
  updateBankAccount: async (req, res) => {
    try {
      const { bankName, bankAccountNumber, bankAccountHolderName } = req.body;
      
      if (!bankName || !bankName.trim()) {
        return res.status(400).json({ 
          success: false, 
          message: "Tên ngân hàng không được để trống" 
        });
      }

      if (!bankAccountNumber || !bankAccountNumber.trim()) {
        return res.status(400).json({ 
          success: false, 
          message: "Số tài khoản không được để trống" 
        });
      }

      if (!bankAccountHolderName || !bankAccountHolderName.trim()) {
        return res.status(400).json({ 
          success: false, 
          message: "Tên chủ tài khoản không được để trống" 
        });
      }

      const userId = req.user.userId;
      
      // Prepare update data - mã hóa số tài khoản giống như currentAddress
      const updateData = {
        bankName: bankName.trim(),
        bankAccountNumber: encryptField(bankAccountNumber.trim()),
        bankAccountHolderName: bankAccountHolderName.trim()
      };

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        updateData,
        { new: true, select: '-password' }
      );

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy người dùng"
        });
      }

      // Decrypt sensitive fields for response
      const responseUser = {
        ...updatedUser.toObject(),
        bankAccountNumber: tryDecryptField(updatedUser.bankAccountNumber),
        currentAddress: tryDecryptField(updatedUser.currentAddress),
        phoneNumber: tryDecryptField(updatedUser.phoneNumber),
        email: tryDecryptField(updatedUser.email),
        address: tryDecryptField(updatedUser.address),
        identityCard: tryDecryptField(updatedUser.identityCard)
      };

      return res.status(200).json({
        success: true,
        message: "Cập nhật thông tin ngân hàng thành công",
        data: responseUser
      });
    } catch (err) {
      console.error("updateBankAccount error:", err);
      return res.status(500).json({
        success: false,
        message: "Lỗi server khi cập nhật thông tin ngân hàng"
      });
    }
  },
  
  
};

module.exports = UserController;

module.exports.encryptField = encryptField;
module.exports.tryDecryptField = tryDecryptField;
