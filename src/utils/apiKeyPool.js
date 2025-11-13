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
].filter(Boolean).map(makeEntry);

const imageKeys = [
  process.env.GEMINI_KEY_5,
  process.env.GEMINI_KEY_6,
].filter(Boolean).map(makeEntry);

function getKeyFromPool(pool) {
  const today = localDayKey();
  for (const entry of pool) {
    // Reset khi sang ngày mới (theo múi giờ cấu hình)
    if (entry.day !== today) {
      entry.count = 0;
      entry.day = today;
    }
    if (entry.key && entry.count < MAX_PER_DAY) {
      entry.count++;
      return entry.key;
    }
  }
  return null; // hết quota hôm nay
}

function getValidTextKey()  { return getKeyFromPool(textKeys); }
function getValidImageKey() { return getKeyFromPool(imageKeys); }

module.exports = { getValidTextKey, getValidImageKey };
