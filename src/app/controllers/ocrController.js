const path = require("path");
const fs = require("fs");
const os = require("os");
const multer = require("multer");
const { callViettelIdOcr, normalizeViettelId } = require("../../utils/viettelOcr");

const upload = multer({ dest: path.join(os.tmpdir(), "ecare-ocr") });

const ocrController = {
  middleware: upload.fields([
    { name: "frontImage", maxCount: 1 },
    { name: "backImage", maxCount: 1 },
  ]),

  viettelIdCard: async (req, res) => {
    try {
      const front = req.files?.frontImage?.[0];
      const back = req.files?.backImage?.[0];

      if (!front || !back) {
        return res.status(400).json({ message: "Thiếu ảnh mặt trước hoặc mặt sau CCCD" });
      }

      // URL đúng theo docs: /ocr/id_card
      const endpoint = "https://viettelai.vn/ocr/id_card";
      const token = process.env.VIETTEL_OCR_TOKEN;

      const { success, data, code, detail } = await callViettelIdOcr({
        frontFile: front,   // truyền cả file object
        backFile: back,
        endpoint,
        token,
      });

      // Cleanup temp files
      [front?.path, back?.path].filter(Boolean).forEach((p) => {
        try { fs.unlinkSync(p); } catch (_) {}
      });

      if (!success) {
        const reason = code === 401 ? "Unauthorized token"
          : code === 403 ? "Forbidden"
          : code === 429 ? "Rate limited"
          : code === 400 ? "Bad request"
          : "Upstream error";

        return res.status(502).json({
          message: `OCR thất bại: ${reason}`,
          code,
          detail,
        });
      }

      const normalized = normalizeViettelId(data);
      return res.status(200).json({ message: "OCR thành công", ocr: normalized });
    } catch (e) {
      console.error("viettelIdCard error:", e);
      return res.status(500).json({ message: "Đã xảy ra lỗi" });
    }
  },
};

module.exports = ocrController;