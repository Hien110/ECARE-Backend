const jwt = require("jsonwebtoken");
const SECRET_KEY = process.env.JWT_SECRET_KEY;

const authenticateToken = (req, res, next) => {
  console.log('=== AUTH MIDDLEWARE DEBUG ===');
  console.log('Authorization header:', req.headers['authorization']);
  
  const authHeader = req.headers['authorization'];

  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  console.log('Extracted token:', token ? 'EXISTS' : 'MISSING');

  if (!token) {
    console.log('ERROR: No token provided');
    return res.status(401).json({ message: "Chưa đăng nhập hoặc token không hợp lệ" });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    console.log('Token decoded successfully:', decoded);
    req.user = decoded; // Lưu thông tin user vào req để dùng sau
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);
    return res.status(403).json({ message: "Token không hợp lệ hoặc đã hết hạn: " + err.message });
  }
};

module.exports = authenticateToken;
