const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const encryptFieldsPlugin = require('./plugins/encryptFields.plugin');
const { normalizePhoneVN } = require('../../utils/cryptoFields');

const userSchema = new mongoose.Schema({


  password: { type: String, required: true, minlength: 6, select: false },

  role: { type: String, enum: ['elderly','family','supporter','doctor','admin'], required: true },

  fullName: { type: String, required: true, trim: true },
  gender: { type: String, enum: ['male','female','other'], required: true },

  avatar: {
    type: String,
    default: 'https://cdn.sforum.vn/sforum/wp-content/uploads/2023/10/avatar-trang-4.jpg',
  },

  dateOfBirth: { type: Date },


  currentAddress: { type: String },  // địa chỉ tạm trú
  currentLocation: {
    type: {
      type: String,
      enum: ["Point"],
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
    }
  }, // tọa độ địa chỉ tạm trú


  coordinates: { latitude: Number, longitude: Number },

  isActive: { type: Boolean, default: true },

  otp: {
    code: String,
    expiresAt: Date,
  },

  lastLogin: Date,

  // FCM tokens for push notifications
  fcmTokens: [{
    token: {
      type: String,
      required: true
    },
    deviceInfo: {
      type: String,
      default: 'Unknown device'
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    lastUsed: {
      type: Date,
      default: Date.now
    }
  }],
}, { timestamps: true });

// Áp plugin cho 4 field
userSchema.plugin(encryptFieldsPlugin, {
  fields: ['phoneNumber', 'email', 'address', 'identityCard'],
  uniqueByHmac: [ , 'identityCard'],
});

userSchema.path('phoneNumberEnc'); // force path init
userSchema.virtual('phoneNumberRaw')
  .set(function (val) {
    // setter phụ nếu bạn muốn ép VN format rồi set vào phoneNumber
    const normalized = normalizePhoneVN(val);
    this.phoneNumber = normalized;
  });

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};


userSchema.index({ currentLocation: "2dsphere" });

// Ensure virtual fields are included in JSON output
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('User', userSchema);
