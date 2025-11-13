// utils/smsClient.js
const axios = require("axios");

async function sendSMS({ to, message }) {
  try {
    const res = await axios.post(
      "https://www.traccar.org/sms",
      { to, message },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: process.env.TRACCAR_TOKEN, // đặt trong .env
        },
      }
    );
    return { success: true, data: res.data };
  } catch (err) {
    const detail = err.response?.data || err.message;
    return { success: false, message: typeof detail === "string" ? detail : JSON.stringify(detail) };
  }
}

module.exports = { sendSMS };
