const express = require('express');
const router = express.Router();
const supporterSchedulingController = require('../app/controllers/supporterSchedulingController');
const authenticateToken = require('../app/middlewares/authMiddleware');
const { authorize, checkUserStatus } = require('../app/middlewares/authorize');

// All routes require authentication
router.use(authenticateToken);

// PUBLIC/AUTHENTICATED ROUTES (not admin-only)
router.post('/', supporterSchedulingController.createScheduling);
router.post('/list', supporterSchedulingController.getSchedulingsByUserId);
router.post('/check-completion', supporterSchedulingController.checkAllCompletedOrCanceled);
router.post('/supporter-list', supporterSchedulingController.getSchedulingsBySupporterId);
router.post('/by-status', supporterSchedulingController.getSchedulingsByStatus);
router.get('/supporter-detail/:id', supporterSchedulingController.getSupporterDetail);
router.get('/:id', supporterSchedulingController.getSchedulingById);
router.put('/:id/status', supporterSchedulingController.updateSchedulingStatus);
router.put('/:id/payment-status', supporterSchedulingController.updatePaymentStatus);

// ADMIN-ONLY ROUTES
router.get('/admin/all', authorize('admin'), supporterSchedulingController.getAllSchedulingsForAdmin);

module.exports = router;
