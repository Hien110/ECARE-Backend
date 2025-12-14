// app/middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET_KEY;

const authenticateToken = (req, res, next) => {
  const start = process.hrtime.bigint();

  console.log('=== AUTH MIDDLEWARE DEBUG ===');
  console.log('Authorization header:', req.headers['authorization']);

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  console.log('Extracted token:', token ? 'EXISTS' : 'MISSING');

  if (!token) {
    const end = process.hrtime.bigint();
    const totalMs = Number(end - start) / 1e6;

    console.log(`[AUTH] NO TOKEN - total=${totalMs.toFixed(1)}ms`);
    return res
      .status(401)
      .json({ message: 'Chưa đăng nhập hoặc token không hợp lệ' });
  }

  try {
    const beforeVerify = process.hrtime.bigint();
    const decoded = jwt.verify(token, SECRET_KEY); // sync, CPU-bound
    const afterVerify = process.hrtime.bigint();

    const verifyMs = Number(afterVerify - beforeVerify) / 1e6;

    console.log('Token decoded successfully:', decoded);
    console.log(`[AUTH] verify=${verifyMs.toFixed(1)}ms`);

    req.user = decoded; // Lưu thông tin user vào req để dùng sau

    const end = process.hrtime.bigint();
    const totalMs = Number(end - start) / 1e6;

    console.log(
      `[AUTH] ${req.method} ${req.originalUrl} - total=${totalMs.toFixed(1)}ms`,
    );

    next();
  } catch (err) {
    const end = process.hrtime.bigint();
    const totalMs = Number(end - start) / 1e6;

    console.error('Token verification failed:', err.message);
    console.warn(
      `[AUTH] ERROR ${req.method} ${req.originalUrl} - total=${totalMs.toFixed(
        1,
      )}ms`,
    );
    return res.status(403).json({
      message: 'Token không hợp lệ hoặc đã hết hạn: ' + err.message,
    });
  }
};

module.exports = authenticateToken;
