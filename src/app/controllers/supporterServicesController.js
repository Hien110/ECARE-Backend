const SupporterService = require("../models/SupporterServices");

const supporterServicesController = {
    // Tạo dịch vụ hỗ trợ mới
    createService: async (req, res) => {
    try {
        const data = req.body;

        // Validate gói tháng
        if (data.byMonth?.enabled === true) {
            if (
                !Array.isArray(data.byMonth.sessionsPerDay) ||
                data.byMonth.sessionsPerDay.length < 1
            ) {
                return res.status(400).json({
                    message: "sessionsPerDay bắt buộc khi bật gói tháng"
                });
            }
        }

        const newService = await SupporterService.create(data);

        res.status(201).json({
            message: "Tạo dịch vụ hỗ trợ thành công",
            data: newService
        });

    } catch (error) {
        console.error("Error creating supporter service:", error);

        res.status(500).json({
            message: "Tạo dịch vụ hỗ trợ thất bại",
            error: error.message
        });
    }
    },
    // Lấy danh sách tất cả dịch vụ hỗ trợ
    getAllServices: async (req, res) => {
        try {
            const services = await SupporterService.find();
            res.status(200).json({ message: 'Lấy danh sách dịch vụ hỗ trợ thành công', data: services });
        }   catch (error) {
            console.error('Error fetching supporter services:', error);
            res.status(500).json({ message: 'Lấy danh sách dịch vụ hỗ trợ thất bại', error });
        }
    },
    // Cập nhật dịch vụ hỗ trợ theo id
    updateServiceById: async (req, res) => {
        try {
            const serviceId = req.params.id;
            const updateData = req.body;
            const updatedService = await SupporterService.findByIdAndUpdate(serviceId, updateData, { new: true });
            res.status(200).json({ message: 'Cập nhật dịch vụ hỗ trợ thành công', data: updatedService });
        } catch (error) {
            console.error('Error updating supporter service:', error);
            res.status(500).json({ message: 'Cập nhật dịch vụ hỗ trợ thất bại', error });
        }
    },  
    // Xoá dịch vụ hỗ trợ theo id
    deleteServiceById: async (req, res) => {
        try {
            const serviceId = req.params.id;
            await SupporterService.findByIdAndDelete(serviceId);
            res.status(200).json({ message: 'Xoá dịch vụ hỗ trợ thành công' });
        } catch (error) {
            console.error('Error deleting supporter service:', error);
            res.status(500).json({ message: 'Xoá dịch vụ hỗ trợ thất bại', error });
        }
    },

    // Lấy dịch vụ hỗ trợ theo id
    getServiceById: async (req, res) => {
        try {
            const serviceId = req.params.id;
            const service = await SupporterService.findById(serviceId);
            if (!service) {
                return res.status(404).json({ message: 'Dịch vụ hỗ trợ không tồn tại' });
            }
            res.status(200).json({ message: 'Lấy dịch vụ hỗ trợ thành công', data: service });
        } catch (error) {
            console.error('Error fetching supporter service by ID:', error);
            res.status(500).json({ message: 'Lấy dịch vụ hỗ trợ thất bại', error });
        }
    },
};

module.exports = supporterServicesController;