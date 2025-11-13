const mongoose = require('mongoose');
const { Schema } = mongoose;


const AIMessageSchema = new Schema(
  {
    elder: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    sessionId: { type: String, required: true, index: true },

    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },

    content: { type: String, required: true, trim: true },

    modelUsed: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AIMessage', AIMessageSchema);
