// utils/ocr.js
// Prefer Google Vision (server-side counterpart to ML Kit Text Recognition) when two images are provided; otherwise fallback to Tesseract.
const Tesseract = require("tesseract.js");
const axios = require("axios");

function dataUrlToBuffer(dataUrl) {
  const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl || "");
  const base64 = match ? match[2] : dataUrl;
  return Buffer.from((base64 || "").replace(/^data:.*;base64,/, ""), "base64");
}

function normalizeDate(str) {
  if (!str) return null;
  const s = str.trim();
  // dd/mm/yyyy or dd-mm-yyyy
  let m = s.match(/\b(\d{2})[\/-](\d{2})[\/-](\d{4})\b/);
  if (m) {
    const [_, d, mo, y] = m;
    return `${y}-${mo}-${d}`;
  }
  // yyyy-mm-dd or yyyy/mm/dd
  m = s.match(/\b(\d{4})[\/-](\d{2})[\/-](\d{2})\b/);
  if (m) {
    const [_, y, mo, d] = m;
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function extractIdentityNumber(text) {
  if (!text) return null;
  // Prefer 12-digit (CCCD mới); fallback to 9-11 digits
  const m12 = text.match(/\b(\d{12})\b/);
  if (m12) return m12[1];
  const m9 = text.match(/\b(\d{9,11})\b/);
  return m9 ? m9[1] : null;
}

function extractGender(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/(\bmale\b|\bnam\b)/.test(t)) return "male";
  if (/(\bfemale\b|\bnữ\b|\bnu\b)/.test(t)) return "female";
  return null;
}

function stripDiacritics(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function isLikelyNoise(line) {
  const l = line || "";
  if (!l) return true;
  // MRZ or machine-like lines often include < or >
  if (/[<>]/.test(l)) return true;
  // If more than half characters are digits, consider noise for address/name
  const digits = (l.match(/\d/g) || []).length;
  return digits > l.replace(/\s/g, "").length * 0.5;
}

function extractName(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const normalized = lines.map(l => ({ raw: l, norm: stripDiacritics(l) }));

  for (let i = 0; i < normalized.length; i++) {
    const { raw, norm } = normalized[i];
    // Accept both same-line and next-line formats
    if (/(ho va ten|full name)/.test(norm)) {
      const sameLine = raw.split(/[:：]/)[1];
      if (sameLine && !/\d/.test(sameLine.trim())) return sameLine.trim();
      const next = normalized[i + 1]?.raw || "";
      if (next && !/\d/.test(next)) return next.trim();
    }
  }

  // Heuristic fallback: pick the longest non-digit, non-noise line
  const candidates = lines.filter(l => !/\d/.test(l) && !isLikelyNoise(l));
  candidates.sort((a, b) => b.length - a.length);
  const chosen = candidates[0] || null;
  if (!chosen) return null;
  return cleanField(chosen);
}

function extractDateOfBirth(text) {
  if (!text) return null;
  const m = text.match(/(\d{2}[\/-]\d{2}[\/-]\d{4}|\d{4}[\/-]\d{2}[\/-]\d{2})/);
  return normalizeDate(m ? m[1] : null);
}

function extractAddress(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const normalized = lines.map(l => ({ raw: l, norm: stripDiacritics(l) }));

  // Pass 1: strictly prefer "Nơi thường trú / Place of residence"
  for (let i = 0; i < normalized.length; i++) {
    const { raw, norm } = normalized[i];
    if (/(^|\b)(noi thuong tru|place of residence)(\b|$)/.test(norm)) {
      const sameLine = raw.split(/[:：]/)[1];
      let value = sameLine && sameLine.trim().length ? sameLine.trim() : (normalized[i + 1]?.raw || "");
      if ((value || "").length < 10 && normalized[i + 2]?.raw) {
        value = `${value} ${normalized[i + 2].raw}`.trim();
      }
      value = cleanField(value);
      if (value && !isLikelyNoise(value)) return value;
    }
  }

  // Pass 2: generic address labels (avoid picking "Quê quán")
  for (let i = 0; i < normalized.length; i++) {
    const { raw, norm } = normalized[i];
    if (/(^|\b)(dia chi|address)(\b|$)/.test(norm)) {
      const sameLine = raw.split(/[:：]/)[1];
      let value = sameLine && sameLine.trim().length ? sameLine.trim() : (normalized[i + 1]?.raw || "");
      if ((value || "").length < 10 && normalized[i + 2]?.raw) {
        value = `${value} ${normalized[i + 2].raw}`.trim();
      }
      value = cleanField(value);
      if (value && !isLikelyNoise(value)) return value;
    }
  }
  // Fallback: choose the longest reasonable line
  const candidates = lines
    .filter(l => !isLikelyNoise(l))
    .filter(l => /[a-zA-ZÀ-ỹ]/.test(l));
  candidates.sort((a, b) => b.length - a.length);
  const chosen = candidates.find(l => /(Thành phố|Tỉnh|Huyện|Quận|Phường|Xã|,)/.test(l)) || candidates[0];
  return chosen ? cleanField(chosen) : null;
}

function cleanField(value) {
  return (value || "")
    .replace(/["'`“”]/g, "")
    .replace(/\s*[:：.;]+\s*$/g, "")
    .replace(/^[:：.;\s]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function runOCROnBase64(dataUrl, lang = "eng") {
  const image = dataUrlToBuffer(dataUrl);
  const { data } = await Tesseract.recognize(image, lang);
  return data.text || "";
}

async function extractWithGoogleVision(frontDataUrl, backDataUrl) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) return null;
  const toBase64 = (d) => {
    const match = /^data:(.*?);base64,(.*)$/.exec(d || "");
    return match ? match[2] : (d || "").replace(/^data:.*;base64,/, "");
  };
  const requests = [];
  if (frontDataUrl) {
    requests.push({ image: { content: toBase64(frontDataUrl) }, features: [{ type: "TEXT_DETECTION" }] });
  }
  if (backDataUrl) {
    requests.push({ image: { content: toBase64(backDataUrl) }, features: [{ type: "TEXT_DETECTION" }] });
  }
  if (!requests.length) return null;
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
  const resp = await axios.post(url, { requests }, { headers: { "Content-Type": "application/json" } });
  const responses = resp.data?.responses || [];
  const texts = responses.map(r => r.fullTextAnnotation?.text || "").filter(Boolean);
  if (!texts.length) return null;
  const combined = texts.join("\n");
  return {
    identityCard: extractIdentityNumber(combined),
    fullName: extractName(combined),
    dateOfBirth: extractDateOfBirth(combined),
    gender: extractGender(combined) || "other",
    address: extractAddress(combined) || null,
  };
}

/**
 * Extract identity data either from two CCCD images (front/back) or fallback to DB by identityCard.
 * @param {Object} params
 * @param {string=} params.frontImageBase64
 * @param {string=} params.backImageBase64
 * @param {string=} params.identityCard
 */
async function extractIdentityData({ frontImageBase64, backImageBase64, identityCard }) {
  // If both images provided, try Google Vision first, then fallback to Tesseract
  if (frontImageBase64 && backImageBase64) {
    if (typeof frontImageBase64 !== "string" || typeof backImageBase64 !== "string") {
      throw new Error("Invalid image data");
    }
    // Try Google Vision
    try {
      const g = await extractWithGoogleVision(frontImageBase64, backImageBase64);
      if (g && (g.fullName || g.identityCard || g.dateOfBirth || g.address)) {
        return g;
      }
    } catch (_) {}

    // Fallback Tesseract: Try Vietnamese first; if not available, fallback to English
    let frontText = "";
    let backText = "";
    try {
      frontText = await runOCROnBase64(frontImageBase64, "vie");
      backText = await runOCROnBase64(backImageBase64, "vie");
    } catch (_) {
      frontText = await runOCROnBase64(frontImageBase64, "eng");
      backText = await runOCROnBase64(backImageBase64, "eng");
    }

    const combined = `${frontText}\n${backText}`;
    const extracted = {
      identityCard: extractIdentityNumber(combined),
      fullName: extractName(frontText) || extractName(backText),
      dateOfBirth: extractDateOfBirth(combined),
      gender: extractGender(combined) || "other",
      address: extractAddress(backText) || extractAddress(frontText) || null,
    };

    return extracted;
  }

  // Fallback without DB: if only identityCard is provided, return minimal data
  if (identityCard) {
    return {
      identityCard,
      fullName: null,
      dateOfBirth: null,
      gender: "other",
      address: null,
    };
  }

  throw new Error("Thiếu dữ liệu đầu vào cho OCR/tra cứu");
}

module.exports = { extractIdentityData };



