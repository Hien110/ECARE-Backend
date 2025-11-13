const crypto = require('crypto');

const ENC_KEY = Buffer.from(process.env.ENC_KEY, 'base64');  
const HMAC_KEY = Buffer.from(process.env.HMAC_KEY, 'base64'); 
if (ENC_KEY.length !== 32) throw new Error('ENC_KEY must be 32 bytes (base64 of 32B).');
if (HMAC_KEY.length !== 32) throw new Error('HMAC_KEY must be 32 bytes (base64 of 32B).');

function encryptGCM(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const b64 = (buf) => buf.toString('base64url');
  return `${b64(iv)}.${b64(tag)}.${b64(enc)}`;
}

function decryptGCM(packed) {
  if (!packed) return null;
  const [ivB64, tagB64, dataB64] = String(packed).split('.');
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

function hmacIndex(value) {
  if (value == null) return null;
  const h = crypto.createHmac('sha256', HMAC_KEY);
  h.update(String(value), 'utf8');
  return h.digest('hex'); 
}

function normalizePhoneVN(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/\D/g, '');
  // 0xxxxxxxxx -> +84xxxxxxxxx
  if (s.startsWith('0')) s = '84' + s.slice(1);
  if (s.startsWith('84') === false) s = '84' + s; // ép VN nếu app chỉ VN
  return s;
}

module.exports = { encryptGCM, decryptGCM, hmacIndex, normalizePhoneVN };