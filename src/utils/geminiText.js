const axios = require("axios");
const { getValidTextKey } = require("./apiKeyPool");

// Default Gemini text-only model; can be overridden by caller
const DEFAULT_MODEL = "gemini-1.5-flash";

/**
 * Generate text with Gemini (Generative Language API, text-only).
 * Uses getValidTextKey() pool rotation and returns { success, text, raw, error }.
 *
 * @param {Object} params
 * @param {string} params.userPrompt - The user message to send
 * @param {string} [params.systemPrompt] - Optional system instruction
 * @param {string} [params.model] - Gemini model, defaults to gemini-1.5-flash
 * @param {number} [params.timeoutMs] - Axios timeout, default 15000
 */
async function generateTextWithGemini({
  userPrompt,
  systemPrompt = "You are a helpful assistant.",
  model = DEFAULT_MODEL,
  timeoutMs = 15000,
}) {
  if (!userPrompt || typeof userPrompt !== "string") {
    return { success: false, error: "Missing userPrompt" };
  }

  // Try a few keys from the pool
  const attempts = [];
  for (let i = 0; i < 4; i++) {
    const apiKey = getValidTextKey();
    if (!apiKey) {
      attempts.push("no_key");
      break;
    }
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const body = {
        contents: [
          {
            parts: [
              { text: systemPrompt },
              { text: userPrompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
          responseMimeType: "text/plain",
        },
      };

      const resp = await axios.post(url, body, { timeout: timeoutMs });
      const text =
        resp?.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        resp?.data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join("\n");

      if (!text) throw new Error("Empty response from Gemini");
      return { success: true, text, raw: resp.data };
    } catch (err) {
      const code = err?.response?.status;
      const detail = err?.response?.data || err.message;
      const message = err?.message || (typeof detail === 'string' ? detail : undefined);
      let reason;
      switch (code) {
        case 400:
          reason = 'location_not_supported_failed_precondition';
          break;
        case 401:
          reason = 'unauthorized_or_api_disabled';
          break;
        case 403:
          reason = 'forbidden_key_restriction_or_access_denied';
          break;
        case 429:
          reason = 'quota_exceeded_rate_limited';
          break;
        default:
          reason = 'other_error';
      }
      attempts.push({ code, reason, detail });
      console.error('[Gemini Text] attempt failed', { idx: i, code, reason, message, detail });
      if (code === 429 || code === 403) continue; // rotate keys
      if (code === 401 || code === 400) break; // invalid or unsupported location
      break; // other errors
    }
  }

  return { success: false, error: 'Gemini text call failed', attempts };
}

module.exports = { generateTextWithGemini };
