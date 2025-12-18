const mongoose = require("mongoose");
const Relationship = require("../models/Relationship.js");
const User = require("../models/User.js");
const Conversation = require("../models/Conversation.js");
const socketConfig = require("../../config/socket/socketConfig");

// Helper function để giải mã số điện thoại
const decryptPhoneNumbers = (relationships) => {
  const crypto = require("crypto");
  const ENC_KEY = Buffer.from(process.env.ENC_KEY || "", "base64");

  const decryptLegacy = (enc) => {
    if (!enc) return null;
    try {
      const [ivB64, ctB64, tagB64] = String(enc).split(":");
      const iv = Buffer.from(ivB64, "base64");
      const ct = Buffer.from(ctB64, "base64");
      const tag = Buffer.from(tagB64, "base64");
      const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
    } catch {
      return null;
    }
  };

  const decryptGCM = (packed) => {
    if (!packed) return null;
    try {
      const [ivB64, tagB64, dataB64] = String(packed).split(".");
      const iv = Buffer.from(ivB64, "base64url");
      const tag = Buffer.from(tagB64, "base64url");
      const data = Buffer.from(dataB64, "base64url");
      const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(data), d.final()]).toString("utf8");
    } catch {
      return null;
    }
  };

  const tryDecryptAny = (v) => {
    if (v == null || v === "") return null;
    const s = String(v);
    try {
      if (s.includes(".")) return decryptGCM(s);
      if (s.includes(":")) return decryptLegacy(s);
      return s;
    } catch {
      return null;
    }
  };

  const deepDecrypt = (v, passes = 3) => {
    let cur = v;
    for (let i = 0; i < passes; i++) {
      const out = tryDecryptAny(cur);
      if (out == null || out === cur) return out;
      cur = out;
    }
    return cur;
  };

  // Giải mã phoneNumber cho từng relationship
  return relationships.map((rel) => {
    const relObj = rel.toObject ? rel.toObject() : rel;

    if (relObj.elderly) {
      const phoneCipher =
        relObj.elderly.phoneNumberEnc || relObj.elderly.phoneNumber;
      relObj.elderly.phoneNumber =
        deepDecrypt(phoneCipher) || relObj.elderly.phoneNumber;
      delete relObj.elderly.phoneNumberEnc;
    }

    if (relObj.family) {
      const phoneCipher =
        relObj.family.phoneNumberEnc || relObj.family.phoneNumber;
      relObj.family.phoneNumber =
        deepDecrypt(phoneCipher) || relObj.family.phoneNumber;
      delete relObj.family.phoneNumberEnc;
    }

    if (relObj.requestedBy) {
      const phoneCipher =
        relObj.requestedBy.phoneNumberEnc || relObj.requestedBy.phoneNumber;
      relObj.requestedBy.phoneNumber =
        deepDecrypt(phoneCipher) || relObj.requestedBy.phoneNumber;
      delete relObj.requestedBy.phoneNumberEnc;
    }

    return relObj;
  });
};

const RelationshipController = {
  getAllRelationships: async (req, res) => {
    try {
      const userId = req.user.userId; // Lấy từ token JWT

      // Tìm tất cả relationships mà user là family hoặc elderly
      const relationships = await Relationship.find({
        $or: [{ family: userId }, { elderly: userId }],
      })
        .populate("elderly", "fullName phoneNumber phoneNumberEnc avatar")
        .populate("family", "fullName phoneNumber phoneNumberEnc avatar");

      const decryptedRelationships = decryptPhoneNumbers(relationships);

      return res.status(200).json({
        success: true,
        data: decryptedRelationships,
      });
    } catch (error) {
      console.error("Error fetching relationships:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  },

  // Tạo mối quan hệ mới
  createRelationship: async (req, res) => {
    try {
      const { elderlyId, relationship } = req.body;
      const familyId = req.user.userId; // Lấy từ token JWT

      // Validation
      if (!elderlyId || !relationship) {
        return res.status(400).json({
          success: false,
          message: "Thiếu thông tin elderlyId hoặc relationship",
        });
      }

      // Kiểm tra người già có tồn tại không
      const elderly = await User.findById(elderlyId);
      if (!elderly || elderly.role !== "elderly") {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy người già",
        });
      }

      // Kiểm tra người thân có tồn tại không
      const family = await User.findById(familyId);
      if (!family || family.role !== "family") {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy thông tin người thân" + familyId,
        });
      }

      // Kiểm tra xem mối quan hệ đã tồn tại chưa
      const existingRelationship = await Relationship.findOne({
        elderly: elderlyId,
        family: familyId,
        $or: [{ status: "pending" }, { status: "accepted" }],
      });

      if (existingRelationship) {
        return res.status(409).json({
          success: false,
          message: "Mối quan hệ đã tồn tại hoặc đang chờ duyệt",
        });
      }

      // Tạo mối quan hệ mới
      const newRelationship = new Relationship({
        elderly: elderlyId,
        family: familyId,
        relationship: relationship,
        requestedBy: familyId,
        status: "pending",
      });

      const savedRelationship = await newRelationship.save();

      // Populate thông tin để trả về
      await savedRelationship.populate(
        "elderly",
        "fullName phoneNumber phoneNumberEnc"
      );
      await savedRelationship.populate(
        "family",
        "fullName phoneNumber phoneNumberEnc"
      );
      await savedRelationship.populate(
        "requestedBy",
        "fullName phoneNumber phoneNumberEnc"
      );

      const decryptedRelationship = decryptPhoneNumbers([savedRelationship])[0];

      try {
        if (decryptedRelationship && decryptedRelationship.elderly && decryptedRelationship.elderly._id) {
          socketConfig.emitToUser(String(decryptedRelationship.elderly._id), 'relationship_request_created', { relationship: decryptedRelationship });
        }
      } catch (emitErr) {
        console.error('Socket emit error (createRelationship):', emitErr.message);
      }

      return res.status(201).json({
        success: true,
        message: "Yêu cầu kết nối đã được gửi thành công",
        data: decryptedRelationship,
      });
    } catch (error) {
      console.error("Error creating relationship:", error);
      return res.status(500).json({
        success: false,
        message: "Đã xảy ra lỗi khi tạo mối quan hệ",
      });
    }
  },

  connectSupporterToElderly: async (req, res) => {
    const session = await mongoose.startSession();
    try {
      const { elderlyId } = req.body;
      const familyId = req.user.userId; // supporter từ JWT

      if (!elderlyId) {
        return res.status(400).json({ success: false, message: "Thiếu thông tin elderlyId" });
      }

      const [elderly, supporter] = await Promise.all([
        User.findById(elderlyId),
        User.findById(familyId),
      ]);

      if (!elderly || elderly.role !== "elderly") {
        return res.status(404).json({ success: false, message: "Không tìm thấy người già" });
      }
      if (!supporter || supporter.role !== "supporter") {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy thông tin người hỗ trợ " + familyId,
        });
      }

      let savedRelationship;
      let savedConversation;

      await session.withTransaction(async () => {
        // 1) Relationship: nâng pending -> accepted hoặc tạo mới accepted
        const relFilter = {
          elderly: elderlyId,
          family: familyId,
          $or: [{ status: "pending" }, { status: "accepted" }],
        };

        let existingRelationship = await Relationship.findOne(relFilter, null, { session });
        if (existingRelationship) {
          if (existingRelationship.status === "pending") {
            existingRelationship.status = "accepted";
            existingRelationship.relationship = "Người hỗ trợ";
            existingRelationship.acceptedAt = new Date();
            await existingRelationship.save({ session });
          }
          savedRelationship = existingRelationship;
        } else {
          const newRelationship = new Relationship({
            elderly: elderlyId,
            family: familyId,
            relationship: "Người hỗ trợ",
            requestedBy: familyId,
            status: "accepted",
            acceptedAt: new Date(),
          });
          savedRelationship = await newRelationship.save({ session });
        }

        // 2) Conversation 1-1: nếu đã tồn tại giữa 2 người thì KHÔNG tạo nữa
        const existingConversation = await Conversation.findOne(
          {
            isActive: true, // theo schema của bạn
            $and: [
              { participants: { $elemMatch: { user: familyId } } },
              { participants: { $elemMatch: { user: elderlyId } } },
            ],
            // đảm bảo không phải nhóm > 2 người
            "participants.2": { $exists: false },
          },
          null,
          { session }
        );

        if (existingConversation) {
          savedConversation = existingConversation;
        } else {
          const newConversation = new Conversation({
            participants: [
              { user: familyId },  // supporter
              { user: elderlyId }, // elderly
            ],
            // settings và isActive dùng mặc định trong schema
          });
          savedConversation = await newConversation.save({ session });
        }
      });

      // 3) Populate sau khi commit
      await savedRelationship.populate("elderly", "fullName phoneNumber phoneNumberEnc");
      await savedRelationship.populate("family", "fullName phoneNumber phoneNumberEnc");
      await savedRelationship.populate("requestedBy", "fullName phoneNumber phoneNumberEnc");

      await savedConversation.populate("participants.user", "fullName avatar phoneNumber phoneNumberEnc");

      const decryptedRelationship = decryptPhoneNumbers([savedRelationship])[0];

      const participantsDecrypted = (savedConversation.participants || []).map(p => {
        const [decUser] = decryptPhoneNumbers([p.user]);
        return { ...p.toObject(), user: decUser };
      });

      // Emit real-time event to both elderly and family/supporter about accepted relationship
      try {
        const elderId = decryptedRelationship?.elderly?._id && String(decryptedRelationship.elderly._id);
        const familyIdStr = decryptedRelationship?.family?._id && String(decryptedRelationship.family._id);
        if (elderId) socketConfig.emitToUser(elderId, 'relationship_created', { relationship: decryptedRelationship });
        if (familyIdStr) socketConfig.emitToUser(familyIdStr, 'relationship_created', { relationship: decryptedRelationship });
      } catch (emitErr) {
        console.error('Socket emit error (connectSupporterToElderly):', emitErr.message);
      }

      return res.status(201).json({
        success: true,
        message: "Kết nối thành công: relationship đã accepted và conversation đã sẵn sàng (không tạo trùng).",
        data: {
          relationship: decryptedRelationship,
          conversation: {
            _id: savedConversation._id,
            participants: participantsDecrypted,
            isActive: savedConversation.isActive,
            settings: savedConversation.settings,
            createdAt: savedConversation.createdAt,
            updatedAt: savedConversation.updatedAt,
          },
        },
      });
    } catch (error) {
      console.error("Error createRelationshipAndConversation:", error);
      return res.status(500).json({
        success: false,
        message: "Đã xảy ra lỗi khi tạo relationship và conversation",
      });
    } finally {
      session.endSession();
    }
  },

  getRequestRelationshipsById: async (req, res) => {
    try {
      const userId = req.user.userId; // Lấy từ token JWT
      const relationships = await Relationship.find({
        elderly: userId,
        status: "pending",
      })
        .populate("elderly", "fullName avatar phoneNumber phoneNumberEnc")
        .populate("requestedBy", "fullName avatar phoneNumber phoneNumberEnc");

      const decryptedRelationships = decryptPhoneNumbers(relationships);

      return res.status(200).json({
        success: true,
        data: decryptedRelationships,
      });
    } catch (error) {
      console.error("Error fetching relationships:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  },

  acceptRelationship: async (req, res) => {
    try {
      const { relationshipId } = req.params;
      const userId = req.user.userId; // Lấy từ token JWT
      const relationship = await Relationship.findById(relationshipId);

      if (!relationship) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy mối quan hệ",
        });
      }
      if (relationship.elderly.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: "Bạn không có quyền thực hiện hành động này",
        });
      }
      if (relationship.status !== "pending") {
        return res.status(400).json({
          success: false,
          message: "Mối quan hệ không ở trạng thái chờ duyệt",
        });
      }
      relationship.status = "accepted";
      relationship.respondedAt = new Date();
      await relationship.save();

      // Kiểm tra xem đã có conversation giữa family và elderly chưa
      const existingConversation = await Conversation.findOne({
        participants: {
          $all: [
            { $elemMatch: { user: relationship.family } },
            { $elemMatch: { user: relationship.elderly } },
          ],
        },
        isActive: true,
      });

      let conversation = existingConversation;

      if (!existingConversation) {
        // Tạo conversation mới cho family và elderly
        const newConversation = new Conversation({
          participants: [
            { user: relationship.family },
            { user: relationship.elderly },
          ],
          isActive: true,
        });

        conversation = await newConversation.save();
      }

      // Populate and emit updates to involved users
      try {
        await relationship.populate("elderly", "fullName phoneNumber phoneNumberEnc");
        await relationship.populate("family", "fullName phoneNumber phoneNumberEnc");
        await relationship.populate("requestedBy", "fullName phoneNumber phoneNumberEnc");
        const decryptedRel = decryptPhoneNumbers([relationship])[0];

        const elderId = decryptedRel?.elderly?._id && String(decryptedRel.elderly._id);
        const famId = decryptedRel?.family?._id && String(decryptedRel.family._id);
        const requesterId = decryptedRel?.requestedBy?._id && String(decryptedRel.requestedBy._id);

        if (requesterId) {
          socketConfig.emitToUser(requesterId, 'relationship_request_updated', { relationship: decryptedRel });
        }
        if (elderId) {
          socketConfig.emitToUser(elderId, 'relationship_updated', { relationship: decryptedRel });
        }
        if (famId) {
          socketConfig.emitToUser(famId, 'relationship_updated', { relationship: decryptedRel });
        }
      } catch (emitErr) {
        console.error('Socket emit error (acceptRelationship):', emitErr.message);
      }

      return res.status(200).json({
        success: true,
        message: existingConversation
          ? "Mối quan hệ đã được chấp nhận"
          : "Mối quan hệ đã được chấp nhận và cuộc trò chuyện đã được tạo",
        data: {
          relationship: relationship,
          conversation: conversation,
        },
      });
    } catch (error) {
      console.error("Error accepting relationship:", error);
      return res.status(500).json({
        success: false,
        message: "Đã xảy ra lỗi khi chấp nhận mối quan hệ",
      });
    }
  },

  rejectRelationship: async (req, res) => {
    try {
      const { relationshipId } = req.params;
      const userId = req.user.userId; // Lấy từ token JWT
      const relationship = await Relationship.findById(relationshipId);
      if (!relationship) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy mối quan hệ",
        });
      }
      if (
        relationship.elderly.toString() !== userId &&
        relationship.family.toString() !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Bạn không có quyền thực hiện hành động này",
        });
      }
      if (relationship.status !== "pending") {
        return res.status(400).json({
          success: false,
          message: "Mối quan hệ không ở trạng thái chờ duyệt",
        });
      }
      relationship.status = "rejected";
      relationship.respondedAt = new Date();
      await relationship.save();
      // Emit update to involved users
      try {
        await relationship.populate("elderly", "fullName phoneNumber phoneNumberEnc");
        await relationship.populate("family", "fullName phoneNumber phoneNumberEnc");
        await relationship.populate("requestedBy", "fullName phoneNumber phoneNumberEnc");
        const decryptedRel = decryptPhoneNumbers([relationship])[0];
        const elderId = decryptedRel?.elderly?._id && String(decryptedRel.elderly._id);
        const famId = decryptedRel?.family?._id && String(decryptedRel.family._id);
        const requesterId = decryptedRel?.requestedBy?._id && String(decryptedRel.requestedBy._id);

        if (requesterId) socketConfig.emitToUser(requesterId, 'relationship_request_updated', { relationship: decryptedRel });
        if (elderId) socketConfig.emitToUser(elderId, 'relationship_updated', { relationship: decryptedRel });
        if (famId) socketConfig.emitToUser(famId, 'relationship_updated', { relationship: decryptedRel });
      } catch (emitErr) {
        console.error('Socket emit error (rejectRelationship):', emitErr.message);
      }

      return res.status(200).json({
        success: true,
        message: "Mối quan hệ đã bị từ chối",
        data: relationship,
      });
    } catch (error) {
      console.error("Error rejecting relationship:", error);
      return res.status(500).json({
        success: false,
        message: "Đã xảy ra lỗi khi từ chối mối quan hệ",
      });
    }
  },

  getAcceptRelationshipByUserId: async (req, res) => {
  try {
    const userId = req.user.userId; // Lấy từ token JWT
    // Lấy tất cả mối quan hệ đã ACCEPTED mà user đang là elderly HOẶC family
    const relationships = await Relationship.find({
      status: "accepted",
      $or: [
        { elderly: userId },
        { family: userId },
      ],
      })
        .populate(
          "elderly",
          "fullName avatar phoneNumber phoneNumberEnc addressEnc addressHash currentLocation role _id"
        )
        .populate(
          "family",
          "fullName avatar phoneNumber phoneNumberEnc role _id"
        )
        .populate(
          "requestedBy",
          "fullName avatar phoneNumber phoneNumberEnc role _id"
        );

      const decryptedRelationships = decryptPhoneNumbers(relationships);

      return res.status(200).json({
        success: true,
        data: decryptedRelationships,
      });
    } catch (error) {
      console.error("Error fetching relationships:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  },

  getAcceptRelationshipByFamilyId: async (req, res) => {
    try {
      const userId = req.user.userId; // Lấy từ token JWT
      const relationships = await Relationship.find({
        family: userId,
        status: "accepted",
      })
        .populate(
          "elderly",
          "fullName avatar phoneNumber phoneNumberEnc addressEnc addressHash currentLocation _id"
        )
        .populate("requestedBy", "fullName avatar phoneNumber phoneNumberEnc");

      const decryptedRelationships = decryptPhoneNumbers(relationships);

      return res.status(200).json({
        success: true,
        data: decryptedRelationships,
      });
    } catch (error) {
      console.error("Error fetching relationships:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  },

  getAllRelationshipsByFamilyId: async (req, res) => {
    try {
      const { familyId } = req.params;
      const { status } = req.query; 

      if (!familyId) {
        return res.status(400).json({
          success: false,
          message: "Thiếu thông tin familyId",
        });
      }

      const familyUser = await User.findById(familyId).select("role fullName avatar phoneNumber phoneNumberEnc");
      if (!familyUser) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy người dùng family",
        });
      }
      if (familyUser.role !== "family") {
        return res.status(400).json({
          success: false,
          message: "familyId không thuộc role family",
        });
      }

      const findFilter = { family: familyId };
      if (status) {
        findFilter.status = status;
      } else {
        findFilter.status = "accepted";
      }

      const relationships = await Relationship.find(findFilter)
        .populate("elderly", "fullName avatar phoneNumber phoneNumberEnc _id")
        .populate("family", "fullName avatar phoneNumber phoneNumberEnc _id")
        .populate("requestedBy", "fullName avatar phoneNumber phoneNumberEnc _id");

      const decrypted = decryptPhoneNumbers(relationships);

      // Chuẩn hóa dữ liệu phản hồi chỉ tập trung vào người nhà (elderly) và mối quan hệ
      const result = decrypted.map((rel) => ({
        relationshipId: rel._id,
        status: rel.status,
        relationship: rel.relationship,
        elderly: rel.elderly
          ? {
              _id: rel.elderly._id,
              fullName: rel.elderly.fullName || "Ẩn danh",
              avatar: rel.elderly.avatar,
              phoneNumber: rel.elderly.phoneNumber || null,
            }
          : null,
        // Chỉ trả tối thiểu thông tin family cho đối chiếu
        family: rel.family
          ? {
              _id: rel.family._id,
              fullName: rel.family.fullName || "Ẩn danh",
            }
          : null,
        createdAt: rel.createdAt,
        updatedAt: rel.updatedAt,
      }));

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Error fetching relationships by familyId:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  },

  cancelRelationship: async (req, res) => {
    try {
      const { relationshipId } = req.params;
      const userId = req.user.userId; // Lấy từ token JWT
      const relationship = await Relationship.findById(relationshipId);

      if (!relationship) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy mối quan hệ",
        });
      }
      if (
        relationship.elderly.toString() !== userId &&
        relationship.family.toString() !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Bạn không có quyền thực hiện hành động này",
        });
      }
      relationship.status = "cancelled";
      await relationship.save();

      // Emit deletion to involved users
      try {
        await relationship.populate("elderly", "fullName phoneNumber phoneNumberEnc");
        await relationship.populate("family", "fullName phoneNumber phoneNumberEnc");
        await relationship.populate("requestedBy", "fullName phoneNumber phoneNumberEnc");
        const decryptedRel = decryptPhoneNumbers([relationship])[0];
        const elderId = decryptedRel?.elderly?._id && String(decryptedRel.elderly._id);
        const famId = decryptedRel?.family?._id && String(decryptedRel.family._id);
        const requesterId = decryptedRel?.requestedBy?._id && String(decryptedRel.requestedBy._id);

        if (requesterId) socketConfig.emitToUser(requesterId, 'relationship_request_updated', { relationship: decryptedRel });
        if (elderId) socketConfig.emitToUser(elderId, 'relationship_deleted', { relationship: decryptedRel });
        if (famId) socketConfig.emitToUser(famId, 'relationship_deleted', { relationship: decryptedRel });
      } catch (emitErr) {
        console.error('Socket emit error (cancelRelationship):', emitErr.message);
      }

      return res.status(200).json({
        success: true,
        message: "Đã hủy kết nối thành công",
      });
    } catch (error) {
      console.error("Error canceling relationship:", error);
      return res.status(500).json({
        success: false,
        message: "Đã xảy ra lỗi khi hủy kết nối",
      });
    }
  },

  // hủy mối quan hệ bằng cách theo elderlyId và familyId
  cancelByElderlyAndFamily: async (req, res) => {
    try {
      const { elderlyId, familyId } = req.body;
      console.log("Elder and Family", elderlyId, familyId);
      
      if (!elderlyId || !familyId) {
        return res.status(400).json({
          success: false,
          message: "Thiếu thông tin elderlyId hoặc familyId",
        });
      }

      const relationship = await Relationship.findOne({
        elderly: elderlyId,
        family: familyId,
        status: "accepted",
      });
      if (!relationship) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy mối quan hệ",
        });
      }
      relationship.status = "cancelled";
      await relationship.save();

      // Emit deletion to involved users
      try {
        await relationship.populate("elderly", "fullName phoneNumber phoneNumberEnc");
        await relationship.populate("family", "fullName phoneNumber phoneNumberEnc");
        await relationship.populate("requestedBy", "fullName phoneNumber phoneNumberEnc");
        const decryptedRel = decryptPhoneNumbers([relationship])[0];
        const elderId = decryptedRel?.elderly?._id && String(decryptedRel.elderly._id);
        const famId = decryptedRel?.family?._id && String(decryptedRel.family._id);
        const requesterId = decryptedRel?.requestedBy?._id && String(decryptedRel.requestedBy._id);

        if (requesterId) socketConfig.emitToUser(requesterId, 'relationship_request_updated', { relationship: decryptedRel });
        if (elderId) socketConfig.emitToUser(elderId, 'relationship_deleted', { relationship: decryptedRel });
        if (famId) socketConfig.emitToUser(famId, 'relationship_deleted', { relationship: decryptedRel });
      } catch (emitErr) {
        console.error('Socket emit error (cancelByElderlyAndFamily):', emitErr.message);
      }

      return res.status(200).json({
        success: true,
        message: "Đã hủy kết nối thành công",
      });
    } catch (error) {
      console.error("Error canceling relationship:", error);
      return res.status(500).json({
        success: false,
        message: "Đã xảy ra lỗi khi hủy kết nối",
      });
    }
  },

  checkRelationshipsBulk: async (req, res) => {
    try {
      const { elderlyId, familyIds } = req.body || {};
      if (!elderlyId) return res.status(400).json({ success: false, message: 'Thiếu elderlyId' });
      if (!Array.isArray(familyIds) || familyIds.length === 0) {
        return res.status(200).json({ success: true, data: [] });
      }

      const rels = await Relationship.find({ elderly: elderlyId, family: { $in: familyIds } }).lean();

      const map = new Map();
      rels.forEach(r => {
        const famId = String(r.family);
        map.set(famId, {
          familyId: famId,
          status: r.status || null,
          relationship: r.relationship || null,
          requestedBy: r.requestedBy || null,
        });
      });

      const result = familyIds.map(fid => map.get(String(fid)) || { familyId: String(fid), status: null, relationship: null, requestedBy: null });

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      console.error('checkRelationshipsBulk error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = RelationshipController;
