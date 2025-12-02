const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require("../models/User.js");
const SupporterProfile = require("../models/SupporterProfile.js");
const SupporterScheduling = require('../models/SupporterScheduling');
const buildConflictQuery = require('../../utils/buildConflictQuery');

// Không dùng mongoose.Types.ObjectId — kiểm tra bằng regex 24 hex
const isValidObjectId = (v) => typeof v === "string" && /^[a-fA-F0-9]{24}$/.test(v);

const VALID_TIME_SLOTS = ["morning", "afternoon", "evening"];
const BANK_CARD_NUMBER_RE = /^\d{12,19}$/;

// ====== ENC helpers (dựa trên getUserInfo trong UserController) ======
const ENC_KEY = Buffer.from(process.env.ENC_KEY || '', 'base64');

const decryptLegacy = (enc) => {
  if (!enc) return null;
  if (!ENC_KEY || ENC_KEY.length === 0) return null;
  const parts = String(enc).split(':');
  if (parts.length !== 3) return null;
  const [ivB64, ctB64, tagB64] = parts;
  const iv  = Buffer.from(ivB64, 'base64');
  const ct  = Buffer.from(ctB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
};

const decryptGCM = (packed) => {
  if (!packed) return null;
  if (!ENC_KEY || ENC_KEY.length === 0) return null;
  const parts = String(packed).split('.');
  if (parts.length !== 3) return null;
  const [ivB64, tagB64, dataB64] = parts;
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

const pick = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && v !== '') return v;
  }
  return null;
};

// Giải mã các field nhạy cảm trong user đã populate
function buildDecryptedUser(userDoc) {
  if (!userDoc) return null;
  const u = typeof userDoc.toObject === 'function' ? userDoc.toObject() : { ...userDoc };

  const phoneCipher   = pick(u, ['phoneNumberEnc', 'phoneNumber']);
  const addrCipher    = pick(u, ['addressEnc', 'address']);
  const curAddrCipher = pick(u, ['currentAddressEnc', 'currentAddress']);

  const decryptedUser = {
    ...u,
    phoneNumber:    deepDecrypt(phoneCipher),
    address:        deepDecrypt(addrCipher),
    currentAddress: deepDecrypt(curAddrCipher),
  };

  // log nhẹ để debug
  console.log('[SupporterProfileController] decryptedUser address =', decryptedUser.address);
  console.log('[SupporterProfileController] decryptedUser currentAddress =', decryptedUser.currentAddress);

  // dọn rác các field Enc trước khi trả ra ngoài
  delete decryptedUser.phoneNumberEnc;
  delete decryptedUser.addressEnc;
  delete decryptedUser.currentAddressEnc;
  delete decryptedUser.phoneNumberHash;

  return decryptedUser;
}

function toStringSet(arr) {
  return new Set((arr || []).map(String));
}

/* ------------ Helpers ------------ */
function validateAndNormalizeSchedule(scheduleInput) {
  if (!Array.isArray(scheduleInput)) return null;

  const seen = new Set();
  const out = [];

  for (const raw of scheduleInput) {
    if (!raw || typeof raw !== "object") continue;

    const day = Number(raw.dayOfWeek);
    const slot = String(raw.timeSlots || "").trim();

    if (!Number.isInteger(day) || day < 2 || day > 8) continue;
    if (!VALID_TIME_SLOTS.includes(slot)) continue;

    const key = `${day}-${slot}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ dayOfWeek: day, timeSlots: slot });
    }
  }
  return out;
}

// Validate & chuẩn hoá thẻ ngân hàng.
// Trả null nếu không hợp lệ; trả object đã chuẩn hoá nếu hợp lệ.
// Cho phép client gửi null để xoá thẻ (xử lý tại pickUpdatableFields).
function normalizeAndValidateBankCard(input) {
  if (!input || typeof input !== "object") return null;

  const out = {};

  // cardNumber: chỉ lấy số, bỏ khoảng trắng/dấu gạch
  if (typeof input.cardNumber === "string") {
    const digits = input.cardNumber.replace(/[^\d]/g, "");
    if (!BANK_CARD_NUMBER_RE.test(digits)) return null;
    out.cardNumber = digits;
  } else {
    return null;
  }

  if (typeof input.cardHolderName === "string" && input.cardHolderName.trim()) {
    out.cardHolderName = input.cardHolderName.trim();
  } else {
    return null;
  }

  const m = Number(input.expiryMonth);
  const y = Number(input.expiryYear);
  const now = new Date();
  const curM = now.getMonth() + 1;
  const curY = now.getFullYear();

  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (!Number.isInteger(y) || y < curY) return null;
  if (y === curY && m < curM) return null;

  out.expiryMonth = m;
  out.expiryYear = y;

  return out;
}

/**
 * Chỉ cho phép update các field hợp lệ để tránh user ghi bừa
 * Trả về object đã chuẩn hoá; có thể rỗng.
 * Nếu schedule gửi sai kiểu -> gắn cờ __invalidSchedule
 * Nếu bankCard gửi sai -> ném lỗi {status:400}
 */
function pickUpdatableFields(body) {
  const picked = {};
  if (!body || typeof body !== "object") return picked;

  // experience
  if (body.experience && typeof body.experience === "object") {
    const exp = {};
    if (typeof body.experience.totalYears === "number" && Number.isFinite(body.experience.totalYears)) {
      exp.totalYears = Math.max(0, Math.min(60, body.experience.totalYears));
    }
    if (typeof body.experience.description === "string") {
      exp.description = body.experience.description.trim();
    }
    if (Object.keys(exp).length) picked.experience = exp;
  }

  // schedule
  if ("schedule" in body) {
    const norm = validateAndNormalizeSchedule(body.schedule);
    if (norm === null) {
      picked.__invalidSchedule = true;
    } else {
      picked.schedule = norm; // chấp nhận mảng rỗng sau chuẩn hoá
    }
  }

  // serviceArea
  if (typeof body.serviceArea === "number" && Number.isFinite(body.serviceArea)) {
    picked.serviceArea = Math.max(0, Math.min(50, body.serviceArea));
  }

  // ===== sessionFee (BỔ SUNG) =====
  if (body.sessionFee && typeof body.sessionFee === "object") {
    const sf = {};
    const norm = (x) => {
      const n = Number(x);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    if (body.sessionFee.morning !== undefined) sf.morning = norm(body.sessionFee.morning);
    if (body.sessionFee.afternoon !== undefined) sf.afternoon = norm(body.sessionFee.afternoon);
    if (body.sessionFee.evening !== undefined) sf.evening = norm(body.sessionFee.evening);
    if (Object.keys(sf).length) picked.sessionFee = sf;
  }
  // ================================

  // bankCard
  if ("bankCard" in body) {
    // Cho phép xoá thẻ: client gửi null
    if (body.bankCard === null) {
      picked.bankCard = null; // sẽ $unset phía dưới
    } else {
      const bc = normalizeAndValidateBankCard(body.bankCard);
      if (!bc) {
        const err = new Error("Dữ liệu thẻ ngân hàng không hợp lệ");
        err.status = 400;
        throw err;
      }
      picked.bankCard = bc;
    }
  }

  return picked;
}

/* ------------ Controller ------------ */
const SupporterProfileController = {
  // POST /supporter-profiles
  createMyProfile: async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!isValidObjectId(userId)) {
        return res.status(401).json({ success: false, message: "Chưa đăng nhập" });
      }

      const me = await User.findById(userId).select("role");
      if (!me || me.role !== "supporter") {
        return res.status(403).json({ success: false, message: "Chỉ tài khoản supporter mới được tạo hồ sơ" });
      }

      const existed = await SupporterProfile.exists({ user: userId });
      if (existed) {
        return res.status(409).json({ success: false, message: "Hồ sơ đã tồn tại. Vui lòng dùng API cập nhật." });
      }

      let payload;
      try {
        payload = pickUpdatableFields(req.body);
      } catch (e) {
        const code = e.status || 400;
        return res.status(code).json({ success: false, message: e.message || "Payload không hợp lệ" });
      }

      if (payload.__invalidSchedule) {
        return res.status(400).json({ success: false, message: "Dữ liệu lịch làm việc (schedule) không hợp lệ" });
      }
      delete payload.__invalidSchedule;

      const doc = await SupporterProfile.create({ user: userId, ...payload });
      await doc.populate({
        path: "user",
        select:
          "fullName avatar phoneNumber role currentAddress address currentLocation " +
          "+phoneNumberEnc +addressEnc +currentAddressEnc",
      });

      const profileObj = doc.toObject();
      profileObj.user = buildDecryptedUser(doc.user);

      return res.status(201).json({
        success: true,
        message: "Tạo hồ sơ mô tả công việc thành công",
        data: profileObj,
      });
    } catch (err) {
      console.error("Error createMyProfile:", err);
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi tạo hồ sơ" });
    }
  },

  // GET /supporter-profiles/me
  getMyProfile: async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!isValidObjectId(userId)) {
        return res.status(401).json({ success: false, message: "Chưa đăng nhập" });
      }

      const doc = await SupporterProfile.findOne({ user: userId }).populate({
        path: "user",
        select:
          "fullName avatar phoneNumber role currentAddress address currentLocation " +
          "+phoneNumberEnc +addressEnc +currentAddressEnc",
      });

      if (!doc) {
        return res.status(404).json({ success: false, message: "Bạn chưa có hồ sơ. Hãy tạo hồ sơ trước." });
      }

      const profileObj = doc.toObject();
      profileObj.user = buildDecryptedUser(doc.user);

      return res.status(200).json({ success: true, data: profileObj });
    } catch (err) {
      console.error("Error getMyProfile:", err);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  // PATCH /supporter-profiles/me
  updateMyProfile: async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!isValidObjectId(userId)) {
        return res.status(401).json({ success: false, message: "Chưa đăng nhập" });
      }

      const me = await User.findById(userId).select("role");
      if (!me || me.role !== "supporter") {
        return res.status(403).json({ success: false, message: "Chỉ tài khoản supporter mới được cập nhật hồ sơ" });
      }

      let update;
      try {
        update = pickUpdatableFields(req.body);
      } catch (e) {
        const code = e.status || 400;
        return res.status(code).json({ success: false, message: e.message || "Payload không hợp lệ" });
      }

      if (update.__invalidSchedule) {
        return res.status(400).json({ success: false, message: "Dữ liệu lịch làm việc (schedule) không hợp lệ" });
      }
      delete update.__invalidSchedule;

      const setObj = {};
      const unsetObj = {};
      Object.entries(update).forEach(([k, v]) => {
        if (k === "bankCard" && v === null) unsetObj.bankCard = 1;
        else setObj[k] = v;
      });

      if (setObj.sessionFee && typeof setObj.sessionFee === "object") {
        const norm = (x) => {
          const n = Number(x);
          return Number.isFinite(n) && n >= 0 ? n : 0;
        };
        const { morning, afternoon, evening } = setObj.sessionFee;

        if (morning !== undefined) setObj["sessionFee.morning"] = norm(morning);
        if (afternoon !== undefined) setObj["sessionFee.afternoon"] = norm(afternoon);
        if (evening !== undefined) setObj["sessionFee.evening"] = norm(evening);

        delete setObj.sessionFee;
      }

      const updateDoc =
        Object.keys(unsetObj).length ? { $set: setObj, $unset: unsetObj } : { $set: setObj };

      const doc = await SupporterProfile.findOneAndUpdate(
        { user: userId },
        updateDoc,
        {
          new: true,
          runValidators: true,   // ✅ validator schema
          context: "query",      // ✅ cần cho min/max/enum khi update
        }
      ).populate({
        path: "user",
        select:
          "fullName avatar phoneNumber role currentAddress address currentLocation " +
          "+phoneNumberEnc +addressEnc +currentAddressEnc",
      });

      if (!doc) {
        return res.status(404).json({ success: false, message: "Chưa có hồ sơ để cập nhật. Hãy tạo hồ sơ trước." });
      }

      const profileObj = doc.toObject();
      profileObj.user = buildDecryptedUser(doc.user);

      return res.status(200).json({ success: true, message: "Cập nhật hồ sơ thành công", data: profileObj });
    } catch (err) {
      console.error("Error updateMyProfile:", err);
      return res.status(500).json({ success: false, message: "Đã xảy ra lỗi khi cập nhật hồ sơ" });
    }
  },

  getAvailableSupporters: async (req, res) => {
    try {
      const { bookingDraft } = req.body;
      console.log(bookingDraft);

      if (!bookingDraft?.packageType) {
        return res.status(400).json({ success: false, message: 'Thiếu bookingDraft' });
      }

      // 1) Lấy toàn bộ userId của supporter có hồ sơ
      const universeIds = await SupporterProfile.distinct('user'); // [ObjectId]

      if (!universeIds.length) {
        return res.json({
          success: true,
          data: { busySupporterIds: [], availableSupporterIds: [] },
        });
      }

      // 2) Dựng truy vấn tìm lịch xung đột theo bookingDraft
      //    buildConflictQuery cần xử lý đủ 3 loại: session/day/month và loại trừ status 'canceled'
      const conflictBase = buildConflictQuery(bookingDraft);

      // 3) Tìm những supporter đang BẬN (có lịch xung đột)
      const busySupporterIds = await SupporterScheduling.distinct('supporter', {
        supporter: { $in: universeIds },
        ...conflictBase,
      });

      // 4) Lấy danh sách RẢNH = ALL - BUSY
      const busySet = toStringSet(busySupporterIds);
      const availableSupporterIds = universeIds
        .map(String)
        .filter((id) => !busySet.has(id));

      return res.json({
        success: true,
        data: {
          busySupporterIds: busySupporterIds.map(String),
          availableSupporterIds,
        },
      });
    } catch (e) {
      console.error('availability error', e);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  },
};

module.exports = SupporterProfileController;
