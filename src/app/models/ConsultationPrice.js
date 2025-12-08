const mongoose = require('mongoose');

    const ConsultationPriceSchema = new mongoose.Schema(
    {
        serviceName: {
        type: String,
        required: true,
        unique: true,
        default: 'doctor_consultation',
        },
        price: {
        type: Number,
        required: true,
        min: 0,
        default: 200000,
        },
        isActive: {
        type: Boolean,
        default: true,
        },
        decripton: {
        type: String,
        default: 'Giá khám bệnh sức khỏe ',
        },
    },
    { timestamps: true },
    );
const ConsultationPrice = mongoose.model('ConsultationPrice', ConsultationPriceSchema);

ConsultationPrice.ensureDefault = async function ensureDefault() {
  const existing = await this.findOne({ serviceKey: 'doctor_consultation' });
  if (existing) return existing;

  const doc = new this({ serviceKey: 'doctor_consultation' });
  await doc.save();
  return doc;
};

module.exports = ConsultationPrice;
