const Rating = require("../models/Rating");
const SupporterProfile = require("../models/SupporterProfile");

const RatingController = {
  // tạo đánh giá dịch vụ hỗ trợ
  createRatingSupportService: async (req, res) => {
    try {
      const {
        reviewer,
        reviewee,
        ratingType,
        rating,
        comment,
        serviceSupportId,
      } = req.body;
      const newRating = new Rating({
        reviewer,
        reviewee,
        ratingType,
        rating,
        comment,
        serviceSupportId,
      });
      await newRating.save();

      // Cập nhập tổng đánh giá và điểm trung bình trong SupporterProfile
      if (ratingType === "support_service") {
        const supporterProfile = await SupporterProfile.findOne({
          user: reviewee,
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
};

module.exports = RatingController;
