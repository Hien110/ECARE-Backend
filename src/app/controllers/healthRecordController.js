const HealthRecord = require('../models/HealthRecord');
const User = require('../models/User');
const Relationship = require("../models/Relationship")
// Helper: compute BMI and category
const computeBMI = (weightKg, heightCm) => {
  if (!weightKg || !heightCm) return { value: undefined, category: undefined };
  const heightM = heightCm / 100;
  const value = Number((weightKg / (heightM * heightM)).toFixed(1));
  let category;
  if (value < 18.5) category = 'underweight';
  else if (value < 23) category = 'normal'; // Asian cutoff
  else if (value < 25) category = 'overweight';
  else category = 'obese';
  return { value, category };
};

const healthRecordController = {

  // POST /api/health-records
  createRecord: async (req, res) => {
    try {
      console.log('=== CREATE RECORD DEBUG ===');
      console.log('req.user:', req.user);
      const userId = req.user?.userId;
      console.log('userId:', userId);
      
      // Check if user exists and has elderly role
      const user = await User.findById(userId);
      console.log('user found:', user ? 'YES' : 'NO');
      if (user) {
        console.log('user role:', user.role);
      }
      
      if (!user) {
        console.log('ERROR: User not found');
        return res.status(404).json({ message: 'Người dùng không tồn tại' });
      }
      
      if (user.role !== 'elderly') {
        console.log('ERROR: User role is not elderly');
        return res.status(403).json({ message: 'Chỉ người dùng cao tuổi mới có thể tạo nhật ký sức khỏe' });
      }

      const {
        recordDate,
        vitals = {},
        emotional = {},
        activities = {},
        notes,
      } = req.body || {};

      console.log('Request body:', JSON.stringify(req.body, null, 2));

      // Normalize vitals
      const weightValue = vitals?.weight?.value ?? vitals?.weight;
      const heightValue = vitals?.height?.value ?? vitals?.height;
      const bmi = computeBMI(weightValue, heightValue);

      console.log('BMI calculated:', bmi);

      // Calculate day range based on provided recordDate or today
      const baseDate = recordDate ? new Date(recordDate) : new Date();
      const startOfDay = new Date(baseDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(baseDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Check if there is already a record for this elderly today
      const existingToday = await HealthRecord.findOne({
        elderly: userId,
        recordDate: { $gte: startOfDay, $lte: endOfDay },
      }).sort({ createdAt: -1 });

      // Prepare data payload
      const healthRecordData = {
        elderly: userId,
        // Always keep recordDate within the day; if updating, preserve existing recordDate
        recordDate: existingToday ? existingToday.recordDate : new Date(baseDate),
        vitals: {
          bloodPressure: vitals?.bloodPressure,
          heartRate: vitals?.heartRate,
          bloodSugar: vitals?.bloodSugar,
          weight: weightValue ? { value: weightValue } : undefined,
          height: heightValue ? { value: heightValue } : undefined,
          bmi,
          temperature: vitals?.temperature,
        },
        emotional,
        activities,
        notes,
      };

      console.log(
        existingToday
          ? 'Existing record found for today. Updating the document.'
          : 'No record for today. Creating a new document.'
      );
      console.log('Health record payload:', JSON.stringify(healthRecordData, null, 2));

      let doc;
      if (existingToday) {
        // Merge: ensure we don't wipe out sub-docs when some fields are missing
        const update = {
          $set: {
            recordDate: healthRecordData.recordDate,
            notes: healthRecordData.notes,
            emotional: healthRecordData.emotional,
            activities: healthRecordData.activities,
            'vitals.bloodPressure': healthRecordData.vitals.bloodPressure,
            'vitals.heartRate': healthRecordData.vitals.heartRate,
            'vitals.bloodSugar': healthRecordData.vitals.bloodSugar,
            'vitals.temperature': healthRecordData.vitals.temperature,
            'vitals.bmi': healthRecordData.vitals.bmi,
          },
        };

        // Only set weight/height when provided to avoid clearing existing values
        if (healthRecordData.vitals.weight) {
          update.$set['vitals.weight'] = healthRecordData.vitals.weight;
        }
        if (healthRecordData.vitals.height) {
          update.$set['vitals.height'] = healthRecordData.vitals.height;
        }

        doc = await HealthRecord.findByIdAndUpdate(existingToday._id, update, { new: true });
        console.log('Health record updated successfully:', doc._id);
        return res.status(200).json({ message: 'Đã cập nhật nhật ký sức khỏe hôm nay', data: doc });
      }

      doc = await HealthRecord.create(healthRecordData);
      console.log('Health record created successfully:', doc._id);
      return res.status(201).json({ message: 'Đã lưu nhật ký sức khỏe', data: doc });
    } catch (error) {
      console.error('=== CREATE RECORD ERROR ===');
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      console.error('Full error:', error);
      return res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
  },

  // GET /api/health-records/today
  getTodayRecord: async (req, res) => {
    try {
      console.log('=== GET TODAY RECORD DEBUG ===');
      console.log('req.user:', req.user);
      const userId = req.user?.userId;
      console.log('userId:', userId);
      
      // Check if user exists and has elderly role
      const user = await User.findById(userId);
      console.log('user found:', user ? 'YES' : 'NO');
      if (user) {
        console.log('user role:', user.role);
      }
      
      if (!user) {
        console.log('ERROR: User not found');
        return res.status(404).json({ message: 'Người dùng không tồn tại' });
      }
      
      if (user.role !== 'elderly') {
        console.log('ERROR: User role is not elderly');
        return res.status(403).json({ message: 'Chỉ người dùng cao tuổi mới có thể xem nhật ký sức khỏe' });
      }
      
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);

      console.log('Searching for records between:', start, 'and', end);
      const doc = await HealthRecord.findOne({ elderly: userId, recordDate: { $gte: start, $lte: end } }).sort({ createdAt: -1 });
      console.log('Today record found:', doc ? 'YES' : 'NO');
      if (doc) {
        console.log('Record ID:', doc._id);
      }
      
      return res.status(200).json({ message: 'Bản ghi hôm nay', data: doc });
    } catch (error) {
      console.error('=== GET TODAY RECORD ERROR ===');
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      return res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
  },

  // GET /api/health-records?from=...&to=...
  listRecords: async (req, res) => {
    try {
      console.log('=== LIST RECORDS DEBUG ===');
      console.log('req.user:', req.user);
      const userId = req.user?.userId;
      console.log('userId:', userId);
      console.log('query params:', req.query);
      
      // Check if user exists and has elderly role
      const user = await User.findById(userId);
      console.log('user found:', user ? 'YES' : 'NO');
      if (user) {
        console.log('user role:', user.role);
      }
      
      if (!user) {
        console.log('ERROR: User not found');
        return res.status(404).json({ message: 'Người dùng không tồn tại' });
      }
      
      if (user.role !== 'elderly') {
        console.log('ERROR: User role is not elderly');
        return res.status(403).json({ message: 'Chỉ người dùng cao tuổi mới có thể xem danh sách nhật ký sức khỏe' });
      }
      
      const { from, to, limit = 30 } = req.query;
      const filter = { elderly: userId };
      if (from || to) {
        filter.recordDate = {};
        if (from) filter.recordDate.$gte = new Date(from);
        if (to) filter.recordDate.$lte = new Date(to);
      }
      
      console.log('Filter for records:', JSON.stringify(filter, null, 2));
      const docs = await HealthRecord.find(filter).sort({ recordDate: -1 }).limit(Number(limit));
      console.log('Records found:', docs.length);
      
      return res.status(200).json({ message: 'Danh sách nhật ký', data: docs });
    } catch (error) {
      console.error('=== LIST RECORDS ERROR ===');
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      return res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
  },
    // Lấy dữ liệu sức khỏe của người già cho người thân
  async getElderlyHealthData(req, res) {
    try {
      console.log('=== GET ELDERLY HEALTH DATA ===');
      const { elderlyId } = req.params
      const { period = "day", startDate, endDate } = req.query
      const familyId = req.user?.userId

      console.log('Request params:', { elderlyId, period, startDate, endDate });
      console.log('Family ID:', familyId);

      // Ensure requester is family
      const requester = await User.findById(familyId)
      console.log('Requester:', requester ? { id: requester._id, role: requester.role } : 'NOT FOUND');
      
      if (!requester || requester.role !== "family") {
        console.log('ERROR: Not a family member');
        return res.status(403).json({
          success: false,
          message: "Chỉ người thân mới có thể xem dữ liệu sức khỏe",
        })
      }

      // Kiểm tra quyền truy cập
      console.log('Checking relationship permissions...');
      const relationship = await Relationship.findOne({
        elderly: elderlyId,
        family: familyId,
        status: "accepted",
        "permissions.viewHealthData": true,
      })

      console.log('Relationship found:', relationship ? 'YES' : 'NO');
      if (relationship) {
        console.log('Relationship details:', {
          id: relationship._id,
          status: relationship.status,
          permissions: relationship.permissions
        });
      }

      // Also check without permissions filter for debugging
      const relationshipAny = await Relationship.findOne({
        elderly: elderlyId,
        family: familyId,
        status: "accepted",
      })
      console.log('Relationship without permission filter:', relationshipAny ? 'YES' : 'NO');
      if (relationshipAny) {
        console.log('Any relationship permissions:', relationshipAny.permissions);
      }

      if (!relationship) {
        console.log('ERROR: No permission to view health data');
        return res.status(403).json({
          success: false,
          message: "Bạn không có quyền xem dữ liệu sức khỏe của người này",
        })
      }

      // Xây dựng query dựa trên period
      let dateQuery = {}
      const now = new Date()

      if (startDate && endDate) {
        dateQuery = {
          recordDate: {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          },
        }
      } else {
        switch (period) {
          case "day":
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const tomorrow = new Date(today)
            tomorrow.setDate(tomorrow.getDate() + 1)
            dateQuery = {
              recordDate: {
                $gte: today,
                $lt: tomorrow,
              },
            }
            break
          case "week":
            const weekAgo = new Date()
            weekAgo.setDate(weekAgo.getDate() - 7)
            dateQuery = {
              recordDate: {
                $gte: weekAgo,
                $lte: now,
              },
            }
            break
          case "month":
            const monthAgo = new Date()
            monthAgo.setMonth(monthAgo.getMonth() - 1)
            dateQuery = {
              recordDate: {
                $gte: monthAgo,
                $lte: now,
              },
            }
            break
        }
      }

      // Lấy dữ liệu từ database
      const healthRecords = await HealthRecord.find({
        elderly: elderlyId,
        ...dateQuery,
      }).sort({ recordDate: -1 })

      // Xử lý dữ liệu dựa trên period
      let processedData
      if (period === "day") {
        processedData = healthRecords
      } else {
        processedData = healthRecordController.aggregateHealthData(healthRecords, period)
      }

      // Lấy thông tin người già
      const elderlyInfo = await User.findById(elderlyId).select("fullName avatar dateOfBirth")

      res.json({
        success: true,
        data: {
          elderly: elderlyInfo,
          period,
          records: processedData,
          summary: healthRecordController.generateHealthSummary(processedData, period),
        },
      })
    } catch (error) {
      console.error("Error fetching elderly health data:", error)
      res.status(500).json({
        success: false,
        message: "Lỗi server khi lấy dữ liệu sức khỏe",
      })
    }
  },

  // Tính toán trung bình cho tuần/tháng
  aggregateHealthData(records, period) {
    if (records.length === 0) return []

    const groupedData = {}

    records.forEach((record) => {
      let groupKey
      const date = new Date(record.recordDate)

      if (period === "week") {
        // Nhóm theo tuần
        const weekStart = new Date(date)
        weekStart.setDate(date.getDate() - date.getDay())
        groupKey = weekStart.toISOString().split("T")[0]
      } else if (period === "month") {
        // Nhóm theo tháng
        groupKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
      }

      if (!groupedData[groupKey]) {
        groupedData[groupKey] = []
      }
      groupedData[groupKey].push(record)
    })

    // Tính trung bình cho mỗi nhóm
    return Object.keys(groupedData)
      .map((key) => {
        const groupRecords = groupedData[key]
        return healthRecordController.calculateAverageRecord(groupRecords, key)
      })
      .sort((a, b) => new Date(b.recordDate) - new Date(a.recordDate))
  },

  // Tính trung bình các chỉ số sức khỏe
  calculateAverageRecord(records, dateKey) {
    const validRecords = records.filter((r) => r.vitals)

    if (validRecords.length === 0) {
      return {
        recordDate: dateKey,
        vitals: {},
        emotional: {},
        activities: {},
        recordCount: records.length,
      }
    }

    const avgRecord = {
      recordDate: dateKey,
      recordCount: records.length,
      vitals: {},
      emotional: {},
      activities: {},
    }

    // Tính trung bình nhịp tim
    const heartRateValues = validRecords.map((r) => r.vitals.heartRate?.value).filter((v) => v != null)
    if (heartRateValues.length > 0) {
      avgRecord.vitals.heartRate = {
        value: Math.round((heartRateValues.reduce((sum, v) => sum + v, 0) / heartRateValues.length) * 10) / 10,
        unit: "bpm",
      }
    }

    // Tính trung bình đường huyết
    const bloodSugarValues = validRecords.map((r) => r.vitals.bloodSugar?.value).filter((v) => v != null)
    if (bloodSugarValues.length > 0) {
      avgRecord.vitals.bloodSugar = {
        value: Math.round((bloodSugarValues.reduce((sum, v) => sum + v, 0) / bloodSugarValues.length) * 10) / 10,
        unit: "mg/dL",
      }
    }

    // Tính trung bình huyết áp
    const bpSystolic = validRecords.map((r) => r.vitals.bloodPressure?.systolic).filter((v) => v != null)
    const bpDiastolic = validRecords.map((r) => r.vitals.bloodPressure?.diastolic).filter((v) => v != null)

    if (bpSystolic.length > 0 && bpDiastolic.length > 0) {
      avgRecord.vitals.bloodPressure = {
        systolic: Math.round(bpSystolic.reduce((sum, v) => sum + v, 0) / bpSystolic.length),
        diastolic: Math.round(bpDiastolic.reduce((sum, v) => sum + v, 0) / bpDiastolic.length),
        unit: "mmHg",
      }
    }

    // Lấy giá trị gần nhất cho emotional và activities
    const latestRecord = validRecords[0]
    if (latestRecord.emotional) {
      avgRecord.emotional = latestRecord.emotional
    }
    if (latestRecord.activities) {
      avgRecord.activities = latestRecord.activities
    }

    return avgRecord
  },

  // Tạo tóm tắt dữ liệu sức khỏe cho family
  generateHealthSummary(records, period) {
    const result = {
      count: Array.isArray(records) ? records.length : 0,
      latest: null,
      ranges: {
        bloodPressure: null,
        heartRate: null,
        bloodSugar: null,
        bmi: null,
        temperature: null,
      },
      trend: {
        bloodPressure: null,
        heartRate: null,
        bloodSugar: null,
        bmi: null,
        temperature: null,
      },
    }

    if (!Array.isArray(records) || records.length === 0) return result

    // Latest record
    const latest = records[0]
    result.latest = {
      recordDate: latest.recordDate,
      vitals: latest.vitals || {},
    }

    // Prepare arrays for stats
    const values = {
      systolic: [],
      diastolic: [],
      heartRate: [],
      bloodSugar: [],
      bmi: [],
      temperature: [],
    }

    records.forEach((r) => {
      const v = r.vitals || {}
      if (v.bloodPressure?.systolic != null) values.systolic.push(v.bloodPressure.systolic)
      if (v.bloodPressure?.diastolic != null) values.diastolic.push(v.bloodPressure.diastolic)
      if (v.heartRate?.value != null) values.heartRate.push(v.heartRate.value)
      if (v.bloodSugar?.value != null) values.bloodSugar.push(v.bloodSugar.value)
      if (v.bmi?.value != null) values.bmi.push(v.bmi.value)
      if (v.temperature?.value != null) values.temperature.push(v.temperature.value)
    })

    const calcRange = (arr) => (arr.length ? { min: Math.min(...arr), max: Math.max(...arr), avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) } : null)

    result.ranges.bloodPressure = values.systolic.length && values.diastolic.length
      ? {
          systolic: calcRange(values.systolic),
          diastolic: calcRange(values.diastolic),
        }
      : null
    result.ranges.heartRate = calcRange(values.heartRate)
    result.ranges.bloodSugar = calcRange(values.bloodSugar)
    result.ranges.bmi = calcRange(values.bmi)
    result.ranges.temperature = calcRange(values.temperature)

    // Simple trend: compare first and last (by provided order)
    const trendOf = (arr) => (arr.length >= 2 ? Math.sign(arr[0] - arr[arr.length - 1]) : null)
    result.trend.bloodPressure = values.systolic.length && values.diastolic.length
      ? {
          systolic: trendOf(values.systolic),
          diastolic: trendOf(values.diastolic),
        }
      : null
    result.trend.heartRate = trendOf(values.heartRate)
    result.trend.bloodSugar = trendOf(values.bloodSugar)
    result.trend.bmi = trendOf(values.bmi)
    result.trend.temperature = trendOf(values.temperature)

    result.period = period
    return result
  },
}
module.exports = healthRecordController;


