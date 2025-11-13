const express = require("express");
const router = express.Router();

const DoctorController = require("../app/controllers/doctorController");
const authenticateToken = require("../app/middlewares/authMiddleware");

router.get("/by-user/:userId", DoctorController.getDoctorProfileByUserId);

router.use(authenticateToken);
router.post("/create", DoctorController.createDoctorProfile);
router.put("/update", DoctorController.updateDoctorProfile);
router.get("/me", DoctorController.getMyDoctorProfile);
router.get("/by-id/:profileId", DoctorController.getDoctorProfileById);
router.post("/schedule/create", DoctorController.createScheduleForDay);
router.put("/schedule/update", DoctorController.updateScheduleForDay);
router.post("/schedule/copy", DoctorController.copyScheduleToDays);
router.get("/ratings/stats", DoctorController.getMyRatingStats);
router.delete("/schedule/delete", DoctorController.deleteSchedule);

router.get("/:userId/schedule", DoctorController.getDoctorPublicWeeklySchedule); 
router.get("/:userId/slots", DoctorController.getDoctorDailySlots); 
router.get("/:userId/reviews", DoctorController.listDoctorReviews);
router.post("/:userId/reviews", DoctorController.createDoctorReview);
router.get("/:userId/ratings/summary", DoctorController.getDoctorRatingSummary);
router.get("/:userId/summary", DoctorController.getDoctorActivitySummary);
module.exports = router;
