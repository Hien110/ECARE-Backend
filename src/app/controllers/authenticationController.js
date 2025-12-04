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
    console.log("=== LOGIN ATTEMPT ===");
    console.log("Raw body:", req.body);

    const { phoneNumber, password } = req.body || {};

    // Log số điện thoại người dùng nhập (an toàn)
    console.log("Input phoneNumber:", phoneNumber);
    console.log("Input password:", password ? "Có cung cấp" : "Không có");

    if (!phoneNumber || !password) {
      console.log("Thiếu phoneNumber hoặc password → 400");
      return res
        .status(400)
        .json({ message: "Thiếu số điện thoại hoặc mật khẩu" });
    }

    const norm = normalizePhoneVN(phoneNumber);
    const local = norm?.startsWith("84") ? "0" + norm.slice(2) : norm;

    console.log("Normalized (84...):", norm);
    console.log("Local format (0...):", local);

    const primaryHash = norm ? hmacIndex(norm) : null;
    const localHash = local ? hmacIndex(local) : null;

    console.log("Primary hash:", primaryHash);
    console.log("Local hash:", localHash);

    const hashSet = new Set();
    if (primaryHash) hashSet.add(primaryHash);
    if (localHash) hashSet.add(localHash);

    const hashes = [...hashSet];
    console.log("Hashes to query:", hashes);

    let user = null;
    if (hashes.length > 0) {
      user = await User.findOne({
        isActive: true,
        phoneNumberHash: { $in: hashes }
      }).select("+password");

      console.log("Tìm user bằng hash hiện tại →", user ? `Tìm thấy user ID: ${user._id} (${user.role})` : "Không tìm thấy");
    }

    // Nếu không tìm thấy → thử legacy variants (hữu ích khi migrate dữ liệu cũ)
    if (!user) {
      console.log("Không tìm thấy bằng hash mới → thử legacy variants...");
      const variants = phoneLegacyVariants(phoneNumber);
      console.log("Legacy variants:", variants);

      const legacyHashes = [
        ...new Set(variants.flatMap((v) => {
          const normVariant = normalizePhoneVN(v);
          if (!normVariant) return [];
          const localVariant = normVariant.startsWith("84") ? "0" + normVariant.slice(2) : normVariant;
          return [hmacIndex(normVariant), hmacIndex(localVariant)].filter(Boolean);
        }))
      ];
      console.log("Legacy hashes:", legacyHashes);

      if (legacyHashes.length > 0) {
        user = await User.findOne({
          isActive: true,
          phoneNumberHash: { $in: legacyHashes }
        }).select("+password");

        console.log("Tìm bằng legacy hash →", user ? `Tìm thấy user ID: ${user._id}` : "Vẫn không tìm thấy");
      }
    }

    if (!user) {
      console.log("User không tồn tại hoặc chưa kích hoạt → 404");
      return res
        .status(404)
        .json({ message: "Người dùng không tồn tại hoặc chưa kích hoạt" });
    }

    // Kiểm tra mật khẩu
    const ok = await bcrypt.compare(password, user.password);
    console.log("Kiểm tra mật khẩu →", ok ? "ĐÚNG" : "SAI");

    if (!ok) {
      return res
        .status(401)
        .json({ message: "Số điện thoại hoặc mật khẩu không đúng" });
    }

    // Migrate dữ liệu cũ nếu cần
    let touched = false;
    if (primaryHash && (!user.phoneNumberHash || user.phoneNumberHash !== primaryHash)) {
      console.log("Cập nhật phoneNumberHash mới:", primaryHash);
      user.phoneNumberHash = primaryHash;
      touched = true;
    }
    if (!user.phoneNumberEnc && norm) {
      console.log("Cập nhật phoneNumberEnc (encrypted):", norm);
      user.set("phoneNumber", norm);
      touched = true;
    }
    user.lastLogin = new Date();
    if (touched) {
      await user.save({ validateBeforeSave: false });
      console.log("Đã migrate dữ liệu user thành công");
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role, isActive: user.isActive },
      process.env.JWT_SECRET_KEY || "secret",
    );

    const safe = await User.findById(user._id).select("-password");

    console.log(`Đăng nhập thành công → User ID: ${user._id} | Role: ${user.role}`);
    console.log("=== LOGIN SUCCESS ===\n");

    return res
      .status(200)
      .json({ message: "Đăng nhập thành công", token, user: safe });

  } catch (e) {
    console.error("Login error:", e);
    return res.status(500).json({ message: "Đã xảy ra lỗi" });
  }
},
};

module.exports = authenticationController;