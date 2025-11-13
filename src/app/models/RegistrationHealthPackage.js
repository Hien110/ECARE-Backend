const mongoose = require('mongoose');

const RegistrationHealthPackageSchema = new mongoose.Schema({
  packageRef: { type: mongoose.Schema.Types.ObjectId, ref: 'HealthPackage', required: true },

  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  registrant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  beneficiary: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  registeredAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },

  // thời hạn/ngày hết hạn cho đăng ký cụ thể này (có thể sao chép từ gói)
  durationDays: { type: Number, default: 0 },
  expiresAt: { type: Date },

  // giá thực tế tính cho đăng ký này (có thể thay thế giá gói)
  price: { type: Number, min: 0 },

  description: { type: String },
}, { timestamps: true });

// nếu durationDays được cung cấp hoặc suy ra, hãy tính expiresAt trước khi lưu
RegistrationHealthPackageSchema.pre('save', async function (next) {
  try {
    // nếu durationDays không được thiết lập nhưng packageRef tồn tại, hãy thử đọc thời lượng gói
    if ((!this.durationDays || this.durationDays === 0) && this.packageRef) {
      // attempt to populate package duration - kiểm tra xem model đã được đăng ký chưa
      let HealthPackage;
      try {
        HealthPackage = mongoose.model('HealthPackage');
      } catch (err) {
        // Nếu model chưa được đăng ký, thử require lại
        try {
          require('./HealthPackage');
          HealthPackage = mongoose.model('HealthPackage');
        } catch (requireErr) {
          console.warn('⚠️ [RegistrationHealthPackage] Không thể load HealthPackage model:', requireErr.message);
          return next();
        }
      }
      
      const pkg = await HealthPackage.findById(this.packageRef).select('durationDays price').lean();
      if (pkg) {
        if (!this.durationDays) this.durationDays = pkg.durationDays || 0;
        if (this.price == null) this.price = pkg.price;
      }
    }

    if ((!this.expiresAt || this.isModified && this.isModified('durationDays') || this.isModified('registeredAt')) && this.durationDays) {
      const base = this.registeredAt ? new Date(this.registeredAt) : new Date();
      const expires = new Date(base.getTime());
      expires.setDate(expires.getDate() + Number(this.durationDays));
      this.expiresAt = expires;
    }
  } catch (err) {
    // ignore errors here; validation can catch later
  }
  next();
});

module.exports = mongoose.model('RegistrationHealthPackage', RegistrationHealthPackageSchema);
