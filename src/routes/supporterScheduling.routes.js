const express = require('express');
const router = express.Router();
const supporterSchedulingController = require('../app/controllers/supporterSchedulingController');
const authenticateToken = require('../app/middlewares/authMiddleware');

// router.use(authenticateToken);
// Tạo lịch hỗ trợ mới
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

// Lấy tất cả danh sách đặt lịch dành cho mục đích admin (có phân trang, lọc, tìm kiếm)
router.get('/admin/all', supporterSchedulingController.getAllSchedulingsForAdmin);

module.exports = router;
