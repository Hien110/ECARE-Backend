const express = require("express");
const router = express.Router();

const SupporterController = require("../app/controllers/supporterController");
const authenticateToken = require("../app/middlewares/authMiddleware");

router.use(authenticateToken);
router.post("/create", SupporterController.createMyProfile);
router.get("/me", SupporterController.getMyProfile);
router.put("/me", SupporterController.updateMyProfile);
router.post('/availability', SupporterController.getAvailableSupporters);

module.exports = router;