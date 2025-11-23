const express = require("express");
const morgan = require("morgan");
const methodOverride = require("method-override");
const app = express();
const cors = require("cors");
const route = require("./routes");
const db = require("./config/db");

// Load biến môi trường

// Kết nối DB
db.connect();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://192.168.0.109:3000",
      "https://black-wave-0366edf00.3.azurestaticapps.net/",
    ],
    credentials: true,
  })
);

// Middleware
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.json({ limit: "50mb" }));
app.use(methodOverride("_method"));
app.use(morgan("combined"));

// Mailer
const mailer = require("./config/mailer/mailer");
app.set("transporter", mailer);
app.use(require("cors")());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
// Khởi tạo routes
route(app);

// Error handler to return JSON for large payloads and generic errors
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res
      .status(413)
      .json({
        success: false,
        message: "Tệp ảnh quá lớn. Vui lòng chụp lại hoặc giảm kích thước ảnh.",
      });
  }
  next(err);
});

// Xuất app để dùng cho test
module.exports = app;
