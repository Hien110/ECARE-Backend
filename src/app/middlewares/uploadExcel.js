// middlewares/uploadExcel.js
const multer = require("multer");
const path = require("path");

// Cấu hình nơi lưu file tạm
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // thư mục tạm
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname); // lấy đuôi file
    cb(null, Date.now() + ext); // đặt tên file: timestamp + ext
  }
});

// Bộ lọc chỉ cho phép Excel
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "application/vnd.ms-excel" // .xls
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Chỉ cho phép file Excel (.xls, .xlsx)"), false);
  }
};

const uploadExcel = multer({ storage, fileFilter });

module.exports = uploadExcel;
