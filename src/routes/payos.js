const express = require('express');
const router = express.Router();
const payosController = require('../app/controllers/payosController');

// POST /api/payos/create
router.post('/create', payosController.createPayment);
router.post('/status', payosController.verifyPayment);

module.exports = router;
