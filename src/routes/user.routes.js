const express = require("express");
const router = express.Router();

const UserController = require("../app/controllers/userController"); 
const authenticateToken = require("../app/middlewares/authMiddleware");
const { upload } = require("../app/middlewares/upload");
const AuthController = require("../app/controllers/authenticationController");
// Multer for CCCD OCR (disk temp so we have file paths)
const multer = require("multer");
const os = require("os");
const path = require("path");
const uploadOcr = multer({ dest: path.join(os.tmpdir(), "ecare-ocr") });
/* ---------- Public ---------- */
router.post("/registerUser", UserController.registerUser);
router.post("/loginUser", AuthController.loginUser);

// OTP đăng ký
router.post("/send-otp", UserController.sendOTP);
router.post("/verify-otp", UserController.verifyOTP);

// B3: Upload CCCD (multipart) -> OCR
router.post(
	"/register/kyc/cccd",
	uploadOcr.fields([
		{ name: "frontImage", maxCount: 1 },
		{ name: "backImage", maxCount: 1 },
	]),
	UserController.uploadCCCD
);

// B4: Hoàn tất hồ sơ
router.post("/register/complete", UserController.completeProfile);

// Quên mật khẩu
router.post("/forgot-password/send-otp", UserController.sendForgotPasswordOTP);
router.post("/forgot-password/verify-otp", UserController.verifyForgotPasswordOTP);
router.post("/forgot-password/reset", UserController.resetPassword);

// Session tạm
router.post("/cleanup-temp", UserController.cleanupTemp);
router.get("/temp-register", UserController.getTempRegister);

/* ---------- Protected ---------- */
router.use(authenticateToken);

router.get("/getUserInfo", UserController.getUserInfo);
router.put("/change-password", UserController.changePassword);

router.post("/change-phone/send-otp", UserController.changePhoneSendOTP);
router.post("/change-phone/verify", UserController.changePhoneVerify);
router.post("/change-email/send-otp", UserController.changeEmailSendOTP);
router.post("/change-email/verify", UserController.changeEmailVerify);

router.get("/get-elderly", UserController.getAllElderly);
router.get("/search-elderly-by-phone", UserController.searchElderlyByPhone);

router.get("/get-supporters", UserController.getAllSupporters);
router.get("/get-supporter-profiles", UserController.getAllSupporterProfiles);

// lấy supporter profile theo supporterId
router.get("/supporter-profile/:supporterId", UserController.getSupporterProfileByUserId);

// Avatar dùng multipart (có upload)
router.post("/me/avatar", upload.single("avatar"), UserController.updateAvatar);

// Cập nhật địa chỉ hiện tại
router.put("/update-address", UserController.updateCurrentAddress);

// Lấy tất cả family members theo elderlyId
router.get("/family-members/:elderlyId", UserController.getFamilyMembersByElderlyId);

// Lấy thông tin user theo userId
router.get("/:userId", UserController.getUserByIdParam);

module.exports = router;