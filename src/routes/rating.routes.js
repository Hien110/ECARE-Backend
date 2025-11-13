const express = require("express");

const router = express.Router();

const RatingController = require("../app/controllers/ratingController");
const authenticateToken = require("../app/middlewares/authMiddleware");


router.use(authenticateToken);
router.get("/:userId", RatingController.getRatingsByUserId);

module.exports = router;
