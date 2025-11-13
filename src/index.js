require('dotenv').config();
const app = require('./app');
const { createServer } = require('http');
const socketConfig = require('./config/socket/socketConfig');

const PORT = process.env.PORT || 3000;

// Tạo HTTP server
const server = createServer(app);

// Khởi tạo Socket.IO
const io = socketConfig.init(server);

// Lưu io instance vào app để sử dụng trong controllers
app.set('io', io);
app.set('socketConfig', socketConfig);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server đang chạy trên cổng ${PORT}`);
  console.log(`📡 Socket.IO server ready`);
});
