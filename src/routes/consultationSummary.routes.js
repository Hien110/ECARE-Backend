const express = require('express');
const router = express.Router();

const consultationSummaryController = require('../app/controllers/consultationSummaryController');
const authenticateToken = require('../app/middlewares/authMiddleware');
router.get(
	'/:registrationId/participants',
	consultationSummaryController.getDoctorAndBeneficiary,
);

router.use(authenticateToken);

router.get('/by-elderly/:elderlyId', consultationSummaryController.getSummariesByElderly);

router.post('/:registrationId', consultationSummaryController.upsertByRegistration);

router.get('/:registrationId', consultationSummaryController.getByRegistration);


router.delete('/:registrationId', consultationSummaryController.deleteByRegistration);

module.exports = router;
