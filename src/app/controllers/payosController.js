// src/app/controllers/payosController.js
const { PayOS } = require("@payos/node");
require("dotenv").config();

/**
 * Khởi tạo PayOS client
 */
const payos = new PayOS({
  clientId: process.env.CLIENT_ID,
  apiKey: process.env.API_KEY,
  checksumKey: process.env.CHECKSUM_KEY,
});

class PayosController {
  /**
   * POST /api/payos/create
   * Body: { orderCode, amount, description, returnUrl, cancelUrl }
   */
  async createPayment(req, res) {
    try {
      const { orderCode, amount, description, returnUrl, cancelUrl } = req.body || {};
      console.log(orderCode, amount, description, returnUrl, cancelUrl);
      console.log("Creating payment with PayOS...");
      // Validate input tối thiểu
      if (
        orderCode === undefined ||
        amount === undefined ||
        !description ||
        !returnUrl ||
        !cancelUrl
      ) {
        return res.status(400).json({
          message: "Missing required fields",
          required: ["orderCode", "amount", "description", "returnUrl", "cancelUrl"],
        });
      }

      // Ép kiểu an toàn
      const normalizedOrderCode =
        typeof orderCode === "string" ? Number(orderCode) : orderCode;
      const normalizedAmount =
        typeof amount === "string" ? Number(amount) : amount;

      if (!Number.isFinite(normalizedOrderCode) || !Number.isFinite(normalizedAmount)) {
        return res.status(400).json({
          message: "orderCode and amount must be numbers",
        });
      }

      // Tạo link thanh toán
      const payment = await payos.paymentRequests.create({
        orderCode: normalizedOrderCode, // số nguyên
        amount: normalizedAmount,       // VND
        description,
        returnUrl,
        cancelUrl,
      });

      // Một số field phổ biến từ PayOS:
      // id, status, checkoutUrl, qrCode, amount, orderCode, ...
      return res.status(200).json({
        message: "Payment created successfully",
        paymentLinkId: payment.id,
        orderCode: payment.orderCode,
        status: payment.status,
        amount: payment.amount,
        paymentUrl: payment.checkoutUrl,
        qrCode: payment.qrCode,
      });
    } catch (error) {
      console.error("Error creating payment:", error);
      return res.status(500).json({
        message: "Failed to create payment",
        error: error?.message || "Unknown error",
      });
    }
  }

  /**
   * POST /api/payos/verify
   * Body: { orderCode } hoặc { paymentLinkId }
   * - Có thể truyền orderCode (số) hoặc id của payment link
   */
  async verifyPayment(req, res) {
    try {
      const { orderCode, paymentLinkId } = req.body || {};

      if (orderCode === undefined && !paymentLinkId) {
        return res.status(400).json({
          message: "Missing identifier",
          required: ["orderCode"] ,
          optional: ["paymentLinkId"],
        });
      }

      const identifier =
        paymentLinkId ??
        (typeof orderCode === "string" ? Number(orderCode) : orderCode);

      if (identifier === undefined || (typeof identifier === "number" && !Number.isFinite(identifier))) {
        return res.status(400).json({
          message: "Invalid identifier",
        });
      }

      // Lấy thông tin link thanh toán
      const info = await payos.paymentRequests.get(identifier);

      // Các trạng thái thường gặp: PENDING, PAID, CANCELED, EXPIRED,...
      if (info.status === "PAID") {
        return res.status(200).json({
          message: "Payment verified successfully",
          status: info.status,
          orderCode: info.orderCode,
          amount: info.amount,
        });
      }

      return res.status(400).json({
        message: "Payment not completed",
        status: info.status,
        orderCode: info.orderCode,
        amount: info.amount,
      });
    } catch (error) {
      console.error("Error verifying payment:", error);
      return res.status(500).json({
        message: "Failed to verify payment",
        error: error?.message || "Unknown error",
      });
    }
  }
}

module.exports = new PayosController();
