const Transcription = require("../models/Transcription");
const { transcribeBuffer } = require("../../utils/groq");

exports.create = async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) throw new Error("Audio file is required");

    const language = req.body.language || "vi";
    const resp = await transcribeBuffer({
      buffer: file.buffer,
      fileName: file.originalname,
      language
    });

    const doc = await Transcription.create({
      userId: req.user?._id, // nếu có auth
      fileName: file.originalname,
      fileMime: file.mimetype,
      durationSec: Number(req.body.durationSec || 0),
      language,
      text: resp.text || ""
    });

    res.json({
      id: doc._id,
      text: doc.text,
      language: doc.language,
      durationSec: doc.durationSec,
      createdAt: doc.createdAt
    });
  } catch (e) { next(e); }
};

exports.list = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const docs = await Transcription.find({ userId: req.user?._id })
      .sort({ createdAt: -1 }).limit(limit).lean();
    res.json(docs);
  } catch (e) { next(e); }
};

exports.show = async (req, res, next) => {
  try {
    const doc = await Transcription.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json(doc);
  } catch (e) { next(e); }
};