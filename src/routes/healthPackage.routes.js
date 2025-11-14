const express = require('express');
const router = express.Router();
const authenticateToken = require("../app/middlewares/authMiddleware");
const healthPackageController = require("../app/controllers/healthPackageController")
// HealthPackage CRUD routes
router.use(authenticateToken);

router.post("/health-packages", healthPackageController.createHealthPackage);
router.get("/health-packages", healthPackageController.listHealthPackage);
router.get("/health-packages/:id", healthPackageController.detailHealthPackage);
router.put("/health-packages/:id", healthPackageController.updateHealthPackage);
router.delete("/health-packages/:id", healthPackageController.removeHealthPackage);

module.exports = router;