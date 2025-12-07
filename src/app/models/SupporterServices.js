// models/SupporterService.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const supporterServiceSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String, 
      default: "",
      trim: true
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    numberOfDays: {
      type: Number,
      required: true,
      min: 7
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SupporterService", supporterServiceSchema);
