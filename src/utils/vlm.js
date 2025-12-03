// utils/vlm.js
const axios = require("axios");
const { getValidImageKey, getValidTextKey } = require("./apiKeyPool");

/* ================== Regex & helpers cơ bản ================== */

const RE_CCCD_TIGHT = /\b\d{12}\b/;
const RE_CMND_TIGHT = /\b\d{9}\b/;
const RE_CCCD_LOOSE = /(?:\d\s*){12}/;
const RE_DATE_ANY =
  /\b(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})\b|\b(\d{4})[\/\-.](\d{2})[\/\-.](\d{2})\b/;

const LABEL_WORDS = [
  "Số định danh cá nhân",
  "So dinh danh ca nhan",
  "Số định danh",
  "So dinh danh",
  "ID number",
  "ID No",
  "ID no.",
  "ID No.",
  "Identification number",
  "Personal identification number",
  "Họ tên",
  "Ho ten",
  "Họ và tên",
  "HO TEN",
  "Full name",
  "Name",
  "Ngày sinh",
  "Ngay sinh",
  "DOB",
  "Date of Birth",
  "Nơi cư trú",
  "Thường trú",
  "Thuong tru",
  "Địa chỉ",
  "Dia chi",
  "Address",
  "Place of residence",
  "Place of origin",
  "Native place",
  "Giới tính",
  "Gioi tinh",
  "Sex",
  "Gender",
  "Ngày cấp",
  "Ngay cap",
  "Date of issue",
  "Issue date",
  "Quốc tịch",
  "Nationality",
];

const HEADER_PATTERNS = [
  /cộng\s*hoà|cong\s*hoa/i,
  /xã\s*hội\s*chủ\s*nghĩa|xa\s*hoi\s*chu\s*nghia/i,
  /việt\s*nam|viet\s*nam/i,
  /độc\s*lập|doc\s*lap/i,
  /tự\s*do|tu\s*do/i,
  /hạnh\s*phúc|hanh\s*phuc/i,
  /căn\s*cước\s*công\s*dân|can\s*cuoc\s*cong\s*dan/i,
];

// Chuẩn hoá “12 chữ số có dấu cách” thành dãy 12 số liền
function joinDigits(s = "") {
  const digits = String(s).match(/\d/g);
  return digits ? digits.join("") : "";
}

// Cắt nhãn ở đầu: “Họ tên: …”, “Địa chỉ - …”
function stripLeadingLabel(s = "") {
  let out = String(s || "");
  LABEL_WORDS.forEach((kw) => {
    const re = new RegExp(`^\\s*${kw}\\s*[:\\-–—]\\s*`, "i");
    out = out.replace(re, "");
  });
  out = out.replace(
    /^\s*(Họ.*tên|Full\s*name|Name|Địa\s*chỉ|Address|Nơi\s*cư\s*trú|Thường\s*trú|DOB|Date.*Birth|Sex|Gender)\s*[:\-–—]\s*/i,
    ""
  );
  return out.trim();
}

// Chuẩn hoá tên: bỏ ký tự rác, tránh toàn số, tránh tiêu ngữ, giữ Title Case đơn giản
function normalizeName(raw) {
  if (!raw) return null;
  let s = stripLeadingLabel(raw)
    .replace(/[^A-Za-zÀ-ỹ\s']/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!s) return null;
  if (/^\d+$/.test(s)) return null;
  if (HEADER_PATTERNS.some((re) => re.test(s))) return null;

  s = s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ")
    .trim();
  if (s.length < 2) return null;
  return s;
}

// Chuẩn hoá địa chỉ: bỏ nhãn, gom khoảng trắng
function normalizeAddress(raw) {
  if (!raw) return null;
  const s = stripLeadingLabel(raw)
    .replace(/\s{2,}/g, " ")
    .trim();
  return s || null;
}

function normalizeDate(raw) {
  if (!raw) return null;
  const m = String(raw).match(RE_DATE_ANY);
  if (!m) return null;
  // dd/mm/yyyy
  if (m[1] && m[2] && m[3]) {
    return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`;
  }
  // yyyy/mm/dd
  if (m[4] && m[5] && m[6]) {
    return `${m[6].padStart(2, "0")}/${m[5].padStart(2, "0")}/${m[4]}`;
  }
  return null;
}

function normalizeGender(raw) {
  const s = String(raw || "").toLowerCase();
  if (/(^|\b)(male|nam|m)(\b|$)/.test(s)) return "male";
  if (/(^|\b)(female|nữ|nu|f)(\b|$)/.test(s)) return "female";
  return "other";
}

// Chuẩn hoá số định danh (ưu tiên 12 số)
function normalizeIdentity(raw) {
  if (!raw) return null;
  const justDigits = joinDigits(raw);

  if (justDigits.length === 12) return justDigits;
  if (justDigits.length === 9) return justDigits;

  const loose = String(raw).match(RE_CCCD_LOOSE)?.[0];
  if (loose) {
    const joined = joinDigits(loose);
    if (joined.length === 12) return joined;
  }

  const tight12 = String(raw).match(RE_CCCD_TIGHT)?.[0];
  if (tight12) return tight12;

  const tight9 = String(raw).match(RE_CMND_TIGHT)?.[0];
  if (tight9) return tight9;

  return null;
}

/* ================== Hậu xử lý tiếng Việt (sửa lỗi OCR) ================== */

// Bản đồ bỏ dấu để so sánh
const VN_ASCII_MAP = {
  à: "a",
  á: "a",
  ả: "a",
  ã: "a",
  ạ: "a",
  â: "a",
  ầ: "a",
  ấ: "a",
  ẩ: "a",
  ẫ: "a",
  ậ: "a",
  ă: "a",
  ằ: "a",
  ắ: "a",
  ẳ: "a",
  ẵ: "a",
  ặ: "a",
  è: "e",
  é: "e",
  ẻ: "e",
  ẽ: "e",
  ẹ: "e",
  ê: "e",
  ề: "e",
  ế: "e",
  ể: "e",
  ễ: "e",
  ệ: "e",
  ì: "i",
  í: "i",
  ỉ: "i",
  ĩ: "i",
  ị: "i",
  ò: "o",
  ó: "o",
  ỏ: "o",
  õ: "o",
  ọ: "o",
  ô: "o",
  ồ: "o",
  ố: "o",
  Ổ: "o",
  ỗ: "o",
  ộ: "o",
  ơ: "o",
  ờ: "o",
  ớ: "o",
  ở: "o",
  ỡ: "o",
  ợ: "o",
  ù: "u",
  ú: "u",
  ủ: "u",
  ũ: "u",
  ụ: "u",
  ư: "u",
  ừ: "u",
  ứ: "u",
  ử: "u",
  ữ: "u",
  ự: "u",
  ỳ: "y",
  ý: "y",
  ỷ: "y",
  ỹ: "y",
  ỵ: "y",
  đ: "d",
  À: "A",
  Á: "A",
  Ả: "A",
  Ã: "A",
  Ạ: "A",
  Â: "A",
  Ầ: "A",
  Ấ: "A",
  Ẩ: "A",
  Ẫ: "A",
  Ậ: "A",
  Ă: "A",
  Ằ: "A",
  Ắ: "A",
  Ẳ: "A",
  Ẵ: "A",
  Ặ: "A",
  È: "E",
  É: "E",
  Ẻ: "E",
  Ẽ: "E",
  Ẹ: "E",
  Ê: "E",
  Ề: "E",
  Ế: "E",
  Ể: "E",
  Ễ: "E",
  Ệ: "E",
  Ì: "I",
  Í: "I",
  Ỉ: "I",
  Ĩ: "I",
  Ị: "I",
  Ò: "O",
  Ó: "O",
  Ỏ: "O",
  Õ: "O",
  Ọ: "O",
  Ô: "O",
  Ồ: "O",
  Ố: "O",
  Ổ: "O",
  Ỗ: "O",
  Ộ: "O",
  Ơ: "O",
  Ờ: "O",
  Ớ: "O",
  Ở: "O",
  Ỡ: "O",
  Ợ: "O",
  Ù: "U",
  Ú: "U",
  Ủ: "U",
  Ũ: "U",
  Ụ: "U",
  Ư: "U",
  Ừ: "U",
  Ứ: "U",
  Ử: "U",
  Ữ: "U",
  Ự: "U",
  Ỳ: "Y",
  Ý: "Y",
  Ỷ: "Y",
  Ỹ: "Y",
  Ỵ: "Y",
  Đ: "D",
};
const toAsciiLower = (s = "") =>
  s.replace(/./g, (ch) => VN_ASCII_MAP[ch] ?? ch).toLowerCase();

// Levenshtein (đủ cho token ngắn)
function levenshtein(a = "", b = "") {
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

// Từ điển tên riêng (key: không dấu; value: dạng chuẩn có dấu)
const NAME_CANON = {
  hien: "Hiển",
  // Thêm tại đây khi gặp nhiều case sai OCR
};

// Sửa theo ngữ cảnh địa chỉ (ví dụ "Làng Bò" -> "Làng Bồ")
const ADDRESS_CONTEXT_RULES = [
  {
    contextBefore: /\b(làng|lang|thôn|thon|xóm|xom)\b/i,
    base: "bo",
    fixed: "Bồ",
    maxDistance: 2,
  },
];

const ADDRESS_CANON = new Set([
  "Làng",
  "Thôn",
  "Xóm",
  "Bản",
  "Ấp",
  "Khu",
  "Khu phố",
  "Phường",
  "Xã",
  "Quận",
  "Huyện",
  "Thị trấn",
  "Tổ",
  "Đội",
  "TDP",
  "Khối",
]);

function fixNameByCanon(name) {
  if (!name) return name;
  const parts = name.trim().split(/\s+/);
  const fixed = parts.map((tok) => {
    const base = toAsciiLower(tok);
    const canon = NAME_CANON[base];
    if (!canon) return tok;
    const dist = levenshtein(base, toAsciiLower(canon));
    return dist <= 2 ? canon : tok;
  });
  return fixed.join(" ");
}

function fixAddressSmart(addr) {
  if (!addr) return addr;
  let s = addr;

  // 1) Sửa theo ngữ cảnh
  ADDRESS_CONTEXT_RULES.forEach((rule) => {
    const re = new RegExp(
      `\\b(${rule.contextBefore.source.replace(
        /^\\b|\\b$/g,
        ""
      )})\\s+([A-Za-zÀ-ỹĐđ]+)`,
      "gi"
    );
    s = s.replace(re, (m, ctx, token) => {
      const baseTok = toAsciiLower(token);
      if (baseTok !== rule.base) {
        const dist = levenshtein(baseTok, rule.base);
        if (dist > rule.maxDistance) return m;
      }
      return `${ctx} ${rule.fixed}`;
    });
  });

  // 2) Chuẩn hoá hoa-chữ cho nhãn địa chỉ
  s = s
    .split(/\s+/)
    .map((tok) => {
      if (ADDRESS_CANON.has(tok)) return tok;
      const base = toAsciiLower(tok);
      const found = [...ADDRESS_CANON].find(
        (std) => toAsciiLower(std) === base
      );
      return found || tok;
    })
    .join(" ");

  return s;
}

/* ================== Prompt & API call (Gemini 2.0 Flash) ================== */

function stripDataUrl(b64 = "") {
  const m = /^data:(.+?);base64,(.*)$/i.exec(b64 || "");
  return m ? m[2] : b64 || "";
}

/**
 * Prompt nghiêm ngặt để tránh gộp/nhân đôi địa chỉ 2 dòng:
 * - YÊU CẦU điền addressTopLine và addressBottomLine đúng theo NGẮT DÒNG thực tế.
 * - KHÔNG lặp lại top vào bottom hoặc ngược lại.
 * - "address" là phép nối của 2 dòng (nếu đủ), không tự suy diễn thêm.
 */
function buildCccdSystemPrompt() {
  return `
Bạn là hệ thống trích xuất thông tin từ ảnh Căn cước công dân (Việt Nam).
Trả về CHỈ MỘT JSON:
{
  "identityCard": "<12 số CCCD hoặc 9 số CMND>",
  "fullName": "<Họ và tên>",
  "dateOfBirth": "dd/mm/yyyy | null",
  "gender": "male|female|other",
  "addressTopLine": "<dòng trên hoặc null>",
  "addressBottomLine": "<dòng dưới hoặc null>",
  "address": "<ghép 2 dòng hoặc null>"
}

Quy tắc:
- identityCard: chỉ số; không khoảng trắng/dấu; ưu tiên 12 số; nếu không có, chấp nhận 9 số.
- fullName: chuẩn hóa viết hoa chữ cái đầu nếu cần.
- dateOfBirth: dd/mm/yyyy nếu chắc chắn, ngược lại null.
- gender: male = Nam, female = Nữ, nếu không chắc thì other.
- ĐỊA CHỈ:
  * CHỈ lấy "Nơi cư trú" / "Nơi thường trú" / "Address" / "Place of residence".
  * BỎ QUA hoàn toàn "Quê quán" / "Place of origin" / "Native place" / "Hometown".
  * Nếu địa chỉ in 2 dòng: 
      - addressTopLine = duy nhất phần của dòng TRÊN (KHÔNG kèm dòng dưới).
      - addressBottomLine = duy nhất phần của dòng DƯỚI (KHÔNG lặp lại dòng trên).
  * Nếu chỉ 1 dòng: điền vào addressTopLine và đặt addressBottomLine = null.
  * Nếu addressTopLine có chứa dấu phẩy (",") HOẶC dài hơn 15 ký tự → coi như KHÔNG HỢP LỆ và để null.
  * address = nối addressTopLine + ", " + addressBottomLine (nếu đủ), hoặc top, hoặc null.
- Không trả lời giải thích; chỉ trả về JSON hợp lệ duy nhất.
`.trim();
}

/* ======= Xử lý chống “gấp đôi” địa chỉ (top/bottom trùng lặp hoặc lồng nhau) ======= */

function cleanAddressLine(raw) {
  if (!raw) return null;
  let s = normalizeAddress(raw);
  if (!s) return null;
  // bỏ dấu phẩy/chấm/dấu cách ở cuối
  s = s.replace(/[,\.;:\-\s]+$/g, "").replace(/^\s+|\s+$/g, "");
  return s || null;
}

/**
 * Loại bỏ trùng lặp giữa top/bottom, chống trường hợp model trả:
 *   - top = "Hòa Phong, Tây Hòa, Phú Yên"
 *   - bottom = "Phước Thành, Đồng, Hòa Phong, Tây Hòa, Phú Yên" (chứa cả top)
 */
function dedupeAddressLines(topRaw, bottomRaw) {
  let top = cleanAddressLine(topRaw);
  let bottom = cleanAddressLine(bottomRaw);
  if (!top && !bottom) return { top: null, bottom: null };

  // Nếu 2 dòng giống nhau → giữ top, bỏ bottom
  if (top && bottom && toAsciiLower(top) === toAsciiLower(bottom)) {
    bottom = null;
  }

  // Nếu bottom bắt đầu bằng top → cắt phần trùng ở đầu bottom
  if (top && bottom && toAsciiLower(bottom).startsWith(toAsciiLower(top))) {
    const rest = bottom.slice(top.length).replace(/^[,\s]+/, "");
    bottom = rest || null;
  }

  // Nếu top chứa trọn bottom (hoặc ngược lại) → giữ dòng dài hơn làm address, bỏ dòng kia
  if (top && bottom) {
    if (toAsciiLower(top).includes(toAsciiLower(bottom))) {
      bottom = null;
    } else if (toAsciiLower(bottom).includes(toAsciiLower(top))) {
      // Nếu bottom đã “bao” top, mà top không thêm thông tin, chuyển top=null
      top = bottom;
      bottom = null;
    }
  }

  return { top: top || null, bottom: bottom || null };
}
function dropOriginField(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (
    /(quê\s*quán|que\s*quan|place\s*of\s*origin|native\s*place|hometown)/i.test(
      s
    )
  )
    return null;
  const stripped = s
    .replace(
      /^\s*(Quê\s*quán|Que\s*quan|Place\s*of\s*origin|Native\s*place|Hometown)\s*[:\-–—]?\s*/i,
      ""
    )
    .trim();
  if (stripped.length !== s.length) return null;
  return s;
}
// Gộp 2 dòng địa chỉ (nếu có) rồi fix OCR
function composeAddress(topLine, bottomLine, already = null) {
  const a = cleanAddressLine(already);
  let { top, bottom } = dedupeAddressLines(topLine, bottomLine);

  // Nếu model đã cho "address" hợp lệ và không mâu thuẫn thì ưu tiên
  if (a) {
    const merged = [top, bottom].filter(Boolean).join(", ");
    if (!merged) return a;
    if (
      toAsciiLower(a) === toAsciiLower(merged) ||
      toAsciiLower(a).includes(toAsciiLower(merged))
    ) {
      return a;
    }
  }

  const merged = [top, bottom].filter(Boolean).join(", ") || null;
  return merged;
}

/** Hậu xử lý JSON từ model -> chuẩn hoá mạnh tay + vá lỗi OCR */
function strengthenPostProcess(modelJson = {}) {
  let {
    identityCard = null,
    fullName = null,
    dateOfBirth = null,
    gender = "other",
    address = null,
    addressTopLine = null,
    addressBottomLine = null,
  } = modelJson || {};

  // Chuẩn hoá các trường cơ bản
  identityCard = normalizeIdentity(identityCard);
  fullName = normalizeName(fullName);
  dateOfBirth = normalizeDate(dateOfBirth);
  gender = normalizeGender(gender);

  // Bỏ nếu là "quê quán"
  addressTopLine = dropOriginField(addressTopLine);
  addressBottomLine = dropOriginField(addressBottomLine);
  address = dropOriginField(address);

  // 🚨 Điều kiện mới: bỏ qua addressTopLine nếu có dấu phẩy hoặc dài > 15 ký tự
  if (
    addressTopLine &&
    (addressTopLine.includes(",") || addressTopLine.length > 15)
  ) {
    addressTopLine = null;
  }

  // Dedupe hai dòng địa chỉ
  const deduped = dedupeAddressLines(addressTopLine, addressBottomLine);
  addressTopLine = deduped.top;
  addressBottomLine = deduped.bottom;

  // Ghép địa chỉ
  let mergedAddr = composeAddress(addressTopLine, addressBottomLine, address);
  mergedAddr = normalizeAddress(mergedAddr);

  // Vá lỗi OCR
  if (fullName) fullName = fixNameByCanon(fullName);
  if (mergedAddr) mergedAddr = fixAddressSmart(mergedAddr);

  return {
    identityCard,
    fullName,
    dateOfBirth,
    gender,
    addressTopLine: addressTopLine || null,
    addressBottomLine: addressBottomLine || null,
    address: mergedAddr || null,
  };
}

/**
 * Gọi Gemini 2.0 Flash để trích xuất CCCD từ 2 ảnh (front/back, base64 DataURL hoặc raw base64)
 * Lưu ý: dùng endpoint v1beta để hỗ trợ responseMimeType=application/json
 */
async function extractCccdFieldsWithGemini({
  frontImageBase64,
  backImageBase64,
  frontMime = "image/jpeg",
  backMime = "image/jpeg",
}) {
  if (!frontImageBase64 || !backImageBase64) {
    return { success: false, message: "Thiếu ảnh CCCD mặt trước hoặc mặt sau" };
  }

  const frontData = stripDataUrl(frontImageBase64);
  const backData = stripDataUrl(backImageBase64);

  const tryOnce = async (apiKey) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const body = {
      contents: [
        {
          parts: [
            { text: buildCccdSystemPrompt() },
            { inlineData: { mimeType: frontMime, data: frontData } },
            { inlineData: { mimeType: backMime, data: backData } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        topK: 32,
        topP: 0.9,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
      },
    };

    const resp = await axios.post(url, body, { timeout: 30000 });

    const raw =
      resp?.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      resp?.data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ||
      "";

    if (!raw) throw new Error("Không nhận được phản hồi từ Gemini");

    let modelJson;
    if (typeof raw === "string") {
      try {
        modelJson = JSON.parse(raw);
      } catch {
        const m = raw.match(/\{[\s\S]*\}$/);
        if (m) modelJson = JSON.parse(m[0]);
        else throw new Error("Phản hồi không phải JSON hợp lệ");
      }
    } else if (typeof raw === "object" && raw !== null) {
      modelJson = raw;
    } else {
      throw new Error("Định dạng phản hồi không xác định");
    }

    // Hậu xử lý mạnh tay + vá lỗi OCR
    const data = strengthenPostProcess(modelJson);
    return { success: true, data };
  };

  const attempts = [];
  // Thử tối đa 6 lần: 2 image-key + 4 text-key (tuỳ pool)
  for (let i = 0; i < 6; i++) {
    const key = i < 2 ? getValidImageKey() : getValidTextKey();
    if (!key) {
      attempts.push("no_key");
      continue;
    }
    try {
      return await tryOnce(key);
    } catch (err) {
      const code = err?.response?.status;
      const detail = err?.response?.data || err.message;
      attempts.push({ code, detail });
      // Ghi log chi tiết để theo dõi trên server
      console.error('[Gemini OCR] attempt failed', { idx: i, code, detail });
      // 429 quota hoặc 403 bị cấm: xoay key tiếp
      if (code === 429 || code === 403) continue;
      // 401: key không hợp lệ hoặc không bật API
      if (code === 401) break;
      // Lỗi khác: dừng luôn
      break;
    }
  }

  // Phân loại thông điệp rõ ràng hơn theo mã lỗi đã gặp
  const codes = attempts
    .map((a) => (typeof a === 'string' ? null : a.code))
    .filter((c) => c != null);
  const lastCode = codes.length ? codes[codes.length - 1] : null;

  let message = "Gọi Gemini thất bại hoặc hết lượt tất cả API key.";
  if (attempts.includes('no_key')) {
    message = "Không tìm thấy API key hợp lệ trên server.";
  }
  if (lastCode === 401) {
    message = "API key không hợp lệ hoặc dịch vụ Gemini chưa được bật.";
  } else if (lastCode === 403) {
    message = "API key bị hạn chế (domain/app) hoặc bị từ chối truy cập.";
  } else if (lastCode === 429) {
    message = "Hết hạn mức (quota) cho API key hiện tại.";
  }

  return {
    success: false,
    message,
    attempts,
  };
}

module.exports = {
  extractCccdFieldsWithGemini,
  stripDataUrl,
  strengthenPostProcess,
  normalizeIdentity,
  normalizeName,
  normalizeDate,
  normalizeGender,
  normalizeAddress,
  fixNameByCanon,
  fixAddressSmart,
  toAsciiLower,
  levenshtein,
};
