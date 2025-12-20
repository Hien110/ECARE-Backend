const express = require("express");

const router = express.Router();

const RatingController = require("../app/controllers/ratingController");
const authenticateToken = require("../app/middlewares/authMiddleware");


router.use(authenticateToken);

// Đánh giá dịch vụ hỗ trợ
router.post("/", RatingController.createRatingSupportService);

// Lấy đánh giá theo Id dịch vụ hỗ trợ
router.get("/service-support/:serviceSupportId/:reviewer", RatingController.getRatingsByServiceSupportIdAndReviewer);

// Lấy đánh giá theo Id lịch khám tư vấn
router.get("/consultation/:consultationId", RatingController.getRatingByConsultationId);

// Lấy đánh giá theo Id lịch hỗ trợ
router.get("/support-service/:serviceSupportId", RatingController.getRatingSupportServiceById);

// Chỉnh sửa: Lấy đánh giá theo Id người dùng được đánh giá
router.put("/:ratingId", RatingController.updateRatingById);

// Xóa: Lấy đánh giá theo Id người dùng được đánh giá
router.delete("/:ratingId", RatingController.deleteRatingById);

// Lấy đánh giá theo Id người dùng được đánh giá
router.get("/:userId", RatingController.getRatingsByUserId);


module.exports = router;
