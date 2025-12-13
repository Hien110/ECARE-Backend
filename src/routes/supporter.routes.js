const express = require("express");
const router = express.Router();

const SupporterController = require("../app/controllers/supporterController");
const authenticateToken = require("../app/middlewares/authMiddleware");

router.use(authenticateToken);
router.post("/create", SupporterController.createMyProfile);
router.get("/me", SupporterController.getMyProfile);
router.put("/me", SupporterController.updateMyProfile);
router.post('/availability', SupporterController.getAvailableSupporters);

// rating hồ sơ supporter
router.get("/:userId/reviews", SupporterController.listSupporterReviews);
router.post("/:userId/reviews", SupporterController.createSupporterReview);
router.get("/:userId/ratings/summary", SupporterController.getSupporterRatingSummary);

module.exports = router;