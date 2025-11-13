const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");

const { normalizePhoneVN, hmacIndex } = require("../../utils/cryptoFields");

function phoneLegacyVariants(input = "") {
  // tạo đủ biến thể để truy vấn legacy
  const digits = String(input).replace(/\D/g, ""); 
  if (!digits) return [];
  let local = digits;
  if (digits.startsWith("84")) local = "0" + digits.slice(2);
  if (!digits.startsWith("0")) local = "0" + digits; 

  const with84 = "84" + local.slice(1);
  const withPlus84 = "+84" + local.slice(1);

  // cũng giữ nguyên đầu vào (phòng khi DB lưu “digits” thuần)
  const uniq = new Set([local, with84, withPlus84, digits]);
  return [...uniq];
}


const authenticationController = {
// Đăng nhập
  loginUser: async (req, res) => {
    try {
      const { phoneNumber, password } = req.body || {};
      if (!phoneNumber || !password) {
        return res
          .status(400)
          .json({ message: "Thiếu số điện thoại hoặc mật khẩu" });
      }

      const norm = normalizePhoneVN(phoneNumber);
      const local = norm?.startsWith("84") ? "0" + norm.slice(2) : norm;

      const primaryHash = norm ? hmacIndex(norm) : null;
      const localHash = local ? hmacIndex(local) : null;

      const hashSet = new Set();
      if (primaryHash) hashSet.add(primaryHash);
      if (localHash) hashSet.add(localHash);

      const hashes = [...hashSet];

      let user = null;
      if (hashes.length > 0) {
        user = await User.findOne({
          isActive: true,
          phoneNumberHash: { $in: hashes }
        }).select("+password");
      }

      if (!user) {
        const variants = phoneLegacyVariants(phoneNumber);
        const legacyHashes = [
          ...new Set(variants.flatMap((v) => {
            const normVariant = normalizePhoneVN(v);
            if (!normVariant) return [];
            const localVariant = normVariant.startsWith("84") ? "0" + normVariant.slice(2) : normVariant;
            return [hmacIndex(normVariant), hmacIndex(localVariant)];
          }))
        ];
        if (legacyHashes.length > 0) {
          user = await User.findOne({
            isActive: true,
            phoneNumberHash: { $in: legacyHashes }
          }).select("+password");
        }
      }

      if (!user) {
        return res
          .status(404)
          .json({ message: "Người dùng không tồn tại hoặc chưa kích hoạt" });
      }
      if (!user.isActive) {
      }

      const ok = await bcrypt.compare(password, user.password);
      if (!ok)
        return res
          .status(401)
          .json({ message: "Số điện thoại hoặc mật khẩu không đúng" });

      // Migrate lần đầu: bảo đảm enc/hash đúng plugin
      let touched = false;
      if (primaryHash && (!user.phoneNumberHash || user.phoneNumberHash !== primaryHash)) {
        user.phoneNumberHash = primaryHash;
        touched = true;
      }
      // no alt field required; using only primary hash
      if (!user.phoneNumberEnc && norm) {
        user.set("phoneNumber", norm);
        touched = true;
      }
      user.lastLogin = new Date();
      if (touched) await user.save({ validateBeforeSave: false });

      const token = jwt.sign(
        { userId: user._id, role: user.role, isActive: user.isActive },
        process.env.JWT_SECRET_KEY || "secret",
      );

      const safe = await User.findById(user._id).select("-password");
      return res
        .status(200)
        .json({ message: "Đăng nhập thành công", token, user: safe });
    } catch (e) {
      console.error("loginUser error:", e);
      return res.status(500).json({ message: "Đã xảy ra lỗi" });
    }
  },

};

module.exports = authenticationController;