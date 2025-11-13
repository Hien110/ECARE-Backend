// models/SupporterService.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const SESSION_SLOTS = ["morning", "afternoon", "evening"];

const supporterServiceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    isActive: { type: Boolean, default: true },

    // Thuê theo buổi
    bySession: {
      enabled: { type: Boolean, default: true },
      morning: { type: Number, min: 0, default: 0 },
      afternoon: { type: Number, min: 0, default: 0 },
      evening: { type: Number, min: 0, default: 0 },
    },

    // Thuê theo ngày
    byDay: {
      enabled: { type: Boolean, default: false },
      dailyFee: { type: Number, min: 0, default: 0 },
    },

    // Thuê theo tháng (chọn buổi làm trong ngày)
    byMonth: {
      enabled: { type: Boolean, default: false },
      monthlyFee: { type: Number, min: 0, default: 0 },

      /**
       * Các buổi làm việc trong 1 ngày của gói tháng:
       * - ["morning"]                 → chỉ sáng
       * - ["afternoon"]               → chỉ chiều
       * - ["evening"]                 → chỉ tối
       * - ["morning","afternoon"]     → sáng + chiều
       * - ["afternoon","evening"]     → chiều + tối
       * - ["morning","evening"]       → sáng + tối
       * - ["morning","afternoon","evening"] → cả ngày
       */
      sessionsPerDay: {
        type: [{ type: String, enum: SESSION_SLOTS }],
        default: [], // rỗng = chưa cấu hình, FE/BE nên buộc admin chọn
        validate: {
          validator: function (arr) {
            // đảm bảo không trùng phần tử
            return Array.isArray(arr) && new Set(arr).size === arr.length;
          },
          message: "sessionsPerDay có phần tử trùng lặp.",
        },
      },
    },
  },
  { timestamps: true }
);

// Virtual: kiểm tra gói tháng có phải cả ngày không
supporterServiceSchema.virtual("byMonthIsFullDay").get(function () {
  return (
    this.byMonth?.enabled === true &&
    Array.isArray(this.byMonth?.sessionsPerDay) &&
    this.byMonth.sessionsPerDay.length === 3
  );
});

module.exports = mongoose.model("SupporterService", supporterServiceSchema);
