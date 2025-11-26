// controllers/DeadmanController.js
const mongoose = require("mongoose");
const ElderlyProfile = require("../models/ElderlyProfile");
const Relationship = require("../models/Relationship");
const User = require("../models/User");
const {
  createDistressNotifications,
  trySendPush,
} = require("../../utils/notificationEmergency.js");

let __deadmanSchedulerStarted = false;
try {
  const { startDeadmanScheduler } = require("../../utils/deadmanScheduler.js");
  if (!__deadmanSchedulerStarted && typeof startDeadmanScheduler === "function") {
    startDeadmanScheduler();
    __deadmanSchedulerStarted = true;
    console.log("[Deadman] Scheduler auto-started from controller");
  }
} catch (e) {
  console.warn("[Deadman] Scheduler not started:", e?.message || e);
}

const DeadmanController = {
  status: async (req, res) => {
    const DEBUG = process.env.NODE_ENV !== "production";
    const reqId = Math.random().toString(36).slice(2, 8);
    const log = (...args) =>
      DEBUG && console.log(`[DEADMAN][status][#${reqId}]`, ...args);

    try {
      const elderId = req.user?.userId || req.user?._id;
      if (!elderId) {
        log("Unauthorized – missing elderId");
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      const prof = await ElderlyProfile.findOne({ user: elderId }).lean();
      log("Profile fetched:", !!prof);
      return res.json({
        success: true,
        data: prof?.safetyMonitoring || {},
      });
    } catch (err) {
      console.error("[DEADMAN][status][ERROR]:", err?.message || err);
      return res.status(500).json({
        success: false,
        message: err?.message || "Lỗi lấy trạng thái Deadman",
      });
    }
  },

  config: async (req, res) => {
    const DEBUG = process.env.NODE_ENV !== "production";
    const reqId = Math.random().toString(36).slice(2, 8);
    const log = (...args) =>
      DEBUG && console.log(`[DEADMAN][config][#${reqId}]`, ...args);

    try {
      const elderId = req.user?.userId || req.user?._id;
      if (!elderId)
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      const allowed = [
        "enabled",
        "dailyCutoff",
        "remindAfterMins",
        "alertAfterMins",
        "timezone",
      ];
      const patch = {};
      for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];

      const setObj = {};
      for (const [k, v] of Object.entries(patch))
        setObj[`safetyMonitoring.deadmanConfig.${k}`] = v;

      log("Applying patch:", setObj);

      const updated = await ElderlyProfile.findOneAndUpdate(
        { user: elderId },
        { $set: setObj },
        { new: true }
      ).lean();

      return res.json({
        success: true,
        data: updated?.safetyMonitoring?.deadmanConfig || {},
      });
    } catch (err) {
      console.error("[DEADMAN][config][ERROR]:", err?.message || err);
      return res.status(500).json({
        success: false,
        message: "Không thể cập nhật cấu hình Deadman",
      });
    }
  },

  checkin: async (req, res) => {
    const DEBUG = process.env.NODE_ENV !== "production";
    const reqId = Math.random().toString(36).slice(2, 8);
    const log = (...args) =>
      DEBUG && console.log(`[DEADMAN][checkin][#${reqId}]`, ...args);

    try {
      const elderId = req.user?.userId || req.user?._id;
      const role = (req.user?.role || "").toLowerCase();

      if (!elderId) {
        log("❌ Missing elderId (token/middleware issue)");
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      log("➡️ CHECK-IN request", { elderId, role });

      if (role !== "elderly") {
        log("⛔ Reject: user is not elderly");
        return res.status(403).json({
          success: false,
          message: "Chỉ tài khoản Người cao tuổi mới được check-in.",
        });
      }

      const now = new Date();

      const updateSet = {
        "safetyMonitoring.deadmanState.lastCheckinAt": now,
        "safetyMonitoring.deadmanState.lastReminderAt": null,
        "safetyMonitoring.deadmanState.lastAlertAt": null,
        "safetyMonitoring.deadmanState.snoozeUntil": null,
      };

      const updatedProf = await ElderlyProfile.findOneAndUpdate(
        { user: elderId },
        { $set: updateSet },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
        }
      ).lean();

      if (!updatedProf) {
        log("❌ findOneAndUpdate returned null");
        return res.status(500).json({
          success: false,
          message: "Không thể cập nhật trạng thái an toàn.",
        });
      }

      const deadmanState = updatedProf.safetyMonitoring?.deadmanState || {};
      const deadmanConfig = updatedProf.safetyMonitoring?.deadmanConfig || {};

      log("📝 Deadman state updated OK", {
        lastCheckinAt: deadmanState.lastCheckinAt,
      });

      return res.json({
        success: true,
        data: {
          lastCheckinAt: deadmanState.lastCheckinAt || now,
          deadmanState,
          deadmanConfig,
        },
      });
    } catch (err) {
      console.error("[DEADMAN][checkin][ERROR]:", err?.message || err);
      return res.status(500).json({
        success: false,
        message: "Không thể thực hiện check-in (Lỗi server).",
      });
    }
  },

  snooze: async (req, res) => {
    const DEBUG = process.env.NODE_ENV !== "production";
    const reqId = Math.random().toString(36).slice(2, 8);
    const log = (...args) =>
      DEBUG && console.log(`[DEADMAN][snooze][#${reqId}]`, ...args);

    try {
      const elderId = req.user?.userId || req.user?._id;
      if (!elderId)
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      const minutes = Math.max(1, Number(req.body?.minutes ?? 60));
      const until = new Date(Date.now() + minutes * 60 * 1000);

      await ElderlyProfile.updateOne(
        { user: elderId },
        { $set: { "safetyMonitoring.deadmanState.snoozeUntil": until } }
      );

      log("Snoozed until:", until);
      return res.json({ success: true, data: { snoozeUntil: until } });
    } catch (err) {
      console.error("[DEADMAN][snooze][ERROR]:", err?.message || err);
      return res.status(500).json({
        success: false,
        message: "Không thể đặt snooze",
      });
    }
  },

  // ====== LỰA CHỌN HÔM NAY (safe / phys_unwell / psy_unwell) ======
  choiceNotify: async (req, res) => {
    const DEBUG = process.env.NODE_ENV !== "production";
    const reqId = Math.random().toString(36).slice(2, 8);
    const log = (...args) =>
      DEBUG && console.log(`[DEADMAN][choiceNotify][#${reqId}]`, ...args);

    try {
      const elderId = req.user?.userId || req.user?._id;
      const role = (req.user?.role || "").toLowerCase();

      if (!elderId) {
        log("❌ Missing elderId (token/middleware issue)");
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }
      if (role !== "elderly") {
        log("⛔ Reject: user is not elderly");
        return res.status(403).json({
          success: false,
          message: "Chỉ tài khoản Người cao tuổi mới được gửi lựa chọn.",
        });
      }

      const rawChoice = String(req.body?.choice || "").trim();
      const allow = new Set(["safe", "phys_unwell", "psy_unwell"]);
      if (!allow.has(rawChoice)) {
        return res.status(400).json({
          success: false,
          message: "choice phải là: safe | phys_unwell | psy_unwell",
        });
      }
      const choice = rawChoice;
      const customMessage = typeof req.body?.message === "string"
        ? req.body.message.trim()
        : "";

      // 1) bảo đảm có ElderlyProfile
      let prof = await ElderlyProfile.findOne({ user: elderId }).lean();
      if (!prof) {
        log("ℹ️ No ElderlyProfile found — creating with defaults");
        try {
          const created = await ElderlyProfile.create({ user: elderId });
          prof = created?.toObject?.() || created;
          log("✅ ElderlyProfile created:", { id: prof?._id });
        } catch (e) {
          console.error(
            "[DEADMAN][choiceNotify][createProfile][ERROR]:",
            e?.message || e
          );
          return res.status(500).json({
            success: false,
            message: "Không thể tạo hồ sơ ElderlyProfile cho người dùng.",
          });
        }
      }

      // 2) cập nhật trạng thái check-in (ẩn nút tới hết ngày)
      const now = new Date();
      const upd = await ElderlyProfile.updateOne(
        { user: elderId },
        {
          $set: {
            "safetyMonitoring.deadmanState.lastCheckinAt": now,
            "safetyMonitoring.deadmanState.lastReminderAt": null,
            "safetyMonitoring.deadmanState.lastAlertAt": null,
          },
        }
      );
      log("📝 Mongo update:", {
        matched: upd.matchedCount,
        modified: upd.modifiedCount,
      });

      // 3) message theo choice
      const msgMap = {
        safe: {
          title: "✅ Hôm nay an toàn",
          body:
            customMessage ||
            "Người cao tuổi báo: sức khỏe & tâm trạng đều tốt.",
          severity: "info",
        },
        phys_unwell: {
          title: "⚕️ Sức khỏe không ổn",
          body:
            customMessage ||
            "Người cao tuổi báo: KHÔNG ỔN về SỨC KHỎE.",
          severity: "high", // dùng high để ưu tiên
        },
        psy_unwell: {
          title: "💭 Tâm lý không ổn",
          body:
            customMessage ||
            "Người cao tuổi báo: KHÔNG ỔN về TÂM LÝ.",
          severity: "medium",
        },
      }[choice];

      // 4) lấy tên elder để đính kèm
      const elderUser = await User.findById(elderId).select("fullName");
      const elderName = elderUser?.fullName || "Người cao tuổi";

      // 5) tìm người thân
      const rels = await Relationship.find({
        elderly: elderId,
        status: "accepted",
        "permissions.receiveAlerts": true,
      })
        .populate({
          path: "family",
          select: "fullName role fcmTokens pushTokens",
        })
        .lean();

      const families = rels.map((r) => r?.family).filter(Boolean);
      const recipientIds = families.map((f) => f._id);

      log("👨‍👩‍👧‍👦 Relatives for choiceNotify:", {
        countRelDocs: rels.length,
        countFamilies: families.length,
      });

      // 6) tạo bản ghi notification
      if (recipientIds.length > 0) {
        await createDistressNotifications({
          elderId,
          recipientIds,
          severity: msgMap.severity,
          title: msgMap.title,
          message: msgMap.body,
          context: {
            feature: "deadman",
            kind: "choice",
            choice,
          },
          channels: ["in_app", "push_notification"],
          groupKey: "elder_deadman_choice",
        });
      } else {
        log("⚠️ No relatives with receiveAlerts=true. Skip DB notifications.");
      }

      // 7) gửi push (nếu có token)
      if (families.length > 0) {
        console.log("\n====== [DEADMAN CHOICE] ======");
          console.log("[1] Elder ID:", elderId);
          console.log("[2] Choice:", choice);
          console.log("[3] Families found:", families?.length);
          console.log("[4] Recipients IDs:", recipientIds);
        const pushResult = await trySendPush({
          recipients: families,
          title: msgMap.title,
          body: `${elderName}: ${msgMap.body}`,
          data: {
            type: "deadman_choice",
            choice,
            elderId: String(elderId),
            elderName,
            groupKey: "elder_deadman_choice",
            action: "open_app",
          },
        });
        log("📤 trySendPush result:", pushResult);
      } else {
        log("⚠️ No family recipients → skip push");
      }

      return res.json({
        success: true,
        data: { lastCheckinAt: now, choice },
      });
    } catch (err) {
      console.error("[DEADMAN][choiceNotify][ERROR]:", err?.message || err);
      return res.status(500).json({
        success: false,
        message: "Không thể xử lý lựa chọn hôm nay.",
      });
    }
  },

  _remindElder: async (elderUserId) => {
    try {
      const elder = await User.findById(elderUserId).select(
        "fullName role fcmTokens pushTokens"
      );
      if (!elder) return;

      await trySendPush({
        recipients: [elder],
        title: "⏰ Nhắc kiểm tra an toàn",
        body: "Bạn chưa xác nhận “Tôi ổn hôm nay”. Vui lòng bấm để xác nhận.",
        data: { type: "deadman_reminder", action: "checkin" },
      });

      console.log(
        `[DEADMAN][_remindElder] Reminder sent to ${
          elder.fullName || elderUserId
        }`
      );
    } catch (err) {
      console.error("[DEADMAN][_remindElder][ERROR]:", err?.message || err);
    }
  },

  _alertRelatives: async (elderUserId) => {
    try {
      const rels = await Relationship.find({
        elderly: elderUserId,
        status: "accepted",                    
        "permissions.receiveAlerts": true,
      })
        .populate({
          path: "family",
          select: "fullName role fcmTokens pushTokens",
        })
        .lean();

      const families = rels.map((r) => r?.family).filter(Boolean);
      const recipientIds = families.map((f) => f._id);

      await createDistressNotifications({
        elderId: elderUserId,
        recipientIds,
        severity: "high",
        title: "⚠️ Cảnh báo an toàn",
        message: "Người cao tuổi hôm nay chưa xác nhận an toàn.",
        context: { feature: "deadman", reason: "no-checkin" },
        channels: ["in_app", "push_notification"],
        groupKey: "elder_deadman",
      });

      await trySendPush({
        recipients: families,                 
        title: "⚠️ Cảnh báo người thân",
        body: "Người thân hôm nay chưa xác nhận an toàn. Vui lòng liên hệ.",
        data: { type: "deadman_alert", action: "open_app" },
      });

      console.log(
        `[DEADMAN][_alertRelatives] Alert sent to ${families.length} relatives.`
      );
    } catch (err) {
      console.error("[DEADMAN][_alertRelatives][ERROR]:", err?.message || err);
    }
  },
};

module.exports = DeadmanController;
