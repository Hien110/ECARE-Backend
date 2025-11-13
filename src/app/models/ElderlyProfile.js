const mongoose = require("mongoose");

const elderlyProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    // Thông tin sức khỏe
    healthInfo: {
      bloodType: {
        type: String,
        enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
      },
      chronicDiseases: [String], // Các bệnh nền
    },
    healthSettings: {
      dailyHealthReminder: {
        enabled: { type: Boolean, default: true },
        time: { type: String, default: "08:00" }, // giờ mặc định 8h sáng
      },
      medicationReminder: {
        enabled: { type: Boolean, default: true },
        times: [{ type: String }], // danh sách giờ uống thuốc: ["06:30", "12:30", "20:00"]
      },
      exerciseReminder: {
        enabled: { type: Boolean, default: false },
        frequency: {
          type: String,
          enum: ["daily", "weekly"],
          default: "daily",
        },
        time: { type: String, default: "18:00" }, // mặc định 6h chiều
      },
    },
    safetyMonitoring: {
      deadmanConfig: {
        enabled:         { type: Boolean, default: true },        
        dailyCutoff:     { type: String,  default: "12:00" },     
        remindAfterMins: { type: Number,  default: 15, min: 0, max: 1440 },
        alertAfterMins:  { type: Number,  default: 45, min: 0, max: 1440 },
        timezone:        { type: String,  default: "Asia/Ho_Chi_Minh" },
      },
      deadmanState: {
        snoozeUntil:     { type: Date, default: null },  
        lastCheckinAt:   { type: Date, default: null },  
        lastReminderAt:  { type: Date, default: null },  
        lastAlertAt:     { type: Date, default: null },  
      },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ElderlyProfile", elderlyProfileSchema);
