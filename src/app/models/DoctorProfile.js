const mongoose = require("mongoose");

const doctorProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    // Thông tin chuyên môn
    specialization: {
      type: String
    },
    // Kinh nghiệm
    experience: {
      type: Number,
      required: true,
    },

    description: {
      type: String,
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
    // Thống kê
    stats: {
      totalConsultations: {
        type: Number,
        default: 0,
      }
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("DoctorProfile", doctorProfileSchema);
