const express = require('express');
const router = express.Router();
const supporterSchedulingController = require('../app/controllers/supporterSchedulingController');
const authenticateToken = require('../app/middlewares/authMiddleware');
const { authorize, checkUserStatus } = require('../app/middlewares/authorize');

// router.use(authenticateToken);
// Tạo lịch hỗ trợ mới
router.use(authenticateToken);
router.get('/supporter-detail/:id',supporterSchedulingController.getSupporterDetail);
router.post('/', supporterSchedulingController.createScheduling);

// Lấy danh sách đặt lịch theo id
router.post('/list', supporterSchedulingController.getSchedulingsByUserId);

// Kiểm tra lịch đã hoàn thành hết hay chưa
router.post('/check-completion', supporterSchedulingController.checkAllCompletedOrCanceled);

router.post('/supporter-list', supporterSchedulingController.getSchedulingsBySupporterId);

// Lấy chi tiết đặt lịch theo id
router.get('/:id', supporterSchedulingController.getSchedulingById);

// Cập nhật trạng thái đặt lịch
router.put('/:id/status', supporterSchedulingController.updateSchedulingStatus);

router.use(authorize('admin'));

// Lấy tất cả danh sách đặt lịch dành cho mục đích admin (có phân trang, lọc, tìm kiếm)
router.get('/admin/all', supporterSchedulingController.getAllSchedulingsForAdmin);

module.exports = router;
