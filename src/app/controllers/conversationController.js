const User = require("../models/User.js");
const Conversation = require("../models/Conversation.js");
const Message = require("../models/Message.js");
const { get } = require("../../utils/redis.js");
const { default: mongoose } = require("mongoose");

const ConversationController = {
  // Get all conversations by user ID
  getAllConversationsByUserId: async (req, res) => {
    const userId = req.params.userId;
    try {
      // Find conversations involving the user
      const conversations = await Conversation.find({
        'participants.user': userId,
      }).populate('participants.user', 'fullName avatar');

      // Get latest message for each conversation
      const conversationsWithMessages = await Promise.all(
        conversations.map(async (conversation) => {
          const latestMessage = await Message.findOne({
            conversation: conversation._id,
            isDeleted: { $ne: true }
          })
          .populate('sender', 'fullName avatar')
          .sort({ createdAt: -1 });

          return {
            ...conversation.toObject(),
            latestMessage: latestMessage
          };
        })
      );

      // Sort conversations by latest message time
      conversationsWithMessages.sort((a, b) => {
        const timeA = a.latestMessage ? new Date(a.latestMessage.createdAt) : new Date(a.createdAt);
        const timeB = b.latestMessage ? new Date(b.latestMessage.createdAt) : new Date(b.createdAt);
        return timeB - timeA;
      });

      return res.status(200).json({
        success: true,
        data: conversationsWithMessages,
        message: "Lấy cuộc trò chuyện thành công",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
  getMessagesByConversationId: async (req, res) => {
    const conversationId = req.params.conversationId;
    try {
      if (!conversationId) {
        return res.status(400).json({
          success: false,
          message: "Thiếu conversationId",
        });
      }

      const messages = await Message.find({ 
        conversation: conversationId,
        isDeleted: { $ne: true } // Không lấy tin nhắn đã xóa
      })
        .populate('sender', 'fullName avatar')
        .sort({ createdAt: 1 });

      // Transform messages để frontend dễ sử dụng
      const transformedMessages = messages.map(msg => ({
        ...msg.toObject(),
        // Thêm field content text để backward compatibility
        contentText: msg.content?.text || msg.content?.systemMessage || '',
      }));

      return res.status(200).json({
        success: true,
        data: transformedMessages,
        message: "Lấy tin nhắn thành công",
      });
    } catch (error) {
      console.error('Get messages error:', error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
  sendMessage: async (req, res) => {
    const { conversationId, senderId, messageType, content } = req.body;
    try {
      // Validate required fields
      if (!conversationId || !senderId || !content) {
        return res.status(400).json({
          success: false,
          message: "Thiếu thông tin cần thiết: conversationId, senderId, content",
        });
      }

      // Prepare content based on messageType
      let messageContent = {};
      if (messageType === 'text' || !messageType) {
        messageContent = { text: content };
      } else if (messageType === 'image') {
        messageContent = { fileUrl: content };
      } else if (messageType === 'file') {
        messageContent = { 
          fileUrl: content.fileUrl || content,
          fileName: content.fileName,
          fileSize: content.fileSize,
          mimeType: content.mimeType
        };
      } else if (messageType === 'system') {
        messageContent = { systemMessage: content };
      } else {
        messageContent = { text: content };
      }

      const newMessage = new Message({
        conversation: conversationId,
        sender: senderId,
        messageType: messageType || 'text',
        content: messageContent,
      });
      
      await newMessage.save();
      
      // Populate sender info để trả về đầy đủ thông tin
      const populatedMessage = await Message.findById(newMessage._id)
        .populate('sender', 'fullName avatar')
        .populate('conversation', 'participants');

      // Emit real-time message via Socket.IO
      const socketConfig = req.app.get('socketConfig');
      if (socketConfig) {
        // Emit to conversation members
        socketConfig.emitToConversation(`conversation_${conversationId}`, 'new_message', {
          message: populatedMessage,
          conversationId
        });
        
        // Emit conversation update to all participants for conversation list refresh
        const conversation = populatedMessage.conversation;
        if (conversation && conversation.participants) {
          conversation.participants.forEach(participant => {
            const userId = participant.user?._id || participant.user;
            if (userId) {
              socketConfig.emitToUser(userId.toString(), 'conversation_updated', {
                conversationId,
                latestMessage: populatedMessage,
                updatedAt: new Date()
              });
            }
          });
        }
        
        console.log(`💬 Real-time message sent to conversation ${conversationId}`);
      }
      
      return res.status(201).json({
        success: true,
        data: populatedMessage,
        message: "Gửi tin nhắn thành công",
      });
    } catch (error) {
      console.error('Send message error:', error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
  getConversationByTwoParticipant: async (req, res) => {
    try {
      const { userAId, userBId } = req.body; // nhận từ body hoặc query đều được
      
      // Kiểm tra đầu vào
      if (!userAId || !userBId) {
        return res.status(400).json({
          success: false,
          message: "Thiếu userAId hoặc userBId",
        });
      }

      // Kiểm tra định dạng ObjectId hợp lệ
      if (!mongoose.Types.ObjectId.isValid(userAId) || !mongoose.Types.ObjectId.isValid(userBId)) {
        return res.status(400).json({
          success: false,
          message: "userAId hoặc userBId không hợp lệ",
        });
      }

      // Tìm conversation giữa 2 người
      const conversation = await Conversation.findOne({
        isActive: true,
        $and: [
          { participants: { $elemMatch: { user: userAId } } },
          { participants: { $elemMatch: { user: userBId } } },
        ],
        // chỉ hội thoại 1-1
        "participants.2": { $exists: false },
      })
        .populate("participants.user", "fullName avatar role phoneNumber")
        .lean();

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy cuộc trò chuyện giữa hai người này",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Đã tìm thấy cuộc trò chuyện",
        data: conversation,
      });
    } catch (error) {
      console.error("Error getConversationByTwoParticipant:", error);
      return res.status(500).json({
        success: false,
        message: "Lỗi khi tìm cuộc trò chuyện",
      });
    }
  },
  // Xóa tin nhắn, xóa hoàn toàn cả đoạn hội thoại và tin nhắn
  deleteConversationAndMessages: async (req, res) => {
    const { conversationId } = req.params;
    console.log(conversationId);
    
    try {
      if (!conversationId) {
        return res.status(400).json({
          success: false,
          message: "Thiếu conversationId",
        });
      }
      // Xóa cuộc trò chuyện
      await Conversation.findByIdAndDelete(conversationId);
      // Xóa tất cả tin nhắn liên quan
      await Message.deleteMany({ conversation: conversationId });
      return res.status(200).json({
        success: true,
        message: "Xóa cuộc trò chuyện và tin nhắn thành công",
      });
    } catch (error) {
      console.error('Delete conversation error:', error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  // Reject video call (HTTP endpoint để reject từ background)
  rejectVideoCall: async (req, res) => {
    try {
      const { callId, conversationId, callerId } = req.body;
      const calleeId = req.user.userId;

      if (!callId || !conversationId || !callerId) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: callId, conversationId, callerId',
        });
      }

      // Lấy socketConfig instance để emit event
      const socketConfig = require('../../config/socket/socketConfig');
      
      if (!socketConfig) {
        return res.status(500).json({
          success: false,
          message: 'Socket.IO not initialized',
        });
      }

      // Emit event video_call_rejected đến caller
      const rejectData = {
        callId,
        conversationId,
        calleeId,
        timestamp: new Date().toISOString(),
      };

      // Gửi đến caller sử dụng socketConfig.emitToUser
      socketConfig.emitToUser(callerId, 'video_call_rejected', rejectData);

      return res.status(200).json({
        success: true,
        message: 'Video call rejected successfully',
        data: rejectData,
      });

    } catch (error) {
      console.error('Error rejecting video call:', error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
  
};

module.exports = ConversationController;
