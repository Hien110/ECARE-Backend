const pushNotificationService = require('./pushNotificationService');
const User = require('../app/models/User');
const SOSNotification = require('../app/models/SOSNotification');

/**
 * Service quản lý việc gọi tự động lần lượt đến các recipients trong SOS
 */
class SOSCallService {
  constructor() {
    // Map để track các SOS call sequences đang active
    // sosId -> { currentRecipientIndex, recipients, callId, timeoutId, status }
    this.activeSOSCalls = new Map();
    this.socketConfig = null;
  }

  /**
   * Khởi tạo với socket instance
   */
  initialize(socketConfig) {
    this.socketConfig = socketConfig;
    console.log('✅ SOSCallService initialized');
  }

  /**
   * Bắt đầu sequence gọi tự động cho SOS
   * @param {Object} sosNotification - SOS notification document
   */
  async startAutoCallSequence(sosNotification) {
    try {
      const sosId = sosNotification._id.toString();
      const recipients = sosNotification.recipients.map(r => 
        typeof r === 'object' ? r._id.toString() : r.toString()
      );

      console.log(`📞 Starting auto-call sequence for SOS ${sosId}`);
      console.log(`👥 Recipients: ${recipients.length} users`);

      if (recipients.length === 0) {
        console.log('❌ No recipients to call');
        return;
      }

      // Tạo tracking object
      const callSequence = {
        sosId,
        currentRecipientIndex: 0,
        recipients,
        callId: null,
        timeoutId: null,
        status: 'calling',
        startTime: Date.now(),
        requester: sosNotification.requester
      };

      this.activeSOSCalls.set(sosId, callSequence);

      // Bắt đầu gọi recipient đầu tiên
      await this.callNextRecipient(sosId);

    } catch (error) {
      console.error('❌ Error starting auto-call sequence:', error);
    }
  }

  /**
   * Gọi đến recipient tiếp theo trong sequence
   */
  async callNextRecipient(sosId) {
    try {
      const callSequence = this.activeSOSCalls.get(sosId);
      
      if (!callSequence) {
        console.log('❌ Call sequence not found:', sosId);
        return;
      }

      const { currentRecipientIndex, recipients, requester } = callSequence;

      // Kiểm tra xem đã gọi hết chưa
      if (currentRecipientIndex >= recipients.length) {
        console.log('📞 All recipients called, no answer. Ending sequence.');
        await this.endCallSequence(sosId, 'no_answer');
        return;
      }

      const recipientId = recipients[currentRecipientIndex];
      
      // Lấy thông tin recipient
      const recipient = await User.findById(recipientId).select('fullName avatar phoneNumber fcmTokens');
      
      if (!recipient) {
        console.log(`❌ Recipient ${recipientId} not found, skipping...`);
        // Skip và gọi người tiếp theo
        callSequence.currentRecipientIndex++;
        await this.callNextRecipient(sosId);
        return;
      }

      // Tạo callId mới cho cuộc gọi này
      const callId = `sos_call_${sosId}_${recipientId}_${Date.now()}`;
      callSequence.callId = callId;

      console.log(`📞 Calling recipient ${currentRecipientIndex + 1}/${recipients.length}: ${recipient.fullName}`);

      // Lấy thông tin requester để hiển thị
      const requesterData = await User.findById(requester).select('fullName avatar phoneNumber');

      const callData = {
        type: 'sos_call',
        sosId,
        callId,
        requester: {
          _id: requesterData._id,
          fullName: requesterData.fullName,
          avatar: requesterData.avatar,
          phoneNumber: requesterData.phoneNumber
        },
        recipientId,
        recipientIndex: currentRecipientIndex + 1,
        totalRecipients: recipients.length,
        timestamp: new Date().toISOString()
      };

      // STRATEGY GIỐNG VIDEO CALL THƯỜNG: GỬI CẢ SOCKET VÀ PUSH NOTIFICATION
      // - Socket: Cho user đang online (nhanh, real-time)
      // - Push: Cho user background/offline (reliable, luôn đến)
      // Mobile sẽ tự xử lý dựa trên app state
      
      const isRecipientOnline = this.socketConfig && this.socketConfig.isUserOnline(recipientId);
      console.log(`📡 Recipient (${recipientId}) socket status: ${isRecipientOnline ? 'CONNECTED' : 'DISCONNECTED'}`);

      // 1. Thử gửi qua Socket.IO trước (nếu online)
      if (isRecipientOnline) {
        console.log(`🔌 Sending SOS call via SOCKET to ${recipient.fullName}`);
        this.socketConfig.emitToUser(recipientId, 'sos_call_request', callData);
      }

      // 2. LUÔN LUÔN gửi push notification (giống video call thường)
      // Vì socket có thể connected nhưng app đang ở background
      // Push notification đảm bảo user nhận được dù ở trạng thái nào
      console.log(`📤 Sending PUSH notification to ${recipient.fullName} (regardless of socket status)`);
      await this.sendSOSCallNotification(callData, recipient);

      // 3. Set timeout 30 giây
      const timeoutId = setTimeout(() => {
        this.handleCallTimeout(sosId);
      }, 30000); // 30 seconds

      callSequence.timeoutId = timeoutId;

    } catch (error) {
      console.error('❌ Error calling next recipient:', error);
      // Nếu có lỗi, thử gọi người tiếp theo
      const callSequence = this.activeSOSCalls.get(sosId);
      if (callSequence) {
        callSequence.currentRecipientIndex++;
        await this.callNextRecipient(sosId);
      }
    }
  }

  /**
   * Gửi push notification cho SOS call
   */
  async sendSOSCallNotification(callData, recipient) {
    try {
      const { sosId, callId, requester, recipientIndex, totalRecipients } = callData;

      // Lấy FCM tokens
      const tokens = [];
      if (recipient.fcmTokens && recipient.fcmTokens.length > 0) {
        recipient.fcmTokens.forEach(fcm => {
          if (fcm.token) tokens.push(fcm.token);
        });
      }

      if (tokens.length === 0) {
        console.log(`❌ No FCM tokens for ${recipient.fullName}`);
        return;
      }

      console.log(`📤 Sending SOS call notification to ${tokens.length} devices`);

      // Data payload - không có notification object để trigger background handler
      const data = {
        type: 'sos_call',
        sosId,
        callId,
        requesterId: requester._id.toString(),
        requesterName: requester.fullName || 'Unknown',
        requesterAvatar: requester.avatar || '',
        requesterPhone: requester.phoneNumber || '',
        recipientIndex: String(recipientIndex), // ✅ Lấy từ callData
        totalRecipients: String(totalRecipients), // ✅ Lấy từ callData
        timestamp: new Date().toISOString(),
        clickAction: 'SOS_CALL_INCOMING'
      };

      console.log('📦 FCM payload data:', JSON.stringify(data, null, 2));

      const admin = require('../config/firebase');
      const response = await admin.messaging().sendEachForMulticast({
        tokens: tokens,
        data: data,
        android: {
          priority: 'high',
          // ❌ KHÔNG dùng channelId ở đây - đây là thuộc tính của Notifee, không phải FCM
          // Channel sẽ được xử lý bởi Notifee trong background handler
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

      console.log(`✅ SOS call notification - Success: ${response.successCount}/${tokens.length}`);
      
      if (response.successCount > 0) {
        console.log('✅ FCM sent successfully to tokens:', tokens.map(t => t.substring(0, 30) + '...'));
      }

      if (response.failureCount > 0) {
        console.log(`⚠️ Some notifications failed: ${response.failureCount}`);
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            console.log(`❌ Token ${idx} failed:`, resp.error);
          }
        });
        await pushNotificationService.handleFailedTokens(response, tokens);
      }

    } catch (error) {
      console.error('❌ Error sending SOS call notification:', error);
    }
  }

  /**
   * Xử lý khi recipient chấp nhận cuộc gọi SOS
   */
  async handleCallAccepted(sosId, recipientId, callId) {
    try {
      const callSequence = this.activeSOSCalls.get(sosId);
      
      if (!callSequence) {
        console.log('❌ Call sequence not found:', sosId);
        return false;
      }

      if (callSequence.callId !== callId) {
        console.log('❌ Call ID mismatch, ignoring accept');
        return false;
      }

      console.log(`✅ SOS call accepted by recipient: ${recipientId}`);

      // Clear timeout
      if (callSequence.timeoutId) {
        clearTimeout(callSequence.timeoutId);
      }

      // Update SOS status
      await SOSNotification.findByIdAndUpdate(sosId, {
        status: 'acknowledged',
        acknowledgedBy: recipientId,
        acknowledgedAt: new Date()
      });

      // Lấy thông tin recipient để gửi cho requester
      const User = require('../app/models/User');
      const recipient = await User.findById(recipientId).select('fullName avatar phoneNumber');

      // 🆕 Đánh dấu cả requester và recipient đang trong cuộc gọi SOS
      // Điều này sẽ ngăn video call thường gọi đến họ
      const requesterId = typeof callSequence.requester === 'object' 
        ? callSequence.requester._id.toString() 
        : callSequence.requester.toString();

      if (this.socketConfig) {
        this.socketConfig.activeCallUsers.set(requesterId, callId); // Requester
        this.socketConfig.activeCallUsers.set(recipientId, callId); // Recipient
        console.log(`📞 SOS Call: Added to active calls - Requester: ${requesterId}, Recipient: ${recipientId}`);
      }

      // Notify requester rằng đã có người nhận
      if (this.socketConfig && callSequence.requester) {
        this.socketConfig.emitToUser(requesterId, 'sos_call_answered', {
          sosId,
          callId,
          answeredBy: recipientId,
          recipient: {
            _id: recipient._id,
            fullName: recipient.fullName,
            avatar: recipient.avatar,
            phoneNumber: recipient.phoneNumber
          },
          timestamp: new Date().toISOString()
        });
      }

      // End sequence
      this.activeSOSCalls.delete(sosId);

      return true;

    } catch (error) {
      console.error('❌ Error handling call accepted:', error);
      return false;
    }
  }

  /**
   * Xử lý khi recipient từ chối cuộc gọi SOS
   */
  async handleCallRejected(sosId, recipientId, callId) {
    try {
      const callSequence = this.activeSOSCalls.get(sosId);
      
      if (!callSequence) {
        console.log('❌ Call sequence not found:', sosId);
        return;
      }

      if (callSequence.callId !== callId) {
        console.log('❌ Call ID mismatch, ignoring reject');
        return;
      }

      console.log(`❌ SOS call rejected by recipient: ${recipientId}`);

      // Clear timeout
      if (callSequence.timeoutId) {
        clearTimeout(callSequence.timeoutId);
      }

      // 🆕 Cleanup rejected recipient khỏi activeCallUsers
      if (this.socketConfig) {
        this.socketConfig.activeCallUsers.delete(recipientId);
        console.log(`📞 Removed rejected recipient ${recipientId} from active calls`);
      }

      // Chuyển sang người tiếp theo
      callSequence.currentRecipientIndex++;
      await this.callNextRecipient(sosId);

    } catch (error) {
      console.error('❌ Error handling call rejected:', error);
    }
  }

  /**
   * Xử lý timeout khi không có response trong 30s
   */
  async handleCallTimeout(sosId) {
    try {
      const callSequence = this.activeSOSCalls.get(sosId);
      
      if (!callSequence) {
        console.log('❌ Call sequence not found:', sosId);
        return;
      }

      const { currentRecipientIndex, recipients } = callSequence;
      const recipientId = recipients[currentRecipientIndex];

      console.log(`⏰ SOS call timeout for recipient: ${recipientId}`);

      // 🆕 Cleanup timeout recipient khỏi activeCallUsers
      if (this.socketConfig) {
        this.socketConfig.activeCallUsers.delete(recipientId);
        console.log(`📞 Removed timeout recipient ${recipientId} from active calls`);
      }

      // Notify recipient về timeout (để dismiss notification nếu cần)
      if (this.socketConfig) {
        this.socketConfig.emitToUser(recipientId, 'sos_call_timeout', {
          sosId,
          callId: callSequence.callId,
          timestamp: new Date().toISOString()
        });
      }

      // Chuyển sang người tiếp theo
      callSequence.currentRecipientIndex++;
      await this.callNextRecipient(sosId);

    } catch (error) {
      console.error('❌ Error handling call timeout:', error);
    }
  }

  /**
   * Kết thúc call sequence
   */
  async endCallSequence(sosId, reason = 'completed') {
    try {
      const callSequence = this.activeSOSCalls.get(sosId);
      
      if (!callSequence) {
        return;
      }

      console.log(`🛑 Ending SOS call sequence: ${sosId}, reason: ${reason}`);

      // Clear timeout nếu còn
      if (callSequence.timeoutId) {
        clearTimeout(callSequence.timeoutId);
      }

      // Nếu không ai trả lời, update status
      if (reason === 'no_answer') {
        await SOSNotification.findByIdAndUpdate(sosId, {
          status: 'resolved', // 🆕 Changed: Mark as resolved vì đã hoàn thành auto-call sequence
          resolvedAt: new Date(),
          $push: {
            callLog: {
              event: 'auto_call_completed',
              message: 'Đã gọi hết tất cả recipients nhưng không có ai trả lời',
              timestamp: new Date()
            }
          }
        });

        // Notify requester
        if (this.socketConfig && callSequence.requester) {
          const requesterId = typeof callSequence.requester === 'object' 
            ? callSequence.requester._id.toString() 
            : callSequence.requester.toString();

          this.socketConfig.emitToUser(requesterId, 'sos_call_no_answer', {
            sosId,
            message: 'Không có thành viên nào trả lời cuộc gọi khẩn cấp',
            timestamp: new Date().toISOString()
          });

          // 🆕 Cleanup requester khỏi activeCallUsers vì không ai trả lời
          this.socketConfig.activeCallUsers.delete(requesterId);
          console.log(`📞 Removed requester ${requesterId} from active calls (no answer)`);
        }
      }

      // Remove từ active calls
      this.activeSOSCalls.delete(sosId);

    } catch (error) {
      console.error('❌ Error ending call sequence:', error);
    }
  }

  /**
   * Cancel một SOS call sequence (ví dụ khi requester cancel SOS)
   */
  async cancelCallSequence(sosId) {
    try {
      const callSequence = this.activeSOSCalls.get(sosId);
      
      if (!callSequence) {
        return;
      }

      console.log(`🛑 Cancelling SOS call sequence: ${sosId}`);

      // 🆕 Update SOS status trong database
      await SOSNotification.findByIdAndUpdate(sosId, {
        status: 'cancelled',
        resolvedAt: new Date(),
        $push: {
          callLog: {
            event: 'call_sequence_cancelled',
            message: 'Call sequence bị hủy',
            timestamp: new Date()
          }
        }
      });

      // Clear timeout
      if (callSequence.timeoutId) {
        clearTimeout(callSequence.timeoutId);
      }

      // Notify current recipient về cancel
      if (this.socketConfig && callSequence.currentRecipientIndex < callSequence.recipients.length) {
        const currentRecipientId = callSequence.recipients[callSequence.currentRecipientIndex];
        this.socketConfig.emitToUser(currentRecipientId, 'sos_call_cancelled', {
          sosId,
          callId: callSequence.callId,
          timestamp: new Date().toISOString()
        });

        // 🆕 Cleanup current recipient khỏi activeCallUsers
        this.socketConfig.activeCallUsers.delete(currentRecipientId);
        console.log(`📞 Removed recipient ${currentRecipientId} from active calls (cancelled)`);
      }

      // 🆕 Cleanup requester khỏi activeCallUsers
      if (this.socketConfig && callSequence.requester) {
        const requesterId = typeof callSequence.requester === 'object' 
          ? callSequence.requester._id.toString() 
          : callSequence.requester.toString();
        this.socketConfig.activeCallUsers.delete(requesterId);
        console.log(`📞 Removed requester ${requesterId} from active calls (cancelled)`);
      }

      // Remove từ active calls
      this.activeSOSCalls.delete(sosId);

    } catch (error) {
      console.error('❌ Error cancelling call sequence:', error);
    }
  }

  /**
   * Kiểm tra xem user có SOS call đang active không
   * @param {String} userId - User ID cần kiểm tra
   * @returns {Boolean}
   */
  hasActiveSOSCall(userId) {
    const userIdStr = userId.toString();
    
    // Check trong activeSOSCalls Map
    for (const [sosId, sequence] of this.activeSOSCalls.entries()) {
      const requesterId = typeof sequence.requester === 'object'
        ? sequence.requester._id?.toString() || sequence.requester.toString()
        : sequence.requester.toString();
      
      if (requesterId === userIdStr) {
        console.log(`⚠️ User ${userIdStr} has active SOS call: ${sosId}`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get active call sequences (for debugging)
   */
  getActiveCallSequences() {
    return Array.from(this.activeSOSCalls.entries()).map(([sosId, sequence]) => ({
      sosId,
      currentRecipient: sequence.currentRecipientIndex + 1,
      totalRecipients: sequence.recipients.length,
      callId: sequence.callId,
      status: sequence.status,
      elapsedTime: Date.now() - sequence.startTime
    }));
  }
}

module.exports = new SOSCallService();
