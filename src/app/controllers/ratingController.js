const Rating = require("../models/Rating");
const SupporterProfile = require("../models/SupporterProfile");
const SupporterScheduling = require("../models/SupporterScheduling");

const RatingController = {
  // tạo đánh giá dịch vụ hỗ trợ
  createRatingSupportService: async (req, res) => {
    try {
      const {
        reviewer,
        reviewee,
        rating,
        comment,
        serviceSupportId,
      } = req.body;
      const authUserId = req.user?.userId?.toString() || reviewer?.toString();
      if (!authUserId) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      if (!serviceSupportId) {
        return res.status(400).json({
          success: false,
          message: "Thiếu serviceSupportId cho lịch hỗ trợ",
        });
      }

      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({
          success: false,
          message: "rating phải trong khoảng 1..5",
        });
      }

      const scheduling = await SupporterScheduling.findById(serviceSupportId).lean();
      if (!scheduling) {
        return res
          .status(404)
          .json({ success: false, message: "Không tìm thấy lịch hỗ trợ" });
      }

      if (scheduling.status !== "completed") {
        return res.status(400).json({
          success: false,
          message: "Chỉ được đánh giá khi lịch hỗ trợ đã hoàn thành",
        });
      }

      if (scheduling.registrant?.toString() !== authUserId) {
        return res.status(403).json({
          success: false,
          message: "Chỉ người đã đặt lịch mới được đánh giá dịch vụ này",
        });
      }

      const existing = await Rating.findOne({
        reviewer: authUserId,
        serviceSupportId,
        ratingType: "support_service",
        status: { $ne: "deleted" },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Bạn đã đánh giá dịch vụ hỗ trợ này rồi",
        });
      }

      const reviewerId = authUserId;
      const revieweeId = (reviewee || scheduling.supporter)?.toString();
      const ratingType = "support_service";

      const newRating = new Rating({
        reviewer: reviewerId,
        reviewee: revieweeId,
        ratingType,
        rating,
        comment,
        serviceSupportId,
      });
      await newRating.save();

      // Cập nhập tổng đánh giá và điểm trung bình trong SupporterProfile
      const supporterProfile = await SupporterProfile.findOne({
        user: revieweeId,
      });
      if (supporterProfile) {
        const totalRatings = supporterProfile.ratingStats.totalRatings + 1;
        const totalRatingScore =
          supporterProfile.ratingStats.averageRating *
            supporterProfile.ratingStats.totalRatings +
          rating;
        const averageRating = totalRatingScore / totalRatings;
        supporterProfile.ratingStats.totalRatings = totalRatings;
        supporterProfile.ratingStats.averageRating = averageRating;
        supporterProfile.ratingStats.lastRatingAt = new Date();
        await supporterProfile.save();
      }

      res.status(201).json({ success: true, data: newRating });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: "Error creating rating", error });
    }
  },

  // Lấy đánh giá theo Id dịch vụ hỗ trợ và người đánh giá
  getRatingsByServiceSupportIdAndReviewer: async (req, res) => {
    try {
      const serviceSupportId = req.params.serviceSupportId;
      const reviewer = req.params.reviewer;

      const ratings = await Rating.find({
        serviceSupportId: serviceSupportId,
        reviewer: reviewer,
        status: "active",
      })
        .populate("reviewer")
        .sort({ ratedAt: -1 });

      console.log("rating", serviceSupportId, ratings);

      res.status(200).json({ success: true, data: ratings });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: "Error retrieving ratings", error });
    }
  },

  // Chỉnh sửa: Lấy đánh giá theo Id người dùng được đánh giá
  updateRatingById: async (req, res) => {
    try {
      const ratingId = req.params.ratingId;
      const { rating, comment } = req.body;
      const updatedRating = await Rating.findByIdAndUpdate(
        ratingId,
        { rating, comment },
        { new: true }
      );
      if (!updatedRating) {
        return res
          .status(404)
          .json({ success: false, message: "Rating not found" });
      }

      // Cập nhập tổng đánh giá và điểm trung bình trong SupporterProfile
      const reviewee = updatedRating.reviewee;
      const ratingType = updatedRating.ratingType;
      if (ratingType === "support_service") {
        const supporterProfile = await SupporterProfile.findOne({
          user: reviewee,
        });
        if (supporterProfile) {
          const ratings = await Rating.find({
            reviewee: reviewee,
            ratingType: "support_service",
            status: "active",
          });
          const totalRatings = ratings.length;
          const totalRatingScore = ratings.reduce(
            (sum, r) => sum + r.rating,
            0
          );
          const averageRating =
            totalRatings > 0 ? totalRatingScore / totalRatings : 0;
          supporterProfile.ratingStats.totalRatings = totalRatings;
          supporterProfile.ratingStats.averageRating = averageRating;
          supporterProfile.ratingStats.lastRatingAt = new Date();
          await supporterProfile.save();
        }
      }
      res.status(200).json({ success: true, data: updatedRating });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: "Error updating rating", error });
    }
  },

  // Xóa: Lấy đánh giá theo Id người dùng được đánh giá
  deleteRatingById: async (req, res) => {
    try {
      const ratingId = req.params.ratingId;
      const deletedRating = await Rating.findByIdAndUpdate(
        ratingId,
        { status: "deleted" },
        { new: true }
      );
      if (!deletedRating) {
        return res
          .status(404)
          .json({ success: false, message: "Rating not found" });
      }

      // Cập nhập tổng đánh giá và điểm trung bình trong SupporterProfile
      const reviewee = deletedRating.reviewee;
      const ratingType = deletedRating.ratingType;
      if (ratingType === "support_service") {
        const supporterProfile = await SupporterProfile.findOne({
          user: reviewee,
        });
        if (supporterProfile) {
          const ratings = await Rating.find({
            reviewee: reviewee,
            ratingType: "support_service",
            status: "active",
          });
          const totalRatings = ratings.length;
          const totalRatingScore = ratings.reduce(
            (sum, r) => sum + r.rating,
            0
          );
          const averageRating =
            totalRatings > 0 ? totalRatingScore / totalRatings : 0;
          supporterProfile.ratingStats.totalRatings = totalRatings;
          supporterProfile.ratingStats.averageRating = averageRating;
          supporterProfile.ratingStats.lastRatingAt = new Date();
          await supporterProfile.save();
        }
      }
      res.status(200).json({ success: true, data: deletedRating });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: "Error deleting rating", error });
    }
  },

  getRatingsByUserId: async (req, res) => {
    try {
      const userId = req.params.userId;
      const ratings = await Rating.find({ reviewee: userId, status: "active" })
        .populate("reviewer", "fullName avatar")
        .sort({ ratedAt: -1 });
      res.status(200).json({ success: true, data: ratings });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: "Error retrieving ratings", error });
    }
  },

  // Lấy đánh giá theo Id lịch khám tư vấn
  getRatingByConsultationId: async (req, res) => {
    try {
      const { consultationId } = req.params;

      if (!consultationId) {
        return res.status(400).json({
          success: false,
          message: "Thiếu consultationId"
        });
      }

      const rating = await Rating.findOne({
        serviceConsultationId: consultationId,
        ratingType: "consultation",
        status: "active"
      })
        .populate("reviewer", "fullName avatar email phone")
        .populate("reviewee", "fullName avatar")
        .lean();

      if (!rating) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy đánh giá cho lịch khám này"
        });
      }

      res.status(200).json({ success: true, data: rating });
    } catch (error) {
      console.error("Error retrieving consultation rating:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi lấy đánh giá",
        error: error.message
      });
    }
  },

  // Lấy đánh giá theo Id lịch hỗ trợ
  getRatingSupportServiceById: async (req, res) => {
    try {
      const { serviceSupportId } = req.params;

      if (!serviceSupportId) {
        return res.status(400).json({
          success: false,
          message: "Thiếu serviceSupportId"
        });
      }

      const rating = await Rating.findOne({
        serviceSupportId: serviceSupportId,
        ratingType: "support_service",
        status: "active"
      })
        .populate("reviewer", "fullName avatar email phone")
        .populate("reviewee", "fullName avatar")
        .lean();

      if (!rating) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy đánh giá cho lịch hỗ trợ này"
        });
      }

      res.status(200).json({ success: true, data: rating });
    } catch (error) {
      console.error("Error retrieving support service rating:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi lấy đánh giá",
        error: error.message
      });
    }
  },
};

module.exports = RatingController;
