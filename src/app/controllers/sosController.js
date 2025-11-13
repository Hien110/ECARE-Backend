const SOSNotification = require('../models/SOSNotification');
const pushNotificationService = require('../../services/pushNotificationService');

/**
 * Tạo SOS notification mới
 */
exports.createSOS = async (req, res) => {
  try {
    const { recipients, message, location } = req.body;

    // Validate input
    if (!recipients || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Recipients are required'
      });
    }

    if (!location || !location.coordinates) {
      return res.status(400).json({
        success: false,
        message: 'Location coordinates are required'
      });
    }

    if (!location.coordinates.latitude || !location.coordinates.longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    // Tạo SOS notification
    // req.user có thể có _id hoặc userId tùy theo JWT payload structure
    const requesterId = req.user._id || req.user.userId || req.user.id;
    
    if (!requesterId) {
      return res.status(401).json({
        success: false,
        message: 'User ID not found in token'
      });
    }

    const sosNotification = new SOSNotification({
      requester: requesterId,
      recipients,
      message,
      location,
      status: 'active'
    });

    await sosNotification.save();
    
    // Populate thông tin requester
    await sosNotification.populate('requester', 'fullName avatar phoneNumber');

    // 1. Gửi real-time qua Socket.IO (cho app đang mở)
    const socketConfig = require('../../config/socket/socketConfig');
    if (socketConfig.io) {
      recipients.forEach(recipientId => {
        socketConfig.emitToUser(recipientId.toString(), 'sos:new', {
          ...sosNotification.toObject(),
          timestamp: new Date()
        });
      });
    }

    // 2. Gửi Push Notification (cho app đóng/background)
    // Không chờ kết quả để response nhanh hơn
    pushNotificationService.sendSOSNotification(sosNotification)
      .catch(error => {
        console.error('❌ Push notification error:', error.message);
      });

    res.status(201).json({
      success: true,
      message: 'SOS notification created successfully',
      data: sosNotification
    });

  } catch (error) {
    console.error('❌ Error creating SOS:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Lấy danh sách SOS của user (cả gửi và nhận)
 */
exports.getUserSOSNotifications = async (req, res) => {
  try {
    const { status, limit = 50, page = 1 } = req.query;
    
    const query = {
      $or: [
        { requester: req.user._id },
        { recipients: req.user._id }
      ]
    };

    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const sosNotifications = await SOSNotification.find(query)
      .populate('requester', 'fullName avatar phoneNumber')
      .populate('recipients', 'fullName avatar')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await SOSNotification.countDocuments(query);

    res.json({
      success: true,
      data: sosNotifications,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ Error getting SOS notifications:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Lấy chi tiết một SOS notification
 */
exports.getSOSById = async (req, res) => {
  try {
    const { sosId } = req.params;

    const sos = await SOSNotification.findById(sosId)
      .populate('requester', 'fullName avatar phoneNumber currentAddress')
      .populate('recipients', 'fullName avatar phoneNumber');

    if (!sos) {
      return res.status(404).json({
        success: false,
        message: 'SOS notification not found'
      });
    }

    // Kiểm tra quyền xem (chỉ requester và recipients)
    // req.user có thể có _id hoặc userId tùy theo JWT payload structure
    const currentUserId = req.user._id || req.user.userId || req.user.id;
    
    const isRequester = sos.requester._id.toString() === currentUserId.toString();
    const isRecipient = sos.recipients.some(
      recipient => recipient._id.toString() === currentUserId.toString()
    );

    if (!isRequester && !isRecipient) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this SOS'
      });
    }

    res.json({
      success: true,
      data: sos
    });
  } catch (error) {
    console.error('❌ Error getting SOS by ID:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Cập nhật trạng thái SOS
 */
exports.updateSOSStatus = async (req, res) => {
  try {
    const { sosId } = req.params;
    const { status } = req.body;

    const validStatuses = ['active', 'acknowledged', 'resolved', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const sos = await SOSNotification.findById(sosId);

    if (!sos) {
      return res.status(404).json({
        success: false,
        message: 'SOS notification not found'
      });
    }

    // Chỉ requester hoặc recipients mới được cập nhật
    const isRequester = sos.requester.toString() === req.user._id.toString();
    const isRecipient = sos.recipients.some(
      recipientId => recipientId.toString() === req.user._id.toString()
    );

    if (!isRequester && !isRecipient) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this SOS'
      });
    }

    // Cập nhật status
    sos.status = status;
    await sos.save();

    await sos.populate('requester', 'fullName avatar');

    // Thông báo qua Socket.IO
    const socketConfig = require('../../config/socket/socketConfig');
    if (socketConfig.io) {
      // Gửi đến requester
      const eventData = {
        sosId: sos._id,
        status: sos.status,
        updatedBy: {
          _id: req.user._id,
          fullName: req.user.fullName
        },
        timestamp: new Date()
      };
      
      socketConfig.emitToUser(sos.requester._id.toString(), 'sos:status_updated', eventData);

      // Gửi đến tất cả recipients
      sos.recipients.forEach(recipientId => {
        socketConfig.emitToUser(recipientId.toString(), 'sos:status_updated', eventData);
      });
    }

    res.json({
      success: true,
      message: 'SOS status updated successfully',
      data: sos
    });
  } catch (error) {
    console.error('❌ Error updating SOS status:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Xóa SOS notification (chỉ requester)
 */
exports.deleteSOSNotification = async (req, res) => {
  try {
    const { sosId } = req.params;

    const sos = await SOSNotification.findById(sosId);

    if (!sos) {
      return res.status(404).json({
        success: false,
        message: 'SOS notification not found'
      });
    }

    // Chỉ requester mới được xóa
    if (sos.requester.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the requester can delete this SOS'
      });
    }

    await SOSNotification.findByIdAndDelete(sosId);

    res.json({
      success: true,
      message: 'SOS notification deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting SOS:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
