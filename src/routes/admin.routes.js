const express = require("express");
const router = express.Router();
const multer = require("multer");

const AdminController = require("../app/controllers/adminController");
const authenticateToken = require("../app/middlewares/authMiddleware");
const { authorize } = require("../app/middlewares/authorize");

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file Excel (.xlsx, .xls)'), false);
    }
  }
});

// Middleware: Require authentication and admin role only
router.use(authenticateToken);
router.use(authorize("admin")); // Chỉ admin mới có thể truy cập

// Admin supporter management routes
router.post("/supporters", AdminController.createSupporter);
router.get("/supporters/:userId", AdminController.getSupporterProfile);
router.patch("/status/:userId", AdminController.setUserActive);
router.get("/supporters", AdminController.getAllSupporters);
router.post("/supporters/bulk-import", upload.single('file'), AdminController.bulkImportSupporters);

// Admin doctor management routes
router.post("/doctors", AdminController.createDoctor);
router.post("/doctors/bulk-import", upload.single('file'), AdminController.bulkImportDoctors);

// Admin: all users
router.get("/users", AdminController.getAllUsers);
router.get("/users/:userId", AdminController.getUserById);

// Admin: dashboard stats
router.get("/dashboard", AdminController.getDashboard);

// Admin: registered health packages (list & detail)
router.get("/registered-packages", AdminController.getRegisteredPackages);
router.post("/registered-packages/:registrationId/assign-doctor", AdminController.assignDoctorToRegistration);
router.get("/registered-packages/:id", AdminController.getRegisteredPackageById);
router.get("/consultation-schedules/beneficiary/:beneficiaryId", AdminController.getConsultationSchedulesByBeneficiary);

// Admin: nearby doctors for elderly
router.get("/nearby-doctors", AdminController.getNearbyDoctors);

// Admin status check
router.get("/status", AdminController.checkAdminStatus);
router.get("/relationship/accepted-family/:familyId", AdminController.getAcceptRelationshipByFamilyIdAdmin);
// Refresh admin token (không cần authorize vì đã có authenticateToken)
router.post("/refresh-token", AdminController.refreshAdminToken);
router.put("/reset-password/:userId", AdminController.resetUserPassword);
// Admin: Lấy danh sách lịch hẹn supporter theo status
router.get("/supporter-schedules", AdminController.getSupporterSchedulesByStatus);
router.get("/package/:doctorId", AdminController.getPackagesByDoctor);

module.exports = router;
