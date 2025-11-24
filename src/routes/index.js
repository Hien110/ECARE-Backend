const userRoutes = require('./user.routes');
const relationshipRoutes = require('./relationship.routes');
const conversationRoutes = require('./conversation.routes');
const supporterRoutes = require('./supporter.routes');
const adminRoutes = require('./admin.routes');

const healthRecordRoutes = require('./healthRecord.routes');
const doctorRoutes = require('./doctor.routes');
const ratingRoutes = require('./rating.routes');

const supporterSchedulingRoutes = require('./supporterScheduling.routes');
const sosRoutes = require('./sos.routes');
const aiRoutes = require('./ai.routes');
const agoraRoutes = require('./agora.routes');
const deadmanRoutes = require('./deadman.routes');

const supporterServiceRoutes = require('./supporterServices.routes');
const transcribetionRoutes = require('./transcription.routes');
const healthPackageRoutes = require('./healthPackage.routes');
const doctorBookingRoutes = require('./doctorBooking.routes');
function route(app) {
    app.use('/api/users', userRoutes);
    app.use('/api/relationships', relationshipRoutes);
    app.use('/api/conversations', conversationRoutes);
    app.use('/api/supporters', supporterRoutes);
    app.use('/api/admin', adminRoutes);

    app.use('/api/health-records', healthRecordRoutes);

    app.use('/api/doctors', doctorRoutes);
    app.use('/api/ratings', ratingRoutes);

    app.use('/api/supporter-schedulings', supporterSchedulingRoutes);
    
    app.use('/api/sos', sosRoutes);
    app.use('/api/ai', aiRoutes);
    app.use('/api/agora', agoraRoutes);
    app.use('/api/deadman', deadmanRoutes);

    app.use('/api/supporter-services', supporterServiceRoutes);

    app.use('/api/transcriptions', transcribetionRoutes);
    app.use('/api/health-packages', healthPackageRoutes);
    app.use('/api/doctor-booking', doctorBookingRoutes);
}

module.exports = route;