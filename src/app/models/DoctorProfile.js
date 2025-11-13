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
    specializations: {
      type: String,
      required: true,
    },
    // Kinh nghiệm
    experience: {
      type: Number,
      required: true,
    },
    // Nơi làm việc hiện tại
    hospitalName: {
      type: String,
      required: true,
    },
    // Lịch làm việc và tư vấn
    schedule: [
      {
        dayOfWeek: {
          type: Number,
          required: true,
          min: 2,
          max: 8,
        },
        timeSlots: [
          {
            start: {
              type: String,
              required: true,
            },
            end: {
              type: String,
              required: true,
            },
            consultationType: {
              type: String,
              enum: ["online", "offline", "both"],
              required: true,
            },
            timeForOnline: {
              type: Number,
            },
            timeForOffline: {
              type: Number,
            },
            isAvailable: {
              type: Boolean,
              default: true,
            },
          },
        ],
      },
    ],
    // Phí tư vấn
    consultationFees: {
      online: {
        type: Number,
        required: true,
      },
      offline: {
        type: Number,
        required: true,
      },
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
      },
      totalPatients: {
        type: Number,
        default: 0,
      },
      averageConsultationDuration: Number, // phút
      totalEarnings: {
        type: Number,
        default: 0,
      },
      lastConsultationDate: Date,
    },
    // Cài đặt tư vấn
    consultationDuration: {
      type: Number,
      default: 30, // phút
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("DoctorProfile", doctorProfileSchema);
