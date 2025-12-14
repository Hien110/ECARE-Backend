const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function transcribeBuffer({ buffer, fileName, language = "vi", model = "whisper-large-v3", mime = "audio/m4a" }) {
  const blob = new Blob([buffer], { type: mime });
  let fileObj = blob;
  try {
    fileObj = new File([blob], fileName || 'audio.m4a', { type: mime });
  } catch (_) { /* fallback blob ok */ }

  const resp = await groq.audio.transcriptions.create({
    file: fileObj,
    model,
    language,         
    response_format: "json", 
    temperature: 0
  });
  // Some transcription backends may include debug/log lines in the returned text.
  // Clean the text by removing obvious console/log lines and keep the human text.
  const rawText = resp && (resp.text || resp?.data || "") ? (resp.text || (typeof resp.data === 'string' ? resp.data : '')) : '';

  function cleanTranscribedText(t) {
    if (!t) return '';
    // Split into lines and drop lines that look like logs or stack traces
    const lines = String(t).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const filtered = lines.filter(l => {
      // drop lines that start with [TIMESTAMP] or [DEBUG] or contain 'console.' or 'stack' or 'Trace'
      if (/^\[?\d{2,4}[:\-\/\s\]\[]/.test(l)) return false;
      if (/\b(DEBUG|INFO|WARN|ERROR|TRACE)\b/i.test(l)) return false;
      if (/console\.|\bstack\b|\btrace\b|\bexception\b|npm ERR!|http:\/\//i.test(l)) return false;
      // drop lines that are just punctuation or separators
      if (/^[-=~]{2,}$/.test(l)) return false;
      // keep lines that have at least 3 letters (avoid short noise)
      const letterCount = (l.match(/\p{L}/gu) || []).length;
      if (letterCount < 3) return false;
      return true;
    });

    // If nothing left, fallback to original raw text with noise trimmed
    if (!filtered.length) return String(t).trim();
    return filtered.join(' ').trim();
  }

  const cleaned = cleanTranscribedText(rawText || resp?.text || '');
  return { text: cleaned, raw: resp };
}
module.exports = { transcribeBuffer };     