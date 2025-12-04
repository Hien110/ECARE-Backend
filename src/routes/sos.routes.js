const express = require('express');
const router = express.Router();
const sosController = require('../app/controllers/sosController');
const fcmController = require('../app/controllers/fcmController');
const authMiddleware = require('../app/middlewares/authMiddleware');

// ============= FCM TOKEN ROUTES (PHẢI ĐỊNH NGHĨA TRƯỚC!) =============
// ⚠️ QUAN TRỌNG: FCM routes phải trước dynamic routes (:sosId) để router khớp đúng pattern

/**
 * @route   POST /api/sos/fcm/token
 * @desc    Lưu FCM token khi user login hoặc mở app
 * @body    { token: string, deviceInfo?: string }
 * @access  Private
 */
router.post('/fcm/token', authMiddleware, fcmController.saveFCMToken);

/**
 * @route   DELETE /api/sos/fcm/token
 * @desc    Xóa FCM token khi user logout
 * @body    { token: string }
 * @access  Private
 */
router.delete('/fcm/token', authMiddleware, fcmController.removeFCMToken);

/**
 * @route   GET /api/sos/fcm/tokens
 * @desc    Lấy danh sách FCM tokens của user (để debug)
 * @access  Private
 */
router.get('/fcm/tokens', authMiddleware, fcmController.getUserTokens);

/**
 * @route   POST /api/sos/fcm/test
 * @desc    Test gửi notification
 * @body    { title?: string, body?: string, data?: object }
 * @access  Private
 */
router.post('/fcm/test', authMiddleware, fcmController.testNotification);

// ============= SOS ROUTES =============

/**
 * @route   POST /api/sos
 * @desc    Tạo SOS notification mới
 * @access  Private (requires auth)
 */
router.post('/', authMiddleware, sosController.createSOS);

/**
 * @route   GET /api/sos
 * @desc    Lấy danh sách SOS notifications của user
 * @query   status (optional): active, acknowledged, resolved, cancelled
 * @query   limit (optional): số lượng kết quả mỗi trang
 * @query   page (optional): trang hiện tại
 * @access  Private
 */
router.get('/', authMiddleware, sosController.getUserSOSNotifications);

/**
 * @route   GET /api/sos/:sosId
 * @desc    Lấy chi tiết một SOS notification
 * @access  Private
 */
router.get('/:sosId', authMiddleware, sosController.getSOSById);

/**
 * @route   PATCH /api/sos/:sosId/status
 * @desc    Cập nhật trạng thái SOS
 * @body    { status: 'active' | 'acknowledged' | 'resolved' | 'cancelled' }
 * @access  Private
 */
router.patch('/:sosId/status', authMiddleware, sosController.updateSOSStatus);

/**
 * @route   DELETE /api/sos/:sosId
 * @desc    Xóa SOS notification (chỉ requester)
 * @access  Private
 */
router.delete('/:sosId', authMiddleware, sosController.deleteSOSNotification);

// ============= SOS CALL ROUTES =============

/**
 * @route   POST /api/sos/call/reject
 * @desc    Từ chối SOS call (có thể gọi từ notification background)
 * @body    { sosId, callId }
 * @access  Private
 */
router.post('/call/reject', authMiddleware, sosController.rejectSOSCall);

module.exports = router;
