const express = require('express');
const router = express.Router();


const authenticateToken = require('../app/middlewares/authMiddleware');
const DeadmanController = require('../app/controllers/deadmanController');

router.use(authenticateToken);
router.get('/status', DeadmanController.status);
router.post('/config', DeadmanController.config);
router.post('/checkin', DeadmanController.checkin);
router.post('/snooze', DeadmanController.snooze);
router.post("/choice", DeadmanController.choiceNotify);

module.exports = router;
