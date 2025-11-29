// utils/tts.js
const axios = require('axios');
const { getGroqClient } = require('./groqClient');

const ZALO_TTS_ENDPOINT =
  process.env.ZALO_TTS_ENDPOINT || 'https://api.zalo.ai/v1/tts/synthesize';
const ZALO_TTS_API_KEY = process.env.ZALO_TTS_API_KEY || '';

async function tryZaloTTS(text, lang = 'vi', slow = false, opts = {}) {
  if (!ZALO_TTS_API_KEY) throw new Error('Missing ZALO_TTS_API_KEY');

  const speakerId = opts.speakerId || Number(process.env.ZALO_TTS_SPEAKER_ID || '') || 1;
  const speed = typeof opts.speed === 'number' ? opts.speed : slow ? 0.8 : 1.0;
  const quality = typeof opts.quality === 'number' ? opts.quality : Number(process.env.ZALO_TTS_QUALITY ?? 1);
  const encodeType = typeof opts.encode_type === 'number' ? opts.encode_type : Number(process.env.ZALO_TTS_ENCODE_TYPE ?? 0);

  const body = new URLSearchParams();
  body.append('input', text);
  body.append('speaker_id', String(speakerId));
  body.append('speed', String(speed));
  if (!Number.isNaN(quality)) body.append('quality', String(quality));
  if (!Number.isNaN(encodeType)) body.append('encode_type', String(encodeType));

  const resp = await axios.post(ZALO_TTS_ENDPOINT, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', apikey: ZALO_TTS_API_KEY },
    timeout: opts.timeoutMs || 15000,
  });
  const payload = resp?.data;
  if (!payload || payload.error_code !== 0 || !payload.data?.url) {
    const code = payload?.error_code;
    const msg = payload?.message || 'Unknown Zalo TTS error';
    throw new Error(`Zalo TTS failed: ${code} ${msg}`);
  }
  const audioUrl = payload.data.url;
  const audioResp = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: opts.timeoutMs || 15000 });
  return Buffer.from(audioResp.data);
}

function toBufferFromGroqResponse(resp) {
  if (!resp) throw new Error('Empty Groq TTS response');
  if (typeof resp.arrayBuffer === 'function') return resp.arrayBuffer().then((ab) => Buffer.from(ab));
  if (resp.data && (resp.data instanceof ArrayBuffer || ArrayBuffer.isView(resp.data))) {
    const ab = resp.data.buffer ? resp.data.buffer : resp.data;
    return Buffer.from(ab);
  }
  if (typeof resp.content === 'string') return Buffer.from(resp.content, 'base64');
  if (resp.audio) {
    const b64 = resp.audio?.data || resp.audio?.content || null;
    if (b64) return Buffer.from(b64, 'base64');
  }
  if (Buffer.isBuffer(resp)) return resp;
  throw new Error('Unsupported Groq TTS response');
}

async function tryGroqTTS(text, opts = {}) {
  const ai = await getGroqClient();
  const hasApi = ai && ai.audio && ai.audio.speech && typeof ai.audio.speech.create === 'function';
  if (!hasApi) throw new Error('Groq TTS unavailable');
  const response_format = opts.format || process.env.AI_TTS_FORMAT || 'mp3';
  const preferredVoice = opts.voice || process.env.AI_TTS_VOICE || 'alloy';
  const candidates = (process.env.AI_TTS_CANDIDATES || 'playai-tts,xtts-1')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  let lastErr;
  for (const model of candidates) {
    try {
      const resp = await ai.audio.speech.create({ model, voice: preferredVoice, input: text, response_format });
      return toBufferFromGroqResponse(resp);
    } catch (e) {
      lastErr = e;
      const msg = e?.message || '';
      const code = e?.code || e?.error?.code || '';
      const retriable = /terms acceptance|not found|unsupported|invalid/i.test(msg) || /model_(?:terms_required|not_found)/i.test(code);
      if (!retriable) throw e;
      continue;
    }
  }
  throw lastErr || new Error('No Groq TTS model succeeded');
}

async function tryGoogleTranslateTTS(text, lang = 'vi', slow = false, opts = {}) {
  // Unofficial Google Translate TTS endpoint as a last resort
  const host = 'https://translate.google.com';
  const params = new URLSearchParams({
    ie: 'UTF-8',
    q: text,
    tl: lang || 'vi',
    client: 'tw-ob',
    ttsspeed: slow ? '0.8' : '1',
  });
  const url = `${host}/translate_tts?${params.toString()}`;
  const resp = await axios.get(url, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: opts.timeoutMs || 15000 });
  return Buffer.from(resp.data);
}

/**
 * @param {string} text
 * @param {string} lang
 * @param {boolean} slow
 * @param {object} opts
 */
async function synthesizeToBuffer(text, lang = 'vi', slow = false, opts = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Invalid text input for TTS');
  }

  const prefer = (process.env.AI_TTS_ORDER || 'zalo,groq,google')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const errors = [];
  for (const p of prefer) {
    try {
      if (p === 'zalo') return await tryZaloTTS(text, lang, slow, opts);
      if (p === 'groq') return await tryGroqTTS(text, opts);
      if (p === 'google') return await tryGoogleTranslateTTS(text, lang, slow, opts);
    } catch (e) {
      errors.push(`${p}: ${e?.message || e}`);
      continue;
    }
  }
  const msg = errors.length ? `All TTS providers failed -> ${errors.join(' | ')}` : 'No TTS providers configured';
  throw new Error(msg);
}

module.exports = { synthesizeToBuffer };
