const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const mongoose = require("mongoose");
const User = require("../../app/models/User"); // Đường dẫn đến User model của bạn

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Tìm hoặc tạo user mới dựa trên Google ID hoặc email
        let user = await User.findOne({ email: profile.emails[0].value });
        if (user) {
          // Cập nhật thông tin nếu người dùng đã tồn tại
          user.fullName = user.fullName || profile.displayName;
          user.avatar = user.avatar || profile.photos[0].value;
          user.status = "active"; // Cập nhật trạng thái khi đăng nhập thành công
          await user.save();
        } else {
          // Tạo người dùng mới
          user = new User({
            email: profile.emails[0].value,
            fullName: profile.displayName || "Người dùng mới",
            avatar: profile.photos[0].value || "/img/dafaultAvatar.jpg",
            password: "google-oauth-" + profile.id, // Password giả để thỏa mãn schema
            status: "active",
          });
          await user.save();
        }
        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

// Serialize và deserialize user
passport.serializeUser((user, done) => {
  done(null, user._id); // Lưu _id của user vào session
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;
