const mongoose = require('mongoose');

const ConsultationSummarySchema = new mongoose.Schema(
  {
    registration: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RegistrationConsulation',
      required: true,
      unique: true,
    },

    mainDisease: { type: String, default: '' },

    medications: { type: String, default: '' },

    mobility: {
      type: String,
      default: '',
    },
    bathing: {
      type: String,
      default: '',
    },
    feeding: {
      type: String,
      default: '',
    },

    
    systolic: { type: Number, min: 0 }, 
    diastolic: { type: Number, min: 0 }, 
    pulse: { type: Number, min: 0 }, 
    weight: { type: Number, min: 0 },
    bloodSugar: { type: String, default: '' },

    note: { type: String, default: '' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('ConsultationSummary', ConsultationSummarySchema);
