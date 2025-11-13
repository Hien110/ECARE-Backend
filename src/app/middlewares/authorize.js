// middleware/authorize.js
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Không có quyền truy cập" });
    }
    next();
  };
};

// kiểm tra trạng thái người dùng
const checkUserStatus = (req, res, next) => {
  if (req.user.isActive !== "active") {
    return res.status(403).json({ message: "Tài khoản chưa được kích hoạt" });
  }
  next();
};
    
module.exports = { authorize, checkUserStatus };
