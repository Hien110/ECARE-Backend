const express = require("express");

const router = express.Router();

const ConversationController = require("../app/controllers/conversationController");
const authenticateToken = require("../app/middlewares/authMiddleware");


router.use(authenticateToken);
router.post("/conversationByParticipants", ConversationController.getConversationByTwoParticipant);
router.get("/:userId", ConversationController.getAllConversationsByUserId);
router.get("/messages/:conversationId", ConversationController.getMessagesByConversationId);
router.post("/message", ConversationController.sendMessage);
// xóa đoạn chat và tin nhắn
router.delete("/delete/:conversationId", ConversationController.deleteConversationAndMessages);

// Video call reject endpoint (để reject từ background khi app killed)
router.post("/video-call/reject", ConversationController.rejectVideoCall);

module.exports = router;
