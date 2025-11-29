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
  return resp;
}
module.exports = { transcribeBuffer };     