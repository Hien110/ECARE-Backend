// models/SupporterService.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const supporterServiceSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    description: {
      type: String, 
      default: "",
      trim: true
    },
    price: {
      type: Number,
      required: true,
      min: 0,
      index: true
    },
    numberOfDays: {
      type: Number,
      required: true,
      min: 7
    },
  },
  { timestamps: true }
);

// Tạo index composite cho tìm kiếm nhanh
supporterServiceSchema.index({ name: 1, price: 1 });

module.exports = mongoose.model("SupporterService", supporterServiceSchema);
