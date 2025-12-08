const SupporterService = require("../models/SupporterServices");

const supporterServicesController = {
    // Tạo dịch vụ hỗ trợ mới
    createService: async (req, res) => {
    try {
        const { name, description, price, numberOfDays } = req.body;

        // Validate bắt buộc
        if (!name || name.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Tên dịch vụ là bắt buộc"
            });
        }

        if (price === undefined || price === null) {
            return res.status(400).json({
                success: false,
                message: "Giá là bắt buộc"
            });
        }

        if (price < 0) {
            return res.status(400).json({
                success: false,
                message: "Giá không thể âm"
            });
        }

        if (!numberOfDays || numberOfDays < 7) {
            return res.status(400).json({
                success: false,
                message: "Số ngày phải >= 7"
            });
        }

        const newService = await SupporterService.create({
            name: name.trim(),
            description: description?.trim() || "",
            price: Number(price),
            numberOfDays: Number(numberOfDays)
        });

        res.status(201).json({
            success: true,
            message: "Tạo dịch vụ hỗ trợ thành công",
            data: newService
        });

    } catch (error) {
        console.error("Error creating supporter service:", error);

        res.status(500).json({
            success: false,
            message: "Tạo dịch vụ hỗ trợ thất bại",
            error: error.message
        });
    }
    },
    // Lấy danh sách tất cả dịch vụ hỗ trợ
    getAllServices: async (req, res) => {
        try {
            const services = await SupporterService.find();
            res.status(200).json({ 
                success: true,
                message: 'Lấy danh sách dịch vụ hỗ trợ thành công', 
                data: services 
            });
        } catch (error) {
            console.error('Error fetching supporter services:', error);
            res.status(500).json({ 
                success: false,
                message: 'Lấy danh sách dịch vụ hỗ trợ thất bại', 
                error: error.message
            });
        }
    },
    // Cập nhật dịch vụ hỗ trợ theo id
    updateServiceById: async (req, res) => {
        try {
            const serviceId = req.params.id;
            const { name, description, price, numberOfDays } = req.body;

            // Validate
            if (name !== undefined && (name.trim() === "" || name.trim().length === 0)) {
                return res.status(400).json({
                    success: false,
                    message: "Tên dịch vụ không được để trống"
                });
            }

            if (price !== undefined && price < 0) {
                return res.status(400).json({
                    success: false,
                    message: "Giá không thể âm"
                });
            }

            if (numberOfDays !== undefined && numberOfDays < 7) {
                return res.status(400).json({
                    success: false,
                    message: "Số ngày phải >= 7"
                });
            }

            const updateData = {};
            if (name !== undefined) updateData.name = name.trim();
            if (description !== undefined) updateData.description = description.trim();
            if (price !== undefined) updateData.price = Number(price);
            if (numberOfDays !== undefined) updateData.numberOfDays = Number(numberOfDays);

            const updatedService = await SupporterService.findByIdAndUpdate(
                serviceId, 
                updateData, 
                { new: true, runValidators: true }
            );

            if (!updatedService) {
                return res.status(404).json({
                    success: false,
                    message: "Dịch vụ hỗ trợ không tồn tại"
                });
            }

            res.status(200).json({ 
                success: true,
                message: 'Cập nhật dịch vụ hỗ trợ thành công', 
                data: updatedService 
            });
        } catch (error) {
            console.error('Error updating supporter service:', error);
            res.status(500).json({ 
                success: false,
                message: 'Cập nhật dịch vụ hỗ trợ thất bại', 
                error: error.message
            });
        }
    },  
    // Xoá dịch vụ hỗ trợ theo id
    deleteServiceById: async (req, res) => {
        try {
            const serviceId = req.params.id;
            const deletedService = await SupporterService.findByIdAndDelete(serviceId);
            
            if (!deletedService) {
                return res.status(404).json({
                    success: false,
                    message: "Dịch vụ hỗ trợ không tồn tại"
                });
            }

            res.status(200).json({ 
                success: true,
                message: 'Xoá dịch vụ hỗ trợ thành công',
                data: deletedService
            });
        } catch (error) {
            console.error('Error deleting supporter service:', error);
            res.status(500).json({ 
                success: false,
                message: 'Xoá dịch vụ hỗ trợ thất bại', 
                error: error.message
            });
        }
    },

    // Lấy dịch vụ hỗ trợ theo id
    getServiceById: async (req, res) => {
        try {
            const serviceId = req.params.id;
            const service = await SupporterService.findById(serviceId);
            if (!service) {
                return res.status(404).json({ 
                    success: false,
                    message: 'Dịch vụ hỗ trợ không tồn tại' 
                });
            }
            res.status(200).json({ 
                success: true,
                message: 'Lấy dịch vụ hỗ trợ thành công', 
                data: service 
            });
        } catch (error) {
            console.error('Error fetching supporter service by ID:', error);
            res.status(500).json({ 
                success: false,
                message: 'Lấy dịch vụ hỗ trợ thất bại', 
                error: error.message
            });
        }
    },
};

module.exports = supporterServicesController;