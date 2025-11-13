const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  fileName: String,
  fileMime: String,
  durationSec: Number,
  language: { type: String, default: "vi" },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });
module.exports = mongoose.model("Transcription", schema);