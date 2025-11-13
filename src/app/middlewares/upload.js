const multer = require('multer');

const storage = multer.memoryStorage(); 
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    
    if (/^image\/(jpe?g|png|webp|gif|bmp|heic)$/i.test(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('Chỉ cho phép upload file ảnh'));
  },
});

module.exports = { upload };