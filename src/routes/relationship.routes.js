const express = require("express");

const router = express.Router();

const RelationshipController = require("../app/controllers/relationshipController");
const authenticateToken = require("../app/middlewares/authMiddleware");


router.use(authenticateToken);
router.post("/create", RelationshipController.createRelationship);
router.get("/requests", RelationshipController.getRequestRelationshipsById);
router.put("/request/:relationshipId/accept", RelationshipController.acceptRelationship);
router.put("/request/:relationshipId/reject", RelationshipController.rejectRelationship);
router.get("/accepted", RelationshipController.getAcceptRelationshipByUserId);
router.put("/:relationshipId/cancel", RelationshipController.cancelRelationship);
router.get("/", RelationshipController.getAllRelationships);
router.get("/accepted-family", RelationshipController.getAcceptRelationshipByFamilyId);
// Lấy tất cả mối quan hệ theo familyId (param)
router.get("/family/:familyId", RelationshipController.getAllRelationshipsByFamilyId);
router.post("/connect-supporter", RelationshipController.connectSupporterToElderly);
router.post("/disconnect-supporter", RelationshipController.cancelByElderlyAndFamily);

module.exports = router;
