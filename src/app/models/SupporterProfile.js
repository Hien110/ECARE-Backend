const mongoose = require("mongoose");

const supporterProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    experience: {
      totalYears: Number,
      description: String,
    },
    // Phạm vi hoạt động
    serviceArea: {
      type: Number,
      default: 10, // km
      max: 50,
    },
    // Thống kê đánh giá (tự động tính từ bảng Rating)
    ratingStats: {
      averageRating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
      },
      totalRatings: {
        type: Number,
        default: 0,
      },
      lastRatingAt: Date,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("SupporterProfile", supporterProfileSchema);
