const admin = require('../config/firebase');
const User = require('../app/models/User');

class PushNotificationService {
  
  /**
   * Gửi thông báo video call đến user
   */
  async sendVideoCallNotification(callData) {
    try {
      const { callId, conversationId, caller, calleeId, callType } = callData;
      
      console.log('📞 Sending video call notification:', { 
        callId, 
        calleeId,
        callerName: caller.fullName,
        callType 
      });

      // Lấy FCM tokens của callee
      const user = await User.findById(calleeId).select('fcmTokens fullName');

      if (!user) {
        console.log('⚠️  User not found:', calleeId);
        return { success: false, message: 'User not found' };
      }

      console.log('👤 Found user:', { 
        userId: user._id, 
        userName: user.fullName,
        hasTokens: !!user.fcmTokens,
        tokenCount: user.fcmTokens?.length || 0
      });

      const tokens = [];
      if (user.fcmTokens && user.fcmTokens.length > 0) {
        user.fcmTokens.forEach(fcm => {
          if (fcm.token) {
            tokens.push(fcm.token);
          }
        });
      }

      if (tokens.length === 0) {
        console.log('⚠️  No FCM tokens found for user:', calleeId);
        return { success: false, message: 'No tokens found' };
      }

      console.log(`📤 Sending video call notification to ${tokens.length} devices`);
      console.log('🔑 FCM Tokens (first 50 chars):', tokens.map(t => t.substring(0, 50) + '...'));

      // Data payload - sẽ được xử lý bởi background handler
      const data = {
        type: 'video_call',
        callId: callId,
        conversationId: conversationId,
        callerId: caller._id.toString(),
        callerName: caller.fullName || 'Unknown',
        callerAvatar: caller.avatar || '',
        callType: callType || 'video',
        timestamp: new Date().toISOString(),
        clickAction: 'VIDEO_CALL_INCOMING'
      };

      console.log('📦 Notification data:', {
        type: data.type,
        callId: data.callId,
        callerId: data.callerId.substring(0, 10) + '...',
        callerName: data.callerName
      });

      // Gửi notification
      const response = await admin.messaging().sendEachForMulticast({
        tokens: tokens,
        // KHÔNG gửi notification object để tránh hiển thị notification cơ bản
        // Chỉ gửi data, sẽ được xử lý bởi background handler để hiển thị full-screen
        data: data,
        
        // Cấu hình cho Android - data-only message
        android: {
          priority: 'high', // Vẫn cần priority cao để wake app
        },
        
        // Cấu hình cho iOS - content-available để wake app
        apns: {
          payload: {
            aps: {
              'content-available': 1,
              badge: 1,
            }
          },
          headers: {
            'apns-priority': '10',
            'apns-push-type': 'background'
          }
        }
      });

      console.log(`✅ Video call notification - Success: ${response.successCount}/${tokens.length}`);
      
      if (response.failureCount > 0) {
        console.log(`❌ Video call notification - Failed: ${response.failureCount}/${tokens.length}`);
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            console.error(`  - Token ${idx + 1} failed:`, resp.error?.message || 'Unknown error');
          }
        });
        await this.handleFailedTokens(response, tokens);
      }

      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: tokens.length
      };

    } catch (error) {
      console.error('❌ Error sending video call notification:', error);
      console.error('❌ Error stack:', error.stack);
      throw error;
    }
  }

  /**
   * Gửi thông báo SOS đến nhiều người dùng
   */
  async sendSOSNotification(sosData) {
    try {
      const { requester, recipients, location, message, _id } = sosData;
      
      console.log('🆘 Sending SOS notification:', { 
        sosId: _id, 
        requesterName: requester.fullName,
        recipientCount: recipients.length 
      });
      
      // Lấy tất cả FCM tokens của recipients
      const users = await User.find({ 
        _id: { $in: recipients } 
      }).select('fcmTokens fullName');

      const tokens = [];
      users.forEach(user => {
        if (user.fcmTokens && user.fcmTokens.length > 0) {
          user.fcmTokens.forEach(fcm => {
            if (fcm.token) {
              tokens.push(fcm.token);
            }
          });
        }
      });

      if (tokens.length === 0) {
        console.log('⚠️  No FCM tokens found for recipients');
        return { success: false, message: 'No tokens found' };
      }

      console.log(`📤 Sending SOS notification to ${tokens.length} devices`);
      console.log('🔑 FCM Tokens (first 50 chars):', tokens.map(t => t.substring(0, 50) + '...'));

      // 🚫 KHÔNG GỬI THÔNG BÁO SOS ALERT NỮA - CHỈ GỬI SOS CALL
      // Thông báo SOS sẽ được gửi qua socket và SOS call notification
      console.log('ℹ️  SOS notification (type: sos) has been disabled. Use SOS call instead.');
      
      return {
        success: true,
        message: 'SOS alert notification is disabled. Only SOS call notifications are sent.'
      };

      /* OLD CODE - COMMENTED OUT
      const data = {
        type: 'sos',
        sosId: _id.toString(),
        requesterId: requester._id.toString(),
        requesterName: requester.fullName || 'Unknown',
        requesterAvatar: requester.avatar || '',
        latitude: location.coordinates.latitude.toString(),
        longitude: location.coordinates.longitude.toString(),
        address: location.address || 'Không xác định',
        message: message || '',
        timestamp: new Date().toISOString(),
        clickAction: 'SOS_DETAIL'
      };

      const response = await admin.messaging().sendEachForMulticast({
        tokens: tokens,
        data: data,
        android: {
          priority: 'high',
        },
        apns: {
          payload: {
            aps: {
              'content-available': 1,
              badge: 1,
            }
          },
          headers: {
            'apns-priority': '10',
            'apns-push-type': 'background'
          }
        }
      });

      console.log(`✅ SOS notification - Success: ${response.successCount}/${tokens.length}`);
      
      if (response.failureCount > 0) {
        console.log(`❌ SOS notification - Failed: ${response.failureCount}/${tokens.length}`);
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            console.log(`❌ Token ${idx} failed:`, resp.error?.code, resp.error?.message);
          }
        });
        await this.handleFailedTokens(response, tokens);
      }

      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: tokens.length
      };
      */

    } catch (error) {
      console.error('❌ Error sending SOS notification:', error);
      console.error('❌ Error stack:', error.stack);
      throw error;
    }
  }

  /**
   * Xử lý và xóa các FCM token không hợp lệ
   */
  async handleFailedTokens(response, tokens) {
    const failedTokens = [];
    
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const errorCode = resp.error?.code;
        console.log(`❌ Token failed: ${tokens[idx].substring(0, 20)}... - Error: ${errorCode}`);
        
        // Chỉ xóa token khi lỗi không thể khôi phục
        if (
          errorCode === 'messaging/invalid-registration-token' ||
          errorCode === 'messaging/registration-token-not-registered'
        ) {
          failedTokens.push(tokens[idx]);
        }
      }
    });

    if (failedTokens.length > 0) {
      console.log(`🗑️  Removing ${failedTokens.length} invalid tokens from database`);
      
      await User.updateMany(
        {},
        { 
          $pull: { 
            fcmTokens: { 
              token: { $in: failedTokens } 
            } 
          } 
        }
      );
    }
  }

  /**
   * Lưu FCM token mới của user
   */
  async saveFCMToken(userId, token, deviceInfo = 'Unknown device') {
    try {
      // Kiểm tra token đã tồn tại chưa
      const user = await User.findById(userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      const existingTokenIndex = user.fcmTokens.findIndex(
        fcm => fcm.token === token
      );

      if (existingTokenIndex !== -1) {
        // Cập nhật lastUsed nếu token đã tồn tại
        user.fcmTokens[existingTokenIndex].lastUsed = new Date();
        console.log(`🔄 FCM token updated for user: ${userId}`);
      } else {
        // Thêm token mới
        user.fcmTokens.push({
          token,
          deviceInfo,
          createdAt: new Date(),
          lastUsed: new Date()
        });
        console.log(`✅ New FCM token added for user: ${userId}`);
      }

      await user.save();
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error saving FCM token:', error);
      throw error;
    }
  }

  /**
   * Xóa FCM token khi user logout
   */
  async removeFCMToken(userId, token) {
    try {
      await User.findByIdAndUpdate(userId, {
        $pull: { 
          fcmTokens: { token } 
        }
      });
      
      console.log(`✅ FCM token removed for user: ${userId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error removing FCM token:', error);
      throw error;
    }
  }

  /**
   * Gửi thông báo chung (có thể mở rộng cho các loại notification khác)
   */
  async sendNotification(userId, notification, data) {
    try {
      const user = await User.findById(userId).select('fcmTokens');
      
      if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
        console.log('⚠️  No FCM tokens found for user:', userId);
        return { success: false, message: 'No tokens found' };
      }

      const tokens = user.fcmTokens.map(fcm => fcm.token);

      const response = await admin.messaging().sendEachForMulticast({
        tokens: tokens,
        notification: notification,
        data: data,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'default',
          }
        },
        apns: {
          payload: {
            aps: {
              alert: notification,
              sound: 'default',
            }
          }
        }
      });

      console.log(`✅ Notification sent: ${response.successCount}/${tokens.length}`);

      if (response.failureCount > 0) {
        await this.handleFailedTokens(response, tokens);
      }

      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount
      };

    } catch (error) {
      console.error('❌ Error sending notification:', error);
      throw error;
    }
  }
}

module.exports = new PushNotificationService();
