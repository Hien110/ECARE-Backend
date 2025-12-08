const express = require("express");
const router = express.Router();

const DoctorBookingController = require("../app/controllers/doctorBookingController");
const authenticateToken = require("../app/middlewares/authMiddleware");

// Tất cả API dưới đây đều yêu cầu đăng nhập
router.use(authenticateToken);

router.get("/elderlies", DoctorBookingController.getConnectedElderlies);
router.get("/available-doctors", DoctorBookingController.getAvailableDoctors);
router.get("/doctors/:doctorId", DoctorBookingController.getDoctorDetail);
router.get(
	"/doctors/:doctorId/free-schedule",
	DoctorBookingController.getDoctorFreeSchedule,
);
router.get(
  "/default-price",
  DoctorBookingController.getDefaultConsultationPrice,
);
router.get("/my-bookings", DoctorBookingController.getMyBookings);
router.get("/registrations/:id", DoctorBookingController.getRegistrationDetail);
router.get("/by-elderly/:elderlyId", DoctorBookingController.getBookingsByElderlyId);
router.post("/registrations/:id/cancel", DoctorBookingController.cancelBooking);
router.post("/registrations", DoctorBookingController.createRegistration);

module.exports = router;
