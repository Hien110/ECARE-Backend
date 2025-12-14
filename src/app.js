// app.js
const express = require('express');
const morgan = require('morgan');
const methodOverride = require('method-override');
const cors = require('cors');
const route = require('./routes');
const db = require('./config/db');
const mailer = require('./config/mailer/mailer');

const app = express();

// Kết nối DB
db.connect();

// CORS
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://192.168.0.109:3000',
      'https://black-wave-0366edf00.3.azurestaticapps.net',
      'https://www.ecare.io.vn',
    ],
    credentials: true,
  }),
);

// Body parser (gộp lại 1 lần cho gọn)
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

app.use(methodOverride('_method'));
app.use(morgan('combined'));

// Mailer
app.set('transporter', mailer);

// ⏱ MIDDLEWARE ĐO THỜI GIAN MỖI REQUEST
const SLOW_THRESHOLD_MS = Number(process.env.SLOW_REQ_THRESHOLD_MS || 300); // mặc định 300ms

app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  // Khi response kết thúc thì log thời gian
  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6; // ns -> ms

    const baseLog = `[REQ] ${req.method} ${req.originalUrl} ${res.statusCode} - ${durationMs.toFixed(1)} ms`;

    if (durationMs >= SLOW_THRESHOLD_MS) {
      console.warn(baseLog, '(SLOW)');
    } else {
      console.log(baseLog);
    }
  });

  next();
});

// Khởi tạo routes
route(app);

// Error handler cho payload lớn & lỗi chung
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      success: false,
      message: 'Tệp ảnh quá lớn. Vui lòng chụp lại hoặc giảm kích thước ảnh.',
    });
  }
  console.error('[ERROR MIDDLEWARE]', err);
  return res
    .status(err.status || 500)
    .json({ success: false, message: err.message || 'Lỗi server' });
});

module.exports = app;
