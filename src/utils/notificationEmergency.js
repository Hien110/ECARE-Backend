// utils/notificationEmergency.js
const Notification = require("../app/models/Notification");
const User = require("../app/models/User");
const firebaseAdmin = require("../config/firebase");

function severityToPriority(sev = "low") {
  switch (sev) {
    case "critical": return "urgent";
    case "high":     return "high";
    case "medium":   return "medium";
    default:         return "low";
  }
}

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

  let elderName = "Người cao tuổi";
  try {
    const elderUser = await User.findById(elderId).select("fullName role");
    if (elderUser?.fullName) elderName = elderUser.fullName;
    console.log("[AI][AlertFlow] Elder name:", elderName);
  } catch (e) {
    console.warn(
      "[AI][AlertFlow] Could not fetch elder name:",
      e?.message || e
    );
  }

  const finalTitle =
    title && title.trim()
      ? title
      : `⚠️ Cảnh báo: ${elderName} có biểu hiện tiêu cực`;

  const finalBody =
    message && message.trim()
      ? message
      : `Hệ thống phát hiện ${elderName} có tín hiệu cảm xúc tiêu cực trong cuộc trò chuyện. Vui lòng liên hệ sớm để động viên và hỗ trợ.`;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInHours * 3600 * 1000);

  const payloads = recipientIds.map((rid) => ({
    recipient: rid,
    sender: elderId,
    type: pickNotificationType(severity),
    title: finalTitle,
    message: finalBody,
    data: {
      ...context,
      elderName,
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
  const DEBUG = true; // 🔥 Bật log tạm thời cho bạn debug

  console.log("\n================= [PUSH DEBUG] =================");
  console.log("[1] Input recipients:", recipients?.length);
  console.log("[2] Input title:", title);
  console.log("[3] Input body:", body);
  console.log("[4] Input data:", data);

  if (!firebaseAdmin) {
    console.log("[PUSH] ❌ No firebaseAdmin instance");
    return Promise.resolve({ ok: false, reason: "no-firebase" });
  }

  if (!recipients.length) {
    console.log("[PUSH] ❌ No recipients -> Nothing to send");
    return Promise.resolve({ ok: false, reason: "no-recipients" });
  }

  // Lấy token FCM đúng chuẩn
  const tokens = recipients.flatMap((u) => {
    const legacy = Array.isArray(u?.pushTokens) ? u.pushTokens : [];
    const fcmArr = Array.isArray(u?.fcmTokens)
      ? u.fcmTokens.map((t) => t?.token).filter(Boolean)
      : [];

    return [...legacy, ...fcmArr];
  });

  console.log("[5] Extracted tokens:", tokens);
  if (!tokens.length) {
    console.log("[PUSH] ❌ Recipients have NO TOKENS");
    return Promise.resolve({ ok: false, reason: "no-tokens" });
  }

  // 🔥 Nếu là Deadman phys_unwell → gửi bằng channel SOS
  const isDeadmanPhys =
    data?.type === "deadman_choice" && data?.choice === "phys_unwell";

  const androidNoti = isDeadmanPhys
  ? {
      channelId: "deadman_phys_unwell_sos",
      sound: "sos_alarm",
      visibility: "public",
      sticky: false,
      defaultVibrateTimings: false,
      vibrateTimingsMillis: [0, 500, 500, 500, 500, 500, 500],  // <– FIXED
    }
  : {
      sound: "default",
      visibility: "public",
      sticky: false,
    };

  console.log("[6] Android payload:", androidNoti);

  const message = {
    tokens,
    notification: { title, body },
    android: { priority: "high", notification: androidNoti },
    data: Object.fromEntries(
      Object.entries(data || {}).map(([k, v]) => [
        String(k),
        String(v ?? ""),
      ])
    ),
  };

  console.log("[7] Final FCM payload:", message);

  // Gửi đến FCM
  return firebaseAdmin
    .messaging()
    .sendEachForMulticast(message)
    .then((resp) => {
      console.log("[8] FCM Response:", {
        successCount: resp.successCount,
        failureCount: resp.failureCount,
      });

      resp.responses.forEach((r, idx) => {
        console.log("    • Token:", tokens[idx]?.slice(-8), 
                    "| success:", r.success, 
                    "| error:", r.error?.message);
      });

      return {
        ok: true,
        successCount: resp.successCount,
        failureCount: resp.failureCount,
      };
    })
    .catch((err) => {
      console.error("[9] ❌ FCM ERROR:", err);
      return { ok: false, reason: err?.message || "push-error" };
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
        "deliveryMethods.$[dm].failureReason": ok
          ? undefined
          : "send-error",
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
