const multer = require("multer");
const path = require("path");

const storage = multer.memoryStorage();
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 25);
// Cho phép các kiểu audio phổ biến mặc định nếu không cấu hình ALLOWED_MIME
const DEFAULT_ALLOWED = [
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'audio/3gpp',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
];
const ALLOWED = (process.env.ALLOWED_MIME && process.env.ALLOWED_MIME.trim().length > 0)
  ? process.env.ALLOWED_MIME.split(',')
  : DEFAULT_ALLOWED;

function fileFilter(req, file, cb) {
  if (!ALLOWED.includes(file.mimetype)) {
    return cb(new Error(`Unsupported audio mime type: ${file.mimetype}`), false);
  }
  cb(null, true);
}

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 }
});