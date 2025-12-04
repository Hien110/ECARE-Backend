const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

async function callViettelIdOcr({ frontPath, backPath, endpoint, token }) {
  if (!endpoint) throw new Error("Missing VIETTEL_OCR_ENDPOINT");
  if (!token) throw new Error("Missing VIETTEL_OCR_TOKEN");

  let url = String(endpoint).trim().replace(/^['"]|['"]$/g, "");
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  const form = new FormData();

  if (frontPath) {
    form.append("image_front", fs.createReadStream(frontPath), {
      filename: "front.jpg",      // đảm bảo có .jpg
      contentType: "image/jpeg",
    });
  }

  if (backPath) {
    form.append("image_back", fs.createReadStream(backPath), {
      filename: "back.jpg",       // đảm bảo có .jpg
      contentType: "image/jpeg",
    });
  }

  form.append("token", token);    // token nằm trong form-data

  const headers = {
    ...form.getHeaders(),
    accept: "*/*",
  };

  try {
    console.log("[viettel-ocr] calling:", url);
    const { data } = await axios.post(url, form, {
      headers,
      timeout: 20000,
      maxBodyLength: Infinity,
    });

    const ok = data.code === 1 || data.code === "1";

    return {
      success: ok,
      data,
      code: data.code,
      detail: data,
    };
  } catch (err) {
    const code = err.response?.status;
    const detail = err.response?.data || err.message;
    const networkCode = err.code;
    let reason;
    if (networkCode === "ENOTFOUND") reason = "DNS lookup failed (host not found)";
    else if (networkCode === "ETIMEDOUT") reason = "Connection timed out";
    else if (networkCode === "ECONNREFUSED") reason = "Connection refused by host";

    return { success: false, code, detail, reason, networkCode };
  }
}

function normalizeViettelId(data = {}) {
  let info = data.information || data.data?.information;
  if (typeof info === "string") {
    try {
      info = JSON.parse(info);
    } catch {
      info = {};
    }
  }
  const r = info || {};

  return {
    idNumber: r.id || r.cmnd_id || null,
    fullName: r.name || r.full_name || null,
    dob: r.birthday || r.date_of_birth || null,
    address: r.address || r.hometown || null,
    gender: r.sex || null,
    issueDate: r.issue_date || null,
    expiryDate: r.expiry || null,
    raw: data,
  };
}

module.exports = { callViettelIdOcr, normalizeViettelId };