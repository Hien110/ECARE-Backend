const express = require('express');
const router = express.Router();

const consultationPriceController = require('../app/controllers/consultationPriceController');
const authenticateToken = require('../app/middlewares/authMiddleware');

// All routes require authentication
router.use(authenticateToken);

// GET all consultation prices
router.get('/', consultationPriceController.getAllPrices);

// GET single consultation price by ID
router.get('/:id', consultationPriceController.getPriceById);

// POST create new consultation price
router.post('/', consultationPriceController.createPrice);

// PUT update consultation price
router.put('/:id', consultationPriceController.updatePrice);

// DELETE consultation price
router.delete('/:id', consultationPriceController.deletePrice);

module.exports = router;
