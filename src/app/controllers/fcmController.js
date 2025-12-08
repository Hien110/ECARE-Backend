const pushNotificationService = require('../../services/pushNotificationService');

/**
 * Lưu FCM token khi user login hoặc mở app
 */
exports.saveFCMToken = async (req, res) => {
  try {
    console.log('📥 saveFCMToken called');
    console.log('User ID:', req.user?._id || req.user?.userId);
    console.log('Request body:', req.body);

    const { token, deviceInfo } = req.body;

    if (!token) {
      console.log('❌ No token provided');
      return res.status(400).json({
        success: false,
        message: 'FCM token is required'
      });
    }

    // Validate token format (FCM token thường dài ~150-200 ký tự)
    if (token.length < 50) {
      console.log('❌ Invalid token length:', token.length);
      return res.status(400).json({
        success: false,
        message: 'Invalid FCM token format'
      });
    }

    const userId = req.user._id || req.user.userId;
    console.log('💾 Saving token for user:', userId);

    await pushNotificationService.saveFCMToken(
      userId,
      token,
      deviceInfo || 'Unknown device'
    );

    console.log('✅ FCM token saved successfully');
    res.json({
      success: true,
      message: 'FCM token saved successfully'
    });
  } catch (error) {
    console.error('❌ Error in saveFCMToken controller:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Xóa FCM token khi user logout
 */
exports.removeFCMToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'FCM token is required'
      });
    }

    await pushNotificationService.removeFCMToken(req.user._id, token);

    res.json({
      success: true,
      message: 'FCM token removed successfully'
    });
  } catch (error) {
    console.error('❌ Error in removeFCMToken controller:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Lấy danh sách FCM tokens của user hiện tại (để debug)
 */
exports.getUserTokens = async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user._id).select('fcmTokens');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        totalTokens: user.fcmTokens ? user.fcmTokens.length : 0,
        tokens: user.fcmTokens ? user.fcmTokens.map(fcm => ({
          deviceInfo: fcm.deviceInfo,
          createdAt: fcm.createdAt,
          lastUsed: fcm.lastUsed,
          tokenPreview: fcm.token.substring(0, 20) + '...' // Chỉ hiển thị một phần
        })) : []
      }
    });
  } catch (error) {
    console.error('❌ Error getting user tokens:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Logout - xóa tất cả FCM tokens của user
 */
exports.logout = async (req, res) => {
  try {
    console.log('👋 logout called');
    const userId = req.user._id || req.user.userId;
    const { token } = req.body;

    console.log('User ID:', userId);
    console.log('Token provided:', !!token);

    const User = require('../models/User');

    if (token) {
      // Xóa token cụ thể
      await User.findByIdAndUpdate(userId, {
        $pull: { 
          fcmTokens: { token } 
        }
      });
      console.log('✅ Specific FCM token removed');
    } else {
      // Xóa tất cả tokens
      await User.findByIdAndUpdate(userId, {
        $set: { fcmTokens: [] }
      });
      console.log('✅ All FCM tokens removed for user:', userId);
    }

    res.json({
      success: true,
      message: 'Logout successful - FCM tokens cleared'
    });
  } catch (error) {
    console.error('❌ Error in logout:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Test gửi notification (gửi đến tất cả users hoặc recipients cụ thể)
 */
exports.testNotification = async (req, res) => {
  try {
    console.log('📤 testNotification called');
    const { title, body, data, recipients } = req.body;

    if (!title && !body) {
      return res.status(400).json({
        success: false,
        message: 'Title or body is required'
      });
    }

    const User = require('../models/User');
    let users;
    let tokens = [];

    // Nếu có recipients, gửi đến người cụ thể
    if (recipients && Array.isArray(recipients) && recipients.length > 0) {
      console.log(`📤 Sending to ${recipients.length} specific users`);
      users = await User.find({
        _id: { $in: recipients },
      }).select('fcmTokens fullName');
    } 
    // Nếu không có recipients, gửi đến TẤT CẢ users có FCM tokens
    else {
      console.log('📤 Sending to ALL users with FCM tokens');
      users = await User.find({
        'fcmTokens.0': { $exists: true },
      }).select('fcmTokens fullName');
    }

    console.log(`👥 Found ${users.length} users`);

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No users found with FCM tokens'
      });
    }

    // Lấy tất cả FCM tokens
    users.forEach(user => {
      if (user.fcmTokens && user.fcmTokens.length > 0) {
        user.fcmTokens.forEach(fcm => {
          if (fcm.token) {
            tokens.push({
              token: fcm.token,
              userName: user.fullName,
              userId: user._id
            });
          }
        });
      }
    });

    console.log(`📱 Total tokens found: ${tokens.length}`);

    if (tokens.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No tokens found'
      });
    }

    // Chuẩn bị notification payload
    const notification = {
      title: title || 'Test Notification',
      body: body || 'This is a test notification from E-Care',
    };

    const customData = {
      ...data,
      type: data?.type || 'test',
      timestamp: new Date().toISOString(),
    };

    const tokenList = tokens.map(t => t.token);

    // Gửi notification qua Firebase
    const admin = require('../../config/firebase');
    const response = await admin.messaging().sendEachForMulticast({
      tokens: tokenList,
      notification: notification,
      data: customData,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'sos_alerts',
          priority: 'max',
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: notification.title,
              body: notification.body,
            },
            sound: 'default',
            badge: 1,
          },
        },
      },
    });

    console.log(`✅ Success: ${response.successCount}/${tokens.length}`);
    console.log(`❌ Failed: ${response.failureCount}/${tokens.length}`);

    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.error(`Failed for ${tokens[idx].userName}:`, resp.error);
        }
      });
    }

    res.json({
      success: true,
      message: 'Test notification sent',
      result: {
        totalTokens: tokens.length,
        successCount: response.successCount,
        failureCount: response.failureCount,
        recipients: users.map(u => ({ id: u._id, name: u.fullName })),
      },
    });
  } catch (error) {
    console.error('❌ Error sending test notification:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
