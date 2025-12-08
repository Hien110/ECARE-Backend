const Express = require('express');
const router = Express.Router();
const supporterServicesController = require('../app/controllers/supporterServicesController');
const authenticateToken = require('../app/middlewares/authMiddleware');
const { authorize } = require('../app/middlewares/authorize');

// Middleware: authenticate
router.use(authenticateToken);

// Public routes (authenticated users can GET)
router.get('/', supporterServicesController.getAllServices);
router.get('/:id', supporterServicesController.getServiceById);

// Admin-only routes (POST, PUT, DELETE)
router.use(authorize('admin'));
router.post('/', supporterServicesController.createService);
router.put('/:id', supporterServicesController.updateServiceById);
router.delete('/:id', supporterServicesController.deleteServiceById);

module.exports = router;