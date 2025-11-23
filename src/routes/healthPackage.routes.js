const express = require('express');
const router = express.Router();
const authenticateToken = require("../app/middlewares/authMiddleware");
const healthPackageController = require("../app/controllers/healthPackageController")
// HealthPackage CRUD routes
router.use(authenticateToken);

router.post("/health-packages", healthPackageController.createHealthPackage);
router.get("/", healthPackageController.listHealthPackage);
router.get("/:id", healthPackageController.detailHealthPackage);
router.put("/update-package/:id", healthPackageController.updateHealthPackage);
router.delete("/delete-packages/:id", healthPackageController.removeHealthPackage);

module.exports = router;