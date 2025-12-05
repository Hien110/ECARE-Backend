const MAX_PER_DAY = 20;

const TZ_OFFSET_MINUTES = parseInt(process.env.TZ_OFFSET_MINUTES || "420", 10);

function localDayKey(d = new Date()) {
  const localMs = d.getTime() + TZ_OFFSET_MINUTES * 60_000;
  return new Date(localMs).toISOString().slice(0, 10);
}

function makeEntry(key) {
  return { key, count: 0, day: localDayKey() };
}

const textKeys = [
  process.env.GEMINI_KEY_1,
  process.env.GEMINI_KEY_2,
  process.env.GEMINI_KEY_3,
  process.env.GEMINI_KEY_4,
]
  .filter(Boolean)
  .map(makeEntry);

const imageKeys = [
  process.env.GEMINI_KEY_5,
  process.env.GEMINI_KEY_6,
]
  .filter(Boolean)
  .map(makeEntry);

// Trạng thái ngày hiện tại (dựa trên TZ_OFFSET_MINUTES) dùng chung cho cả pool
let CURRENT_DAY = localDayKey();

function resetPoolIfNewDay(pool) {
  const today = localDayKey();
  if (today !== CURRENT_DAY) {
    for (const entry of pool) {
      entry.count = 0;
      entry.day = today;
    }
    CURRENT_DAY = today;
    pool._idx = 0;
  }
}

// Lấy key dạng vòng tròn (round-robin), đồng thời tôn trọng giới hạn/ngày
function getKeyFromPool(pool) {
  resetPoolIfNewDay(pool);
  const n = pool.length;
  if (n === 0) return null;

  if (typeof pool._idx !== "number" || pool._idx < 0 || pool._idx >= n) {
    pool._idx = 0;
  }

  // Thử tối đa n phần tử, bắt đầu từ con trỏ hiện tại
  for (let k = 0; k < n; k++) {
    const j = (pool._idx + k) % n;
    const entry = pool[j];
    if (entry && entry.key && entry.count < MAX_PER_DAY) {
      entry.count++;
      // Tiến con trỏ sang phần tử kế tiếp để lần gọi sau dùng key khác
      pool._idx = (j + 1) % n;
      return entry.key;
    }
  }

  // Không còn key nào còn quota hôm nay
  return null;
}

function getValidTextKey() {
  return getKeyFromPool(textKeys);
}
function getValidImageKey() {
  return getKeyFromPool(imageKeys);
}

module.exports = { getValidTextKey, getValidImageKey };
