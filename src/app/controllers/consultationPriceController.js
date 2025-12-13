const ConsultationPrice = require('../models/ConsultationPrice');

const consultationPriceController = {
  // Get all consultation prices
  getAllPrices: async (req, res) => {
    try {
      const prices = await ConsultationPrice.find().sort({ createdAt: -1 }).lean();
      
      return res.json({
        success: true,
        data: prices,
        message: 'Lấy danh sách giá tư vấn thành công',
      });
    } catch (error) {
      console.error('GET ALL CONSULTATION PRICES ERROR:', error);
      return res.status(500).json({
        success: false,
        message: 'Lỗi máy chủ',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Get single consultation price by ID
  getPriceById: async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'ID giá tư vấn không được để trống',
        });
      }

      const price = await ConsultationPrice.findById(id).lean();
      
      if (!price) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy giá tư vấn',
        });
      }

      return res.json({
        success: true,
        data: price,
        message: 'Lấy chi tiết giá tư vấn thành công',
      });
    } catch (error) {
      console.error('GET CONSULTATION PRICE BY ID ERROR:', error);
      return res.status(500).json({
        success: false,
        message: 'Lỗi máy chủ',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Create new consultation price
  createPrice: async (req, res) => {
    try {
      const { serviceName, price, decripton, isActive } = req.body;

      // Validation
      if (!serviceName) {
        return res.status(400).json({
          success: false,
          message: 'Tên dịch vụ không được để trống',
        });
      }

      if (price === undefined || price === null) {
        return res.status(400).json({
          success: false,
          message: 'Giá không được để trống',
        });
      }

      if (price < 0) {
        return res.status(400).json({
          success: false,
          message: 'Giá phải là số dương',
        });
      }

      // Check if serviceName already exists
      const existing = await ConsultationPrice.findOne({ serviceName });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Tên dịch vụ đã tồn tại',
        });
      }

      const newPrice = new ConsultationPrice({
        serviceName,
        price: Number(price),
        decripton,
        isActive: isActive !== undefined ? isActive : true,
      });

      await newPrice.save();

      return res.status(201).json({
        success: true,
        data: newPrice,
        message: 'Tạo giá tư vấn thành công',
      });
    } catch (error) {
      console.error('CREATE CONSULTATION PRICE ERROR:', error);
      return res.status(500).json({
        success: false,
        message: 'Lỗi máy chủ',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Update consultation price
  updatePrice: async (req, res) => {
    try {
      const { id } = req.params;
      const { serviceName, price, decripton, isActive } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'ID giá tư vấn không được để trống',
        });
      }

      const existingPrice = await ConsultationPrice.findById(id);
      if (!existingPrice) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy giá tư vấn',
        });
      }

      // Update fields if provided
      if (serviceName) {
        // Check if new serviceName already exists in other documents
        const duplicate = await ConsultationPrice.findOne({
          _id: { $ne: id },
          serviceName,
        });
        if (duplicate) {
          return res.status(400).json({
            success: false,
            message: 'Tên dịch vụ đã tồn tại',
          });
        }
        existingPrice.serviceName = serviceName;
      }

      if (price !== undefined && price !== null) {
        if (price < 0) {
          return res.status(400).json({
            success: false,
            message: 'Giá phải là số dương',
          });
        }
        existingPrice.price = Number(price);
      }

      if (decripton !== undefined) {
        existingPrice.decripton = decripton;
      }

      if (isActive !== undefined) {
        existingPrice.isActive = isActive;
      }

      await existingPrice.save();

      return res.json({
        success: true,
        data: existingPrice,
        message: 'Cập nhật giá tư vấn thành công',
      });
    } catch (error) {
      console.error('UPDATE CONSULTATION PRICE ERROR:', error);
      return res.status(500).json({
        success: false,
        message: 'Lỗi máy chủ',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  // Delete consultation price
  deletePrice: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'ID giá tư vấn không được để trống',
        });
      }

      const price = await ConsultationPrice.findByIdAndDelete(id);
      
      if (!price) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy giá tư vấn',
        });
      }

      return res.json({
        success: true,
        data: price,
        message: 'Xóa giá tư vấn thành công',
      });
    } catch (error) {
      console.error('DELETE CONSULTATION PRICE ERROR:', error);
      return res.status(500).json({
        success: false,
        message: 'Lỗi máy chủ',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
};

module.exports = consultationPriceController;
