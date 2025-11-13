const router = require('express').Router();
const upload = require('../utils/upload');
const rate = require('../utils/rateLimit');
const transcriptionController = require('../app/controllers/transcriptionController');

router.post("/", rate, upload.single("file"), transcriptionController.create);
router.get("/", transcriptionController.list);
router.get("/:id", transcriptionController.show);

module.exports = router;