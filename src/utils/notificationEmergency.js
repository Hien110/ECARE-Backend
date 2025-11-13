// utils/notificationEmergency.js
const Notification = require("../app/models/Notification");
const User = require("../app/models/User"); // chỉnh path đúng theo dự án của bạn
const firebaseAdmin = require("../config/firebase");

/** Map mức rủi ro -> priority trong schema Notification */
function severityToPriority(sev = "low") {
  switch (sev) {
    case "critical": return "urgent";
    case "high":     return "high";
    case "medium":   return "medium";
    default:         return "low";
  }
}

/** Map mức rủi ro -> type trong schema Notification */
function pickNotificationType(sev = "low") {
  if (sev === "critical" || sev === "high") return "emergency_alert";
  if (sev === "medium") return "health_alert";
  return "mood_check";
}


async function createDistressNotifications(opts = {}) {
  const {
    elderId,
    recipientIds = [],
    severity = "medium",
    title,
    message,
    context = {},
    channels = ["in_app", "push_notification"],
    expiresInHours = 72,
    groupKey = "elder_distress",
  } = opts;

  if (!recipientIds.length) return Promise.resolve([]);

  // === LẤY TÊN ELDER TỪ User.fullName ===
  let elderName = "Người cao tuổi";
  try {
    const elderUser = await User.findById(elderId).select("fullName role");
    if (elderUser?.fullName) elderName = elderUser.fullName;
    console.log("[AI][AlertFlow] Elder name:", elderName);
  } catch (e) {
    console.warn("[AI][AlertFlow] Could not fetch elder name:", e?.message || e);
  }

  // === GHÉP TIÊU ĐỀ/NỘI DUNG THEO TÊN ===
  const finalTitle = (title && title.trim())
    ? title
    : `⚠️ Cảnh báo: ${elderName} có biểu hiện tiêu cực`;

  const finalBody = (message && message.trim())
    ? message
    : `Hệ thống phát hiện ${elderName} có tín hiệu cảm xúc tiêu cực trong cuộc trò chuyện. ` +
      `Vui lòng liên hệ sớm để động viên và hỗ trợ.`;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (expiresInHours * 3600 * 1000));

  const payloads = recipientIds.map((rid) => ({
    recipient: rid,
    sender: elderId,
    type: pickNotificationType(severity),
    title: finalTitle,
    message: finalBody,
    data: {
      ...context,
      elderName,                // đính kèm để client có thể hiển thị lại
      actionText: "Xem chi tiết",
      actionUrl: "",
    },
    priority: severityToPriority(severity),
    status: "sent",
    isRead: false,
    deliveryMethods: channels.map((m) => ({ method: m, status: "pending" })),
    scheduledFor: now,
    expiresAt,
    groupKey,
  }));

  return Notification.insertMany(payloads, { ordered: false });
}

function trySendPush({ recipients = [], title, body, data = {} } = {}) {
  const DEBUG = process.env.NODE_ENV !== "production";

  if (!firebaseAdmin || !recipients.length) {
    if (DEBUG) console.log("[PUSH] Skip: no-firebase-or-recipients");
    return Promise.resolve({ ok: false, reason: "no-firebase-or-recipients" });
  }

  // LẤY TOKEN như code gốc (đã OK)
  const tokens = recipients.flatMap((u) => {
    const legacy = Array.isArray(u?.pushTokens) ? u.pushTokens : [];
    const fcmArr = Array.isArray(u?.fcmTokens) ? u.fcmTokens.map(t => t?.token).filter(Boolean) : [];
    return [...legacy, ...fcmArr];
  }).filter(Boolean);

  if (!tokens.length) {
    if (DEBUG) console.log("[PUSH] Skip: no tokens on recipients");
    return Promise.resolve({ ok: false, reason: "no-tokens" });
  }

  if (DEBUG) console.log("[PUSH] Tokens:", tokens.map(t => t.slice(-6)));

  const message = {
    tokens,
    notification: { title, body },   // cần để OS hiển thị banner khi app tắt
    android: {
      priority: "high",
      notification: { sound: "default", visibility: "public", sticky: false },
    },
    apns: {
      headers: { "apns-priority": "10" },
      payload: { aps: { sound: "default", badge: 1, alert: { title, body } } },
    },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [String(k), String(v)])),
  };

  return firebaseAdmin.messaging().sendEachForMulticast(message)
    .then((resp) => {
      if (DEBUG) {
        const details = resp.responses.map((r, i) => ({
          tokenLast6: tokens[i]?.slice(-6),
          ok: r.success,
          err: r.error?.code || null
        }));
        console.log("[PUSH] Per-token:", details);
      }
      return { ok: true, successCount: resp.successCount, failureCount: resp.failureCount };
    })
    .catch((e) => {
      if (DEBUG) console.log("[PUSH] ERROR:", e?.message || e);
      return { ok: false, reason: e?.message || "push-failed" };
    });
}


function markDeliveryResults(notifications = [], channel, result = {}) {
  if (!notifications.length) return Promise.resolve();

  const ids = notifications.map((n) => n._id);
  const now = new Date();
  const ok = !!result.ok;

  return Notification.updateMany(
    { _id: { $in: ids }, "deliveryMethods.method": channel },
    {
      $set: {
        "deliveryMethods.$[dm].status": ok ? "delivered" : "failed",
        "deliveryMethods.$[dm].deliveredAt": ok ? now : undefined,
        "deliveryMethods.$[dm].failureReason": ok ? undefined : "send-error",
      },
    },
    { arrayFilters: [{ "dm.method": channel }] }
  )
  .then(() => {
    if (!ok) return null;
    return Notification.updateMany(
      { _id: { $in: ids }, status: { $in: ["sent", "delivered"] } },
      { $set: { status: "delivered" } }
    );
  })
  .then(() => undefined);
}

module.exports = {
  createDistressNotifications,
  trySendPush,
  markDeliveryResults,
  severityToPriority,
  pickNotificationType,
};
