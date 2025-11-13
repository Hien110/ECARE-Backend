const DAY_MIN = 2; 
const DAY_MAX = 8;

function isValidDay(day) {
  return Number.isInteger(day) && day >= DAY_MIN && day <= DAY_MAX;
}

function isValidTimeHHMM(s) {
  return typeof s === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(s);
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function validateTimeSlot(slot) {
  if (!slot || typeof slot !== "object") return "Thiếu time slot";
  const { start, end, consultationType, maxPatients, isAvailable } = slot;

  if (!isValidTimeHHMM(start) || !isValidTimeHHMM(end)) return "Sai định dạng giờ (HH:MM)";
  if (toMinutes(start) >= toMinutes(end)) return "start phải < end";
  if (!["online", "offline", "both"].includes(consultationType)) return "consultationType không hợp lệ";
  if (maxPatients != null && (!Number.isInteger(maxPatients) || maxPatients < 1)) return "maxPatients phải >= 1";
  if (isAvailable != null && typeof isAvailable !== "boolean") return "isAvailable phải là boolean";
  return null;
}

function normalizeSlots(slots = []) {
  const cleaned = [];
  for (const s of slots) {
    const err = validateTimeSlot(s);
    if (err) throw new Error(err);
    cleaned.push({
      start: s.start,
      end: s.end,
      consultationType: s.consultationType,
      maxPatients: s.maxPatients ?? 1,
      isAvailable: s.isAvailable ?? true,
    });
  }
  cleaned.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  for (let i = 1; i < cleaned.length; i++) {
    if (toMinutes(cleaned[i - 1].end) > toMinutes(cleaned[i].start)) {
      throw new Error("Các khung giờ không được chồng lấn");
    }
  }
  return cleaned;
}

module.exports = {
  DAY_MIN,
  DAY_MAX,
  isValidDay,
  isValidTimeHHMM,
  toMinutes,
  validateTimeSlot,
  normalizeSlots,
};
