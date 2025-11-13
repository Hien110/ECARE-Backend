const mongoose = require('mongoose');

const healthRecordSchema = new mongoose.Schema({
  elderly: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recordDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  // Chỉ số sức khỏe
  vitals: {
    bloodPressure: {
      systolic: Number,  // Tâm thu
      diastolic: Number, // Tâm trương
      unit: {
        type: String,
        default: 'mmHg'
      }
    },
    heartRate: {
      value: Number,
      unit: {
        type: String,
        default: 'bpm'
      }
    },
    bloodSugar: {
      value: Number,
      unit: {
        type: String,
        default: 'mg/dL'
      },
      measurementTime: {
        type: String,
        enum: ['fasting', 'after_meal', 'random']
      }
    },
    weight: {
      value: Number,
      unit: {
        type: String,
        default: 'kg'
      }
    },
    height: {
      value: Number,
      unit: {
        type: String,
        default: 'cm'
      }
    },
    bmi: {
      value: Number,
      category: {
        type: String,
        enum: ['underweight', 'normal', 'overweight', 'obese']
      }
    },
    temperature: {
      value: Number,
      unit: {
        type: String,
        default: '°C'
      }
    }
  },
  // Cảm xúc và tâm trạng
  emotional: {
    moodScore: {
      type: Number,
      min: 1,
      max: 10 // 1 = rất buồn, 10 = rất vui
    },
    stressLevel: {
      type: Number,
      min: 1,
      max: 10
    },
    anxietyLevel: {
      type: Number,
      min: 1,
      max: 10
    },
    sleepQuality: {
      type: Number,
      min: 1,
      max: 10
    },
    sleepHours: Number,
    notes: String, // Ghi chú cảm xúc
    sentiment: {
      type: String,
      enum: ['positive', 'negative', 'neutral'],
      default: 'neutral'
    }
  },
  // Hoạt động hàng ngày
  activities: {
    exerciseMinutes: Number,
    exerciseType: String,
    waterIntake: Number, // Lít nước
    medicationTaken: [{
      medicationName: String,
      timeTaken: Date,
      dosage: String,
      takenAsScheduled: Boolean
    }]
  },
  // Ghi chú bổ sung
  notes: String,
  // Cảnh báo tự động
  alerts: [{
    type: String,
    level: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical']
    },
    message: String,
    isResolved: {
      type: Boolean,
      default: false
    }
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('HealthRecord', healthRecordSchema);
