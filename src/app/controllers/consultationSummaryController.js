const mongoose = require('mongoose');
const ConsultationSummary = require('../models/ConsultationSummary');
const RegistrationConsulation = require('../models/RegistrationConsulation');
const DoctorProfile = require('../models/DoctorProfile');
const Relationship = require('../models/Relationship');
const { tryDecryptField } = require('./userController');

function getUserIdFromReq(req) {
  if (!req || !req.user) return null;
  return req.user._id || req.user.id || req.user.userId || null;
}

function mapUserForResponse(user) {
  if (!user) return null;
  const mapped = { ...user };

  if (mapped.fullName != null) {
    mapped.fullName = tryDecryptField(mapped.fullName);
  }

  if (mapped.phoneNumber != null) {
    mapped.phoneNumber = tryDecryptField(mapped.phoneNumber);
  }

  if (mapped.currentAddress != null) {
    mapped.currentAddress = tryDecryptField(mapped.currentAddress);
  }

  return mapped;
}

const consultationSummaryController = {
  async upsertByRegistration(req, res) {
    try {
      const { registrationId } = req.params;
      const payload = req.body || {};

      if (!registrationId) {
        return res.status(400).json({ message: 'Thiếu registrationId' });
      }

      const update = {
        mainDisease: payload.mainDisease ?? '',
        medications: payload.medications ?? '',
        mobility: payload.mobility ?? '',
        bathing: payload.bathing ?? '',
        feeding: payload.feeding ?? '',
        systolic: payload.systolic,
        diastolic: payload.diastolic,
        pulse: payload.pulse,
        weight: payload.weight,
        bloodSugar: payload.bloodSugar ?? '',
        note: payload.note ?? '',
      };

      const summary = await ConsultationSummary.findOneAndUpdate(
        { registration: registrationId },
        { $set: { registration: registrationId, ...update } },
        { new: true, upsert: true }
      );

      
      try {
        const updatedRegistration = await RegistrationConsulation.findOneAndUpdate(
          { _id: registrationId, status: { $ne: 'completed' } },
          { $set: { status: 'completed', paymentStatus: 'paid' } },
          { new: true },
        );

        if (updatedRegistration && updatedRegistration.doctor) {
          await DoctorProfile.findOneAndUpdate(
            { user: updatedRegistration.doctor },
            { $inc: { 'stats.totalConsultations': 1 } },
            { new: true },
          );
        }
      } catch (autoErr) {
        console.error('AUTO COMPLETE REGISTRATION / UPDATE DOCTOR PROFILE ERROR:', autoErr);
      }

      return res.status(200).json({
        message: 'Lưu tóm tắt tư vấn thành công',
        data: summary,
      });
    } catch (error) {
      console.error('UPSERT CONSULTATION SUMMARY ERROR:', error);
      return res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
  },

  async getByRegistration(req, res) {
    try {
      const { registrationId } = req.params;

      if (!registrationId) {
        return res.status(400).json({ message: 'Thiếu registrationId' });
      }

      const summary = await ConsultationSummary.findOne({
        registration: registrationId,
      }).populate('registration');

      if (!summary) {
        return res.status(404).json({ message: 'Không tìm thấy tóm tắt tư vấn' });
      }

      return res.status(200).json({
        message: 'Lấy tóm tắt tư vấn thành công',
        data: summary,
      });
    } catch (error) {
      console.error('GET CONSULTATION SUMMARY ERROR:', error);
      return res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
  },

  async getDoctorAndBeneficiary(req, res) {
    try {
      const { registrationId } = req.params;

      if (!registrationId) {
        return res.status(400).json({ message: 'Thiếu registrationId' });
      }

      const registration = await RegistrationConsulation.findById(registrationId)
        .populate({
          path: 'doctor',
          select:
            'fullName avatar gender dateOfBirth role phoneNumber isActive currentAddress',
        })
        .populate({
          path: 'beneficiary',
          select:
            'fullName avatar gender dateOfBirth role phoneNumber isActive currentAddress',
        })
        .populate({
          path: 'registrant',
          select:
            'fullName avatar gender dateOfBirth role phoneNumber isActive currentAddress',
        })
        .lean();

      if (!registration) {
        return res.status(404).json({ message: 'Không tìm thấy lịch tư vấn' });
      }

      const beneficiaryUser = registration.beneficiary || registration.registrant || null;

      const doctorSafe = mapUserForResponse(registration.doctor || null);
      const beneficiarySafe = mapUserForResponse(beneficiaryUser);

      return res.status(200).json({
        message: 'Lấy thông tin người khám và người được khám thành công',
        data: {
          doctor: doctorSafe,
          beneficiary: beneficiarySafe,
        },
      });
    } catch (error) {
      console.error('GET DOCTOR & BENEFICIARY BY REGISTRATION ERROR:', error);
      return res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
  },

  async deleteByRegistration(req, res) {
    try {
      const { registrationId } = req.params;

      if (!registrationId) {
        return res.status(400).json({ message: 'Thiếu registrationId' });
      }

      const deleted = await ConsultationSummary.findOneAndDelete({
        registration: registrationId,
      });

      if (!deleted) {
        return res.status(404).json({ message: 'Không tìm thấy tóm tắt tư vấn để xóa' });
      }

      return res.status(200).json({
        message: 'Xóa tóm tắt tư vấn thành công',
      });
    } catch (error) {
      console.error('DELETE CONSULTATION SUMMARY ERROR:', error);
      return res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
  },

  async getSummariesByElderly(req, res) {
    try {
      const requesterId = getUserIdFromReq(req);
      const role = (req.user?.role || '').toLowerCase();
      const { elderlyId } = req.params || {};

      if (!requesterId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (!elderlyId || !mongoose.Types.ObjectId.isValid(elderlyId)) {
        return res.status(400).json({ message: 'elderlyId không hợp lệ' });
      }

      let canView = false;

      if (role === 'elderly' && String(requesterId) === String(elderlyId)) {
        canView = true;
      }

      if (!canView && role === 'family') {
        const rel = await Relationship.findOne({
          elderly: elderlyId,
          family: requesterId,
          status: 'accepted',
        })
          .select('_id')
          .lean();

        if (rel) canView = true;
      }

      if (!canView && (role === 'doctor' || role === 'admin')) {
        canView = true;
      }

      if (!canView) {
        return res.status(403).json({
          message: 'Bạn không có quyền xem lịch sử phiếu khám của người cao tuổi này.',
        });
      }

      const registrations = await RegistrationConsulation.find({
        beneficiary: elderlyId,
      })
        .select('_id doctor registrant beneficiary scheduledDate slot status')
        .lean();

      if (!registrations.length) {
        return res.status(200).json({
          message: 'Không có phiếu khám nào',
          data: [],
        });
      }

      const regIds = registrations.map((r) => r._id);

      const summaries = await ConsultationSummary.find({
        registration: { $in: regIds },
      })
        .populate({
          path: 'registration',
          populate: [
            {
              path: 'doctor',
              select:
                'fullName avatar gender dateOfBirth role phoneNumber isActive currentAddress',
            },
            {
              path: 'beneficiary',
              select:
                'fullName avatar gender dateOfBirth role phoneNumber isActive currentAddress',
            },
            {
              path: 'registrant',
              select:
                'fullName avatar gender dateOfBirth role phoneNumber isActive currentAddress',
            },
          ],
        })
        .sort({ createdAt: -1 })
        .lean();

      const data = summaries.map((s) => {
        const reg = s.registration || null;
        const beneficiaryUser =
          (reg && (reg.beneficiary || reg.registrant)) || null;

        return {
          ...s,
          doctor: mapUserForResponse(reg?.doctor || null),
          beneficiary: mapUserForResponse(beneficiaryUser),
        };
      });

      return res.status(200).json({
        message: 'Lấy lịch sử phiếu khám thành công',
        data,
      });
    } catch (error) {
      console.error('GET SUMMARIES BY ELDERLY ERROR:', error);
      return res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
  },
};

module.exports = consultationSummaryController;
