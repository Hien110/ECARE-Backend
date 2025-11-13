const Rating = require('../models/Rating');

const RatingController = {

    getRatingsByUserId: async (req, res) => {
        try {
            const userId = req.params.userId;
            const ratings = await Rating.find({ reviewee: userId, status: 'active' })
                .populate('reviewer', 'fullName avatar')
                .sort({ ratedAt: -1 });
            res.status(200).json({ success: true, data: ratings });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Error retrieving ratings', error });
        }  
    },

};

module.exports = RatingController;
