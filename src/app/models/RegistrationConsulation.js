const mongoose = require('mongoose');

const RegistrationConsulationSchema = new mongoose.Schema({
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  registrant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  beneficiary: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  registeredAt: { type: Date, default: Date.now },
  durationDays: { type: Number, default: 0 },
  price: { type: Number, min: 0 },
  doctorNote: { type: String },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'],
    default: 'pending',
  },
}, { timestamps: true });

module.exports = mongoose.model('RegistrationConsulation', RegistrationConsulationSchema);
