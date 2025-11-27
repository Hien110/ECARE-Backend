const express = require("express");
const router = express.Router();

const AiController = require("../app/controllers/aiController");
const authenticateToken = require("../app/middlewares/authMiddleware");
router.post('/tts', AiController.textToSpeech);
router.use(authenticateToken);
router.post("/chat", AiController.chat);
router.get("/history", AiController.history);
router.get("/sessions", AiController.listSessions);
router.post("/sessions", AiController.createSession);
router.delete('/sessions', AiController.deleteSession);




module.exports = router;
