const express = require('express');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
const router = express.Router();

// Lấy từ environment variables
const AGORA_APP_ID = process.env.AGORA_APP_ID;
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

/**
 * POST /api/agora/token
 * Generate Agora RTC token
 * 
 * Body:
 * {
 *   "channelName": "chat_conversationId",
 *   "uid": 0 (optional, 0 for auto-assign)
 * }
 */
router.post('/token', async (req, res) => {
  try {
    const { channelName, uid } = req.body;

    // Validation
    if (!channelName) {
      return res.status(400).json({
        success: false,
        message: 'channelName là bắt buộc'
      });
    }

    if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
      console.error('❌ Agora App ID hoặc Certificate chưa được cấu hình');
      return res.status(500).json({
        success: false,
        message: 'Agora chưa được cấu hình trên server'
      });
    }

    // Token parameters
    const role = RtcRole.PUBLISHER; // Người dùng có thể publish video/audio
    const expirationTimeInSeconds = 3600; // Token hết hạn sau 1 giờ
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;
    const uidValue = uid || 0; // 0 means Agora will auto-assign uid

    // Build token
    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      channelName,
      uidValue,
      role,
      privilegeExpiredTs
    );

    console.log('✅ Generated Agora token:', {
      channelName,
      uid: uidValue,
      expiresIn: expirationTimeInSeconds
    });

    res.json({
      success: true,
      data: {
        token,
        appId: AGORA_APP_ID,
        channelName,
        uid: uidValue,
        expiresIn: expirationTimeInSeconds,
        expiresAt: new Date(privilegeExpiredTs * 1000).toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error generating Agora token:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể tạo token',
      error: error.message
    });
  }
});

/**
 * POST /api/agora/rtm-token
 * Generate Agora RTM (Real-time Messaging) token
 * Optional - for future use
 */
router.post('/rtm-token', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId là bắt buộc'
      });
    }

    if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
      return res.status(500).json({
        success: false,
        message: 'Agora chưa được cấu hình trên server'
      });
    }

    const { RtmTokenBuilder, RtmRole } = require('agora-token');
    const expirationTimeInSeconds = 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const token = RtmTokenBuilder.buildToken(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      userId,
      RtmRole.Rtm_User,
      privilegeExpiredTs
    );

    res.json({
      success: true,
      data: {
        token,
        userId,
        expiresIn: expirationTimeInSeconds
      }
    });

  } catch (error) {
    console.error('❌ Error generating RTM token:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể tạo RTM token',
      error: error.message
    });
  }
});

module.exports = router;
