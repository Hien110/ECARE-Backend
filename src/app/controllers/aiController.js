const { getGroqClient } = require("../../utils/groqClient.js");
const { synthesizeToBuffer } = require("../../utils/tts.js");
const DoctorProfile = require("../models/DoctorProfile.js");
const SupporterProfile = require("../models/SupporterProfile.js");
const Relationship = require("../models/Relationship.js");
const mongoose = require("mongoose");
const {
  createDistressNotifications,
  trySendPush,
  markDeliveryResults,
} = require("../../utils/notificationEmergency.js");
const AIMessage = require("../models/AIMessage.js");
// + NEW: để auto check-in Deadman khi elder nhắn tin
const ElderlyProfile = require("../models/ElderlyProfile.js");

let User = null;
try {
  User = require("../models/User.js");
} catch {
  console.warn(
    "[AI] User model not found. Title will fallback to generic elder name."
  );
}

const AiController = {
  chat: async (req, res) => {
    const DEBUG = process.env.NODE_ENV !== "production";
    const reqId = Math.random().toString(36).slice(2);
    const startedAt = Date.now();

    try {
      const VI_STOPWORDS = new Set([
        "và",
        "hoặc",
        "là",
        "của",
        "cho",
        "với",
        "nhé",
        "ạ",
        "à",
        "ừ",
        "ừm",
        "ờ",
        "thì",
        "này",
        "kia",
        "đó",
        "cái",
        "một",
        "nhưng",
        "vẫn",
        "đang",
        "có",
        "không",
        "chứ",
        "đi",
        "đến",
        "tới",
        "trong",
        "ngoài",
        "về",
        "khi",
        "rất",
        "hơi",
        "lắm",
        "nữa",
        "cũng",
        "được",
        "bị",
        "do",
        "vì",
        "nên",
        "để",
        "ra",
        "vào",
        "trên",
        "dưới",
        "sang",
      ]);

      function log(...args) {
        if (DEBUG) console.log(`[AI][#${reqId}]`, ...args);
      }

      function sanitizeMessage(s, max = 6000) {
        return String(s ?? "")
          .trim()
          .slice(0, max);
      }

      function sliceHistory(list = [], maxChars = 12000) {
        let acc = 0,
          out = [];
        for (let i = list.length - 1; i >= 0; i--) {
          const t = String(list[i]?.content ?? "");
          acc += t.length;
          if (acc > maxChars) break;
          out.unshift({ role: list[i].role, content: t });
        }
        return out;
      }

      function toGroqMessages(
        history,
        systemInstruction,
        injectedContext,
        userText
      ) {
        const msgs = [];
        if (systemInstruction)
          msgs.push({ role: "system", content: systemInstruction });
        if (injectedContext)
          msgs.push({
            role: "system",
            content: `[Context]\n${injectedContext}`,
          });
        for (const m of history) {
          msgs.push({
            role: m.role === "assistant" ? "assistant" : "user",
            content: String(m.content || ""),
          });
        }
        msgs.push({ role: "user", content: userText });
        return msgs;
      }

      function extractEmotion(fullText) {
        const fallback = {
          mood: "neutral",
          valence: 0,
          arousal: 0.3,
          loneliness: 0.2,
          riskLevel: "none",
          riskReason: "",
          dangerSignals: [],
          supportMessage: "",
          followUps: [],
        };
        const s = String(fullText || "");
        const m = s.match(/<<<EMOTION_JSON>>>\s*```json\s*([\s\S]*?)```/i);
        let emotion = fallback;
        if (m) {
          try {
            const p = JSON.parse(m[1]);
            emotion = {
              ...fallback,
              ...p,
              followUps: Array.isArray(p?.followUps)
                ? p.followUps.slice(0, 2).filter(Boolean)
                : [],
              dangerSignals: Array.isArray(p?.dangerSignals)
                ? p.dangerSignals.slice(0, 6).filter(Boolean)
                : [],
            };
          } catch {}
        }
        const reply = m ? s.replace(m[0], "").trim() : s.trim();
        return { reply, emotion };
      }

      function getStatusCodeFromError(err) {
        try {
          const o = JSON.parse(err?.message || "{}");
          return o?.error?.code || err?.status || err?.response?.status || null;
        } catch {
          return err?.status || err?.response?.status || null;
        }
      }

      function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
      }

      function tokenizeVN(s = "") {
        return String(s)
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d")
          .split(/[^a-z0-9]+/i)
          .filter((w) => w && !VI_STOPWORDS.has(w) && w.length > 1);
      }

      function jaccard(a, b) {
        const A = new Set(a),
          B = new Set(b);
        const inter = [...A].filter((x) => B.has(x)).length;
        const uni = new Set([...A, ...B]).size || 1;
        return inter / uni;
      }

      function isExplicitNewTopic(msg) {
        const q = (msg || "").toLowerCase();
        return [
          "chủ đề khác",
          "vấn đề khác",
          "câu hỏi khác",
          "đổi chủ đề",
          "chuyển chủ đề",
          "sang chuyện khác",
          "bỏ qua cái trước",
          "next topic",
          "another question",
          "new topic",
          "quay sang",
          "qua phần khác",
          "hỏi cái khác",
        ].some((k) => q.includes(k));
      }

      function isNewTopicComparedTo(history = [], msg = "") {
        if (isExplicitNewTopic(msg)) return true;
        const last = [...history].reverse().find((m) => m.role === "user");
        if (!last) return false;
        return (
          jaccard(tokenizeVN(last.content || ""), tokenizeVN(msg || "")) < 0.15
        );
      }

      function deProgramify(s = "") {
        let out = String(s || "");
        const F = [
          /(^|\s)(em|cháu|tôi)\s*(chỉ|là)\s*(một\s*)?(ai|chatbot|chương trình|máy tính|mô hình ngôn ngữ)/gi,
          /(vì|do)\s*(em|cháu|tôi)\s*(là)\s*(ai|chương trình|máy)/gi,
          /\b(ai|chatgpt|mô hình ngôn ngữ|large language model|llm)\b/gi,
          /\btoken(s)?\b/gi,
        ];
        for (const re of F) out = out.replace(re, " người bạn ảo ");
        return out.replace(/\s{2,}/g, " ").trim();
      }

      function enforceHonorifics(s = "") {
        let out = String(s || "");
        out = out.replace(/\s{2,}/g, " ").trim();
        out = out.replace(
          /(^|[^\p{L}])(em|anh|chị|ban|bạn)(?=([^\p{L}]|$))/giu,
          (_, pre) => pre + "Bác"
        );
        out = out.replace(
          /(^|[^\p{L}])(mình|tôi)\s+(sẽ|có thể|giúp|hỗ trợ|khuyên|xin|mong|nghĩ|ở đây)(?=([^\p{L}]|$))/giu,
          (_, pre, __, v) => `${pre}cháu ${v}`
        );
        out = out
          .replace(/Bácu/giu, "Bác")
          .replace(/\b(Bác)\s+\1\b/giu, "$1")
          .replace(/\s+([,.!?;:])/g, "$1")
          .replace(/([,.!?;:])(?!\s|$)/g, "$1 ");
        out = out.replace(/\s{2,}/g, " ").trim();
        return out;
      }

      function chooseModel(message) {
        const q = (message || "").toLowerCase();
        const heavy = [
          "chẩn đoán",
          "giải thích sâu",
          "phân tích chuyên sâu",
          "toán",
          "code phức tạp",
        ];
        return heavy.some((k) => q.includes(k))
          ? "llama-3.1-70b-versatile"
          : process.env.AI_MODEL || "llama-3.1-8b-instant";
      }

      function parseDoctorIntent(message) {
        const q = (message || "").toLowerCase();
        const want =
          q.includes("bác sĩ") ||
          q.includes("giới thiệu bác sĩ") ||
          q.includes("khám") ||
          q.includes("phòng khám") ||
          q.includes("bệnh viện");
        if (!want) return null;
        const maps = [
          { keys: ["tiêu hoá", "dạ dày", "đau bụng"], spec: "Tiêu hoá" },
          { keys: ["tim mạch", "tim"], spec: "Tim mạch" },
          {
            keys: ["thần kinh", "đau đầu", "mất ngủ", "chóng mặt"],
            spec: "Thần kinh",
          },
          {
            keys: ["xương khớp", "cột sống", "đau lưng", "thoái hoá"],
            spec: "Cơ xương khớp",
          },
          { keys: ["nội tổng quát", "tổng quát"], spec: "Nội tổng quát" },
          { keys: ["tai mũi họng"], spec: "Tai mũi họng" },
          { keys: ["mắt"], spec: "Mắt" },
          { keys: ["da liễu", "dị ứng"], spec: "Da liễu" },
        ];
        for (const m of maps)
          if (m.keys.some((k) => q.includes(k)))
            return { specialization: m.spec };
        return { specialization: null };
      }

      function parseSupporterIntent(message) {
        const q = (message || "").toLowerCase();
        const want =
          q.includes("supporter") ||
          q.includes("người hỗ trợ") ||
          q.includes("chăm sóc") ||
          q.includes("trông người già") ||
          q.includes("bạn đồng hành") ||
          q.includes("đi chợ") ||
          q.includes("nấu ăn") ||
          q.includes("dọn dẹp") ||
          q.includes("đưa đón") ||
          q.includes("trò chuyện");
        if (!want) return null;
        const maps = [
          {
            keys: [
              "chăm sóc",
              "trông người già",
              "bạn đồng hành",
              "trò chuyện",
            ],
            service: "Chăm sóc & bạn đồng hành",
          },
          { keys: ["đi chợ", "nấu ăn"], service: "Đi chợ & nấu ăn" },
          { keys: ["dọn dẹp"], service: "Dọn dẹp nhà cửa" },
          { keys: ["đưa đón"], service: "Đưa đón - di chuyển" },
        ];
        for (const m of maps)
          if (m.keys.some((k) => q.includes(k))) return { service: m.service };
        return { service: null };
      }

      async function getRelativesForElder(elderId) {
        const rels = await Relationship.find({
          elderly: elderId,
          status: "accepted",
          "permissions.receiveAlerts": true,
        })
          .populate({
            path: "family",
            select: "fullName role fcmTokens pushTokens",
          })
          .sort({ priority: 1, createdAt: -1 })
          .lean();

        const allowedRoles = new Set(["family", "supporter"]);
        const map = new Map();

        for (const r of rels) {
          const u = r?.family;
          if (!u || !u._id) continue;
          const role = String(u.role || "").toLowerCase();
          if (!allowedRoles.has(role)) continue;
          map.set(String(u._id), {
            _id: u._id,
            fullName: u.fullName || "",
            role,
            fcmTokens: u.fcmTokens || [],
            pushTokens: u.pushTokens || [],
            // LẤY NGUYÊN VĂN QUAN HỆ TỪ DB (không chuẩn hoá)
            relationText:
              r?.relation ??
              r?.relationship ??
              r?.roleInFamily ??
              r?.kinship ??
              "",
            priority: r?.priority ?? 99,
          });
        }
        return [...map.values()];
      }

      async function groqWithTimeout(p, timeoutMs = 25000) {
        let t;
        const timeout = new Promise((_, rej) => {
          t = setTimeout(() => rej(new Error("AbortError")), timeoutMs);
        });
        const r = await Promise.race([p, timeout]);
        clearTimeout(t);
        return r;
      }
      async function fetchWithRetryAndFallback({
        ai,
        primaryModel,
        messages,
        generationConfig,
        maxRetries = 3,
        timeoutMs = 25000,
      }) {
        const models = [
          primaryModel,
          "llama-3.1-8b-instant",
          "gemma2-9b-it",
          "llama-3.1-70b-versatile",
        ];
        let lastErr;
        for (let mIdx = 0; mIdx < models.length; mIdx++) {
          const model = models[mIdx];
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              const resp = await groqWithTimeout(
                ai.chat.completions.create({
                  model,
                  messages,
                  temperature: generationConfig?.temperature ?? 0.6,
                  top_p: generationConfig?.topP ?? 0.8,
                  max_tokens: generationConfig?.maxOutputTokens ?? 700,
                }),
                timeoutMs
              );
              return { response: resp, modelUsed: model };
            } catch (err) {
              const code = getStatusCodeFromError(err);
              const retriable =
                err?.message === "AbortError" ||
                code === 429 ||
                code === 503 ||
                (code >= 500 && code <= 599);
              const jitter = Math.floor(Math.random() * 120);
              const backoff = 300 * Math.pow(2, attempt - 1) + jitter;
              if (retriable && attempt < maxRetries) {
                await sleep(backoff);
                continue;
              }
              lastErr = err;
              break;
            }
          }
        }
        throw lastErr;
      }

      // === BODY ===
      let { message, history = [], sessionId = null } = req.body || {};
      message = sanitizeMessage(message);
      history = sliceHistory(history);
      if (!message)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu hoặc sai 'message'" });

      const elderId = req.user?.userId || req.user?._id || null;
      log("AUTH", { hasUser: !!req.user, elderId });

      // + NEW: Deadman auto check-in khi Elder gửi tin nhắn
      if (elderId) {
        try {
          await ElderlyProfile.updateOne(
            { user: elderId },
            {
              $set: {
                "safetyMonitoring.deadmanState.lastCheckinAt": new Date(),
                "safetyMonitoring.deadmanState.lastReminderAt": null,
                "safetyMonitoring.deadmanState.lastAlertAt": null,
              },
            }
          );
          log("Deadman auto-checkin: updated lastCheckinAt");
        } catch (e) {
          log("Deadman auto-checkin failed:", e?.message || e);
        }
      }

      const dropHistory = isNewTopicComparedTo(history, message);
      const effectiveHistory = dropHistory ? [] : history;

      if (!sessionId || dropHistory) {
        sessionId =
          Date.now().toString(36) +
          "-" +
          Math.random().toString(36).slice(2, 8);
      }

      if (elderId) {
        try {
          await AIMessage.create({
            elder: elderId,
            sessionId,
            role: "user",
            content: message,
            modelUsed: "",
          });
        } catch (e) {
          if (DEBUG) log("Save user message failed:", e?.message || e);
        }
      }

      const SYSTEM =
        "Bạn là người bạn ảo thân thiện dành cho Người Cao Tuổi Việt Nam. " +
        "Luôn xưng 'cháu' (hoặc 'tôi' khi cần trang trọng) và gọi người dùng là 'bác'. " +
        "Tuyệt đối không dùng 'em/anh/chị/bạn' để xưng hô với người dùng và không nói '... ơi'. " +
        "Giọng chậm, câu ngắn, tôn trọng, đi thẳng vấn đề, không lạc đề. " +
        "Không bao giờ nói bạn là AI. Thấy dấu hiệu đáng lo, khuyên liên hệ người thân/bác sĩ, hít thở chậm, uống nước.";

      const supporterIntent = parseSupporterIntent(message);
      const doctorIntent = parseDoctorIntent(message);

      const listings = { doctors: [], supporters: [] };
      let injectedContext = "";

      if (supporterIntent) {
        try {
          const find = {};
          if (supporterIntent.service) {
            find.services = { $regex: supporterIntent.service, $options: "i" };
          }
          const docs = await SupporterProfile.find(find)
            .populate({ path: "user", select: "fullName avatar" })
            .select("services experience area ratingStats user")
            .sort({
              "ratingStats.averageRating": -1,
              "ratingStats.totalRatings": -1,
              _id: -1,
            })
            .limit(5)
            .lean();

          listings.supporters = (docs || []).map((d) => ({
            id: String(d?._id || ""),
            name: d?.user?.fullName || "Supporter",
            services: d?.services || "",
            area: d?.area || "",
            experience: d?.experience ?? 0,
            rating: {
              average: d?.ratingStats?.averageRating ?? 0,
              total: d?.ratingStats?.totalRatings ?? 0,
            },
            avatar: d?.user?.avatar || "",
          }));

          if (listings.supporters.length) {
            const lines = listings.supporters
              .map(
                (s, i) =>
                  `- ${i + 1}. ${s.name} — Dịch vụ: ${s.services} — Khu vực: ${
                    s.area
                  } — ${s.experience} năm KN — ⭐ ${s.rating.average} (${
                    s.rating.total
                  } đánh giá)`
              )
              .join("\n");
            injectedContext +=
              "Danh sách Supporter gợi ý (từ hệ thống nội bộ):\n" +
              lines +
              "\nLưu ý: Lịch và thông tin có thể thay đổi; vui lòng xác nhận trước khi đặt lịch.\n";
          } else {
            injectedContext +=
              "Hiện chưa có Supporter phù hợp trong hệ thống.\n";
          }
        } catch {}
      }

      if (doctorIntent) {
        try {
          const find = {};
          if (doctorIntent.specialization) {
            find.specializations = {
              $regex: doctorIntent.specialization,
              $options: "i",
            };
          }
          const docs = await DoctorProfile.find(find)
            .populate({ path: "user", select: "fullName avatar" })
            .select("specializations experience hospitalName ratingStats user")
            .sort({
              "ratingStats.averageRating": -1,
              "ratingStats.totalRatings": -1,
              _id: -1,
            })
            .limit(5)
            .lean();

          listings.doctors = (docs || []).map((d) => ({
            id: String(d?._id || ""),
            name: d?.user?.fullName || "Bác sĩ",
            specializations: d?.specializations || "",
            hospital: d?.hospitalName || "",
            experience: d?.experience ?? 0,
            rating: {
              average: d?.ratingStats?.averageRating ?? 0,
              total: d?.ratingStats?.totalRatings ?? 0,
            },
            avatar: d?.user?.avatar || "",
          }));

          if (listings.doctors.length) {
            const lines = listings.doctors
              .map(
                (d, i) =>
                  `- ${i + 1}. ${d.name} — ${d.specializations} — ${
                    d.hospital
                  } — ${d.experience} năm KN — ⭐ ${d.rating.average} (${
                    d.rating.total
                  } đánh giá)`
              )
              .join("\n");
            injectedContext +=
              (injectedContext ? "\n" : "") +
              "Danh sách bác sĩ gợi ý (từ hệ thống nội bộ):\n" +
              lines +
              "\nLưu ý: Thông tin có thể thay đổi theo thời gian; hãy xác nhận lại trước khi đặt lịch.\n";
          } else {
            injectedContext +=
              (injectedContext ? "\n" : "") +
              "Hiện chưa có dữ liệu bác sĩ phù hợp trong hệ thống.\n";
          }
        } catch {}
      }

      const userPrompt =
        `${message}\n\n` +
        "Hãy trả lời thân mật, trấn an; không tự nhận là AI. " +
        "Luôn xưng 'cháu' hoặc 'tôi' và gọi người dùng là 'bác'. " +
        "Không dùng các đại từ 'em/anh/chị/bạn', không gọi '... ơi'. " +
        "Nếu chủ đề khác hẳn trước đó, bỏ lịch sử cũ. " +
        "Cuối cùng IN đúng khối EMOTION_JSON:\n" +
        "<<<EMOTION_JSON>>>\n```json\n" +
        '{ "mood":"warm","valence":0.7,"arousal":0.4,"loneliness":0.1,"riskLevel":"none","riskReason":"","dangerSignals":[],"supportMessage":"","followUps":[] }\n' +
        "```\n";

      const ai = await getGroqClient();
      const primaryModel = chooseModel(message);
      const generationConfig = {
        temperature: 0.6,
        topP: 0.8,
        maxOutputTokens: 1024,
      };
      const messages = toGroqMessages(
        effectiveHistory,
        SYSTEM,
        injectedContext,
        userPrompt
      );

      const { response, modelUsed } = await fetchWithRetryAndFallback({
        ai,
        primaryModel,
        messages,
        generationConfig,
        maxRetries: 3,
        timeoutMs: 25000,
      });

      const text = response?.choices?.[0]?.message?.content ?? "";
      const { reply, emotion } = extractEmotion(text);

      const cleanReply = enforceHonorifics(deProgramify(reply));

      // TTS generation disabled: only speak on explicit user action (press in app)
      const maxTtsChars = Number(process.env.AI_TTS_MAX_CHARS || 800);
      const wantAutoTTS = false;
      let ttsPayload = null;

      function normalizeVNStrict(s = "") {
        return String(s)
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d")
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      // ===== Phân loại & tách triệu chứng =====
      const PSY_LEX = [
        "buon",
        "buon qua",
        "chan",
        "chan nan",
        "co don",
        "tu than",
        "lo lang",
        "so hai",
        "trong vang",
        "nho con",
        "khong ai noi chuyen",
        "khong ai quan tam",
        "met moi tinh than",
        "phien long",
        "vo dung",
        "that vong",
        "hut hang",
        "muon o mot minh",
        "cam thay co quanh",
        "cam thay buon",
        "nang long",
        "tui than",
        "chan doi",
        "khong vui",
        "khong muon lam gi",
        "so lam phien",
        "so con cai",
      ];
      const PHY_LEX = [
        "dau dau",
        "chong mat",
        "kho tho",
        "tuc nguc",
        "met nguoi",
        "met",
        "kho ngu",
        "khong ngu duoc",
        "mat ngu",
        "khong an duoc",
        "mat vi giac",
        "run tay",
        "dau khop",
        "dau lung",
        "choang",
        "buon non",
        "yeu nguoi",
        "ra mo hoi",
        "hoa mat",
        "huyet ap",
        "tim dap nhanh",
        "tim dap manh",
        "ngat",
        "bi sot",
        "lanh nguoi",
        "dau nhuc",
        "kho nuot",
        "khong nghe ro",
        "mat mo",
        "tang duong huyet",
        "ha duong huyet",
      ];

      const PHY_LABELS = {
        "dau dau": "Đau đầu",
        "chong mat": "Chóng mặt",
        "kho tho": "Khó thở",
        "tuc nguc": "Tức ngực",
        "met nguoi": "Mệt người",
        met: "Mệt",
        "kho ngu": "Khó ngủ",
        "khong ngu duoc": "Không ngủ được",
        "mat ngu": "Mất ngủ",
        "khong an duoc": "Không ăn được",
        "mat vi giac": "Mất vị giác",
        "run tay": "Run tay",
        "dau khop": "Đau khớp",
        "dau lung": "Đau lưng",
        choang: "Choáng",
        "buon non": "Buồn nôn",
        "yeu nguoi": "Yếu người",
        "ra mo hoi": "Ra mồ hôi",
        "hoa mat": "Hoa mắt",
        "huyet ap": "Huyết áp",
        "tim dap nhanh": "Tim đập nhanh",
        "tim dap manh": "Tim đập mạnh",
        ngat: "Ngất",
        "bi sot": "Bị sốt",
        "lanh nguoi": "Lạnh người",
        "dau nhuc": "Đau nhức",
        "kho nuot": "Khó nuốt",
        "khong nghe ro": "Không nghe rõ",
        "mat mo": "Mắt mờ",
        "tang duong huyet": "Tăng đường huyết",
        "ha duong huyet": "Hạ đường huyết",
      };

      const PSY_LABELS = {
        buon: "Buồn",
        "buon qua": "Buồn quá",
        chan: "Chán",
        "chan nan": "Chán nản",
        "co don": "Cô đơn",
        "tu than": "Tự than",
        "lo lang": "Lo lắng",
        "so hai": "Sợ hãi",
        "trong vang": "Trống vắng",
        "nho con": "Nhớ con",
        "khong ai noi chuyen": "Không ai nói chuyện",
        "khong ai quan tam": "Không ai quan tâm",
        "met moi tinh than": "Mệt mỏi tinh thần",
        "phien long": "Phiền lòng",
        "vo dung": "Vô dụng",
        "that vong": "Thất vọng",
        "hut hang": "Hụt hẫng",
        "muon o mot minh": "Muốn ở một mình",
        "cam thay co quanh": "Cảm thấy cô quạnh",
        "cam thay buon": "Cảm thấy buồn",
        "nang long": "Nặng lòng",
        "tui than": "Tủi thân",
        "chan doi": "Chán đời",
        "khong vui": "Không vui",
        "khong muon lam gi": "Không muốn làm gì",
        "so lam phien": "Sợ làm phiền",
        "so con cai": "Sợ con cái",
      };

      function detectDistressType(raw = "") {
        const q = normalizeVNStrict(raw);
        const phy = PHY_LEX.filter((k) => q.includes(k));
        const psy = PSY_LEX.filter((k) => q.includes(k));
        const hitPsy = psy.length > 0;
        const hitPhy = phy.length > 0;
        if (hitPsy && hitPhy)
          return { category: "mixed", alertType: "combined_alert", phy, psy };
        if (hitPsy)
          return {
            category: "psychological",
            alertType: "mental_alert",
            phy: [],
            psy,
          };
        if (hitPhy)
          return {
            category: "physical",
            alertType: "physical_alert",
            phy,
            psy: [],
          };
        return { category: null, alertType: null, phy: [], psy: [] };
      }

      function decideSeverityV2(em, raw) {
        const { category } = detectDistressType(raw);
        const risk = String(em?.riskLevel || "none").toLowerCase();
        const val = Number(em?.valence ?? 0.5);

        if (category === "mixed") return { severity: "high" };
        if (category === "psychological" || category === "physical") {
          if (val < 0.25) return { severity: "high" };
          return { severity: "medium" };
        }

        if (risk === "imminent" || risk === "crisis")
          return { severity: "critical" };
        if (risk === "high") return { severity: "high" };
        if (risk === "medium") return { severity: "medium" };
        if (val < 0.35) return { severity: "medium" };
        return { severity: "low" };
      }

      const det = detectDistressType(message);
      const { category, alertType } = det;
      const { severity } = decideSeverityV2(emotion, message);
      const safety = { category, alertType, severity, alerted: false };

      log("Decision:", {
        category,
        alertType,
        severity,
        riskLevel: emotion?.riskLevel,
        valence: emotion?.valence,
      });

      const shouldAlert =
        (category === "psychological" ||
          category === "physical" ||
          category === "mixed") &&
        (severity === "medium" ||
          severity === "high" ||
          severity === "critical");

      if (!(elderId && shouldAlert)) {
        log("WHY_NO_ALERT", {
          elderIdOk: !!elderId,
          category,
          severity,
          note: !elderId
            ? "Missing elderId (auth?)"
            : category
            ? `severity=${severity} < medium`
            : "No category detected from message",
        });
      }

      function formatSymptomLines(phyList = [], psyList = []) {
        const norm = (s) =>
          String(s)
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/đ/g, "d")
            .replace(/\s+/g, " ")
            .trim();

        const beautifyPhy = (raw) => {
          const key = norm(raw);
          return PHY_LABELS[key] || raw;
        };

        const beautifyPsy = (raw) => {
          const key = norm(raw);
          return PSY_LABELS[key] || raw;
        };

        const lines = [];
        if (phyList.length) {
          lines.push(
            `• Thể chất: ${phyList.map((x) => beautifyPhy(x)).join(", ")}`
          );
        }
        if (psyList.length) {
          lines.push(
            `• Tâm lý: ${psyList.map((x) => beautifyPsy(x)).join(", ")}`
          );
        }
        return lines.join("\n");
      }

      if (elderId && shouldAlert) {
        try {
          const relatives = await getRelativesForElder(elderId);
          const recipientIds = relatives.map((r) => r?._id).filter(Boolean);

          const estTokens = relatives
            .flatMap((u) => {
              const legacy = Array.isArray(u?.pushTokens) ? u.pushTokens : [];
              const fcmArr = Array.isArray(u?.fcmTokens)
                ? u.fcmTokens
                    .map((t) => (typeof t === "string" ? t : t?.token))
                    .filter(Boolean)
                : [];
              return [...legacy, ...fcmArr];
            })
            .filter(Boolean);

          log("Alert target:", {
            relatives: relatives.length,
            recipientIds: recipientIds.length,
            estTokens: estTokens.length,
          });
          if (estTokens.length)
            log(
              "Tokens last6:",
              estTokens.map((x) => String(x).slice(-6))
            );

          let elderName = "Người cao tuổi";
          try {
            if (User && elderId) {
              const elderUser = await User.findById(elderId).select("fullName");
              if (elderUser?.fullName) elderName = elderUser.fullName;
            }
          } catch (e) {
            log("Warn elder name lookup:", e?.message || e);
          }

          const relationLabel = "Người thân";

          const title =
            category === "physical"
              ? `❤️ Cảnh báo: ${relationLabel} của bạn, ${elderName}, có dấu hiệu sức khỏe bất thường`
              : category === "psychological"
              ? `💭 Cảnh báo: ${relationLabel} của bạn, ${elderName}, có dấu hiệu tâm lý tiêu cực`
              : `⚠️ Cảnh báo: ${relationLabel} của bạn, ${elderName}, có dấu hiệu bất thường (tâm lý & sinh lý)`;

          const symptomLines = formatSymptomLines(det.phy, det.psy);
          const advice =
            category === "physical"
              ? "Vui lòng liên hệ, hỏi thăm ngay. Nếu khó thở/tức ngực tăng, cân nhắc đưa đi kiểm tra y tế."
              : category === "psychological"
              ? "Hãy gọi điện trò chuyện, trấn an tinh thần và theo dõi cảm xúc trong hôm nay."
              : "Nên liên hệ sớm để kiểm tra cả sức khỏe thể chất và tinh thần.";

          const bodyParts = [
            symptomLines
              ? `Triệu chứng ghi nhận:\n${symptomLines}`
              : "Triệu chứng: chưa rõ ràng, cần theo dõi thêm.",
            `Gợi ý: ${advice}`,
          ];
          const body = bodyParts.join("\n");

          const notifDocs = await createDistressNotifications({
            elderId: elderId,
            recipientIds,
            severity,
            title,
            message: body,
            context: {
              reqId,
              modelUsed,
              emotion,
              category,
              alertType: alertType || "elder_distress",
              relationLabel,
              symptoms: { physical: det.phy, psychological: det.psy },
              chatSnippet: message.slice(0, 280),
            },
            channels: ["in_app", "push_notification"],
            expiresInHours: 72,
            groupKey: alertType || "elder_distress",
          });
          log("Notifications created:", { count: notifDocs?.length || 0 });

          const pushResp = await trySendPush({
            recipients: relatives,
            title,
            body,
            data: {
              type: alertType || "elder_distress",
              severity,
              reqId,
              elderName,
              relationLabel,
              category,
              symptomsPhysical: det.phy,
              symptomsPsychological: det.psy,
              deeplink: "ecare://alerts/center",
            },
          });
          log("FCM result:", pushResp);
          log("FCM raw:", JSON.stringify(pushResp || {}, null, 2));

          await markDeliveryResults(notifDocs, "push_notification", pushResp);

          safety.alerted = true;
          safety.alertInfo = {
            notifications: notifDocs.length,
            push: pushResp,
            relationLabel,
          };
        } catch (e) {
          log("Alert flow error:", e?.message || e);
        }
      }

      if (elderId) {
        try {
          await AIMessage.create({
            elder: elderId,
            sessionId,
            role: "assistant",
            content: cleanReply,
            modelUsed,
            listings:
              (Array.isArray(listings?.doctors) && listings.doctors.length) ||
              (Array.isArray(listings?.supporters) &&
                listings.supporters.length)
                ? listings
                : undefined,
          });
        } catch (e) {
          if (DEBUG) log("Save assistant message failed:", e?.message || e);
        }
      }

      const latencyMs = Date.now() - startedAt;

      return res.status(200).json({
        success: true,
        data: {
          reply: cleanReply,
          emotion,
          safety,
          listings,
          ...(ttsPayload ? { tts: ttsPayload } : {}),
        },
        ...(DEBUG
          ? { reqId, modelUsed, newTopic: dropHistory, tookMs: latencyMs }
          : {}),
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Không thể xử lý chat AI",
      });
    }
  },

  // =============== HISTORY API ===============
  history: async (req, res) => {
    try {
      const elderId = req.user?.userId || req.user?._id;
      const { sessionId, limit = 100, before } = req.query;
      if (!sessionId) {
        return res
          .status(400)
          .json({ success: false, message: "Thiếu sessionId" });
      }

      const query = {
        elder: elderId,
        sessionId,
        ...(before && { createdAt: { $lt: new Date(before) } }),
      };

      const messages = await AIMessage.find(query)
        .sort({ createdAt: 1 })
        .limit(+limit)
        .lean();

      return res.json({ success: true, data: messages });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err?.message || "Lỗi lấy lịch sử chat",
      });
    }
  },

  listSessions: async (req, res) => {
    const DEBUG = process.env.NODE_ENV !== "production";
    const reqId = Math.random().toString(36).slice(2, 8);
    try {
      const elderId = req.user?.userId || req.user?._id;
      if (!elderId) {
        return res.json({ success: true, data: [] });
      }

      const elderObjId = new mongoose.Types.ObjectId(String(elderId));

      const rows = await AIMessage.aggregate([
        { $match: { elder: elderObjId } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$sessionId",
            updatedAt: { $first: "$createdAt" },
            lastText: { $first: "$content" },
          },
        },
        {
          $project: {
            _id: 0,
            sessionId: "$_id",
            updatedAt: 1,
            lastText: 1,
          },
        },
        { $sort: { updatedAt: -1 } },
        { $limit: 100 },
      ]);

      return res.json({ success: true, data: rows || [] });
    } catch (err) {
      const msg = err?.message || String(err);
      console.error("[AI][listSessions][ERROR]:", msg);
      return res.status(500).json({ success: false, data: [] });
    }
  },

  createSession: async (req, res) => {
    const DEBUG = process.env.NODE_ENV !== "production";
    const reqId = Math.random().toString(36).slice(2, 10);
    const startedAt = Date.now();
    const log = (...args) => {
      if (DEBUG) console.log(`[AI][createSession][#${reqId}]`, ...args);
    };

    try {
      log("HEADERS.auth", req.headers?.authorization ? "present" : "missing");
      log("BODY", req.body);

      const elderId = req.user?.userId || req.user?._id || null;
      const { sessionId, title = "Cuộc trò chuyện mới" } = req.body || {};

      log("elderId", elderId, "sessionId", sessionId, "title", title);

      if (!sessionId) {
        log("FAIL: missing sessionId");
        return res
          .status(400)
          .json({ success: false, message: "Thiếu sessionId" });
      }

      if (!elderId) {
        log("WARN: elderId missing -> return soft success (no DB write)");
        return res.json({
          success: true,
          data: { sessionId, existed: true, note: "no_elder_attached" },
        });
      }

      try {
        const ready = !!(AIMessage?.db?.readyState >= 1);
        log("mongoose.readyState", AIMessage?.db?.readyState, "ready?", ready);
      } catch (e) {
        log("readyState check error:", e?.message || e);
      }

      const existed = await AIMessage.exists({ elder: elderId, sessionId });
      log("exists?", !!existed);
      if (existed) {
        const took = Date.now() - startedAt;
        log("DONE existed; took", took, "ms");
        return res.json({ success: true, data: { sessionId, existed: true } });
      }

      const doc = await AIMessage.create({
        elder: elderId,
        sessionId,
        role: "system",
        content:
          "👋 Chào mừng bạn đến với Trợ lý AI của E-Care! " +
          "Mình ở đây để lắng nghe và đồng hành cùng bạn. " +
          "Bạn có thể nhắn: “Tôi muốn gặp bác sĩ”, “Tôi cần người hỗ trợ”, hoặc kể vấn đề bạn đang gặp nhé.",
        modelUsed: "",
        meta: { type: "session_start", title },
      });

      const took = Date.now() - startedAt;
      log("INSERTED _id:", String(doc?._id), "took", took, "ms");
      return res.status(201).json({
        success: true,
        data: { sessionId, _id: doc?._id },
      });
    } catch (err) {
      const code = err?.code || err?.error?.code;
      const msg = err?.message || String(err);
      console.error(`[AI][createSession][#${reqId}] ERROR:`, {
        code,
        msg,
        stack: err?.stack,
      });

      if (code === 11000) {
        return res
          .status(409)
          .json({
            success: true,
            data: { sessionId: req?.body?.sessionId, existed: true },
          });
      }
      return res
        .status(500)
        .json({ success: false, message: msg || "Không tạo được phiên" });
    }
  },

  deleteSession: async (req, res) => {
    try {
      const elderId = req.user?.userId || req.user?._id;
      const { sessionId } = req.query;
      if (!sessionId)
        return res
          .status(400)
          .json({ success: false, message: "Thiếu sessionId" });
      await AIMessage.deleteMany({ elder: elderId, sessionId });
      return res.json({ success: true });
    } catch (e) {
      return res
        .status(500)
        .json({
          success: false,
          message: e?.message || "Không xoá được phiên",
        });
    }
  },

  // =============== TTS API ===============
  // AiController.textToSpeech
  textToSpeech: async (req, res) => {
    try {
      const { text, lang = "vi" } = req.body || {};
      if (!text || typeof text !== "string") {
        return res
          .status(400)
          .json({ success: false, message: "Thiếu hoặc sai `text`" });
      }

      const audioBuffer = await synthesizeToBuffer(text, lang);

      return res.status(200).json({
        success: true,
        data: {
          mime: "audio/mpeg", // nếu Zalo encode_type=1 (mp3)
          base64: audioBuffer.toString("base64"),
          length: audioBuffer.length,
        },
      });
    } catch (err) {
      console.error("[AI][TTS] ERROR:", err?.message || err);
      return res.status(500).json({
        success: false,
        message: err?.message || "Không tạo được TTS",
      });
    }
  },
};

module.exports = AiController;
