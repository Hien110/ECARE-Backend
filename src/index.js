// index.js
require('dotenv').config();
const { createServer } = require('http');
const app = require('./app');
const socketConfig = require('./config/socket/socketConfig');

const PORT = process.env.PORT || 3000;

// Đo thời gian khởi động server
const startBoot = process.hrtime.bigint();

// Tạo HTTP server
const server = createServer(app);

// Khởi tạo Socket.IO
const io = socketConfig.init(server);

// Lưu instance vào app để controller dùng
app.set('io', io);
app.set('socketConfig', socketConfig);

// Lắng nghe
server.listen(PORT, '0.0.0.0', () => {
  const endBoot = process.hrtime.bigint();
  const bootMs = Number(endBoot - startBoot) / 1e6;

  console.log(`🚀 Server đang chạy trên cổng ${PORT}`);
  console.log(`📡 Socket.IO server ready`);
  console.log(`⏱ Thời gian khởi động server: ${bootMs.toFixed(1)} ms`);
});
