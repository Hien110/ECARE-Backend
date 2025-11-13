// utils/sendOtp.js
const mailer = require("../config/mailer/mailer");

const sendOTP = async (email, otp) => {
 const mailOptions = {
  from: process.env.EMAIL_USER,
  to: email,
  subject: "Xác nhận đăng ký tài khoản - Mã OTP",
  html: `
    <div style="max-width: 600px; margin: auto; font-family: Arial, sans-serif; border: 1px solid #e0e0e0; border-radius: 8px; padding: 30px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h2 style="color: #007bff; margin-bottom: 10px;">Xác nhận tài khoản của bạn</h2>
        <p style="color: #555; font-size: 16px;">Cảm ơn bạn đã đăng ký. Đây là mã OTP để xác nhận:</p>
      </div>
      
      <div style="text-align: center; margin: 20px 0;">
        <span style="display: inline-block; background-color: #f1f1f1; padding: 15px 30px; font-size: 32px; font-weight: bold; color: #333; border-radius: 8px; letter-spacing: 3px;">
          ${otp}
        </span>
      </div>

      <div style="text-align: center; margin-top: 30px;">
        <p style="color: #999; font-size: 14px;">Mã này có hiệu lực trong vòng <strong>10 phút</strong>.</p>
        <p style="color: #999; font-size: 14px;">Nếu bạn không yêu cầu đăng ký, vui lòng bỏ qua email này.</p>
      </div>

      <hr style="margin: 40px 0; border: none; border-top: 1px solid #eee;" />

      <div style="text-align: center; color: #aaa; font-size: 12px;">
        &copy; 2025 MiiHii110. Good luck with your studies!.
      </div>
    </div>
  `,
};



  try {
    await mailer.sendMail(mailOptions);
    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
};

module.exports = sendOTP;
