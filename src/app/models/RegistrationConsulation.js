const mongoose = require('mongoose');
const PAYMENT_METHOD = ['cash', 'bank_transfer'];
const ConsultationPrice = require('./ConsultationPrice');

const RegistrationConsulationSchema = new mongoose.Schema({
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  registrant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  beneficiary: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  registeredAt: { type: Date, default: Date.now },
  durationDays: { type: Number, default: 7 },
  status: {
    type: String,
    enum: [ 'confirmed', 'completed', 'cancelled'],
    default: 'confirmed', 
  },
  note: { type: String, default: '' },
  slot: {
    type: String,
    enum: ['morning', 'afternoon'],
    required: true,
  },
  scheduledDate: {
    type: Date,
    required: true,
  },

  paymentMethod: {
      type: String,
      enum: PAYMENT_METHOD,
      default: 'cash',
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded'],
      default: 'unpaid',
    },
    price: {
      type: Number,
      min: 0,
    },
    cancelReason: { type: String, default: '' },
}, { timestamps: true });
module.exports = mongoose.model('RegistrationConsulation', RegistrationConsulationSchema);
