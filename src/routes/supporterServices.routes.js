const Express = require('express');
const router = Express.Router();
const supporterServicesController = require('../app/controllers/supporterServicesController');
const authenticateToken = require('../app/middlewares/authMiddleware');
const { authorize, checkUserStatus } = require('../app/middlewares/authorize');
// router.use(authenticateToken);
// Tạo dịch vụ hỗ trợ mới

router.use(authenticateToken);

// Lấy danh sách tất cả dịch vụ hỗ trợ
router.get('/', supporterServicesController.getAllServices);

// Lấy dịch vụ hỗ trợ theo id
router.get('/:id', supporterServicesController.getServiceById);

router.use(authorize('admin'));
// router.use(checkUserStatus);

router.post('/', supporterServicesController.createService);


// Cập nhật dịch vụ hỗ trợ theo id
router.put('/:id', supporterServicesController.updateServiceById);

// Xoá dịch vụ hỗ trợ theo id
router.delete('/:id', supporterServicesController.deleteServiceById);

module.exports = router;