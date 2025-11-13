const express = require('express');
const router = express.Router();

const HealthRecordController = require('../app/controllers/healthRecordController');
const authenticateToken = require('../app/middlewares/authMiddleware');

router.use(authenticateToken);

// Elderly creates daily record
router.post('/', HealthRecordController.createRecord);
// Get today's record
router.get('/today', HealthRecordController.getTodayRecord);
// List records (optionally by date range)
router.get('/', HealthRecordController.listRecords);

// Family monitoring endpoints
// Legacy path (kept temporarily for backward compatibility)
router.get('/healthfamily', HealthRecordController.getElderlyHealthData);
// Preferred path used by Mobile client
router.get('/health-monitoring/:elderlyId', HealthRecordController.getElderlyHealthData);

module.exports = router;

