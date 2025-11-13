Use Case 1: Đăng ký & đăng nhập
Features:
Đăng ký tài khoản: B1: Số điện thoại, mật khẩu, nhập lại mk.
		       B2: Xác thực số điện thoại qua sms.
	                   B3: Chụp căn cước 2 mặt.
		        B4: Mã hóa thông tin cá nhân (mã hóa toàn bộ trừ Tên, giới tính).       
Đăng nhập bằng số điện thoại - mật khẩu 
Quên mật khẩu (reset qua SMS).



Use Case 2: Quản lý hồ sơ cá nhân
Features:
Cập nhật thông tin cá nhân (ảnh đại diện, số điện thoại-(xác thực lại), email)
Xem hồ sơ cá nhân.
Thay đổi mật khẩu.
Cập nhập thông tin sức khỏe: Bệnh nền, nhóm máu
Xem thông tin sức khỏe



Use Case 3: Giao tiếp
Features:
Chat real-time với Family, Supporter, hoặc Doctor.
Gọi video/audio qua WebRTC.
Tích hợp biểu tượng cảm xúc (emoji) hỗ trợ tâm trạng.
Chat với AI ( Chuyển đổi giữa text và giọng nói) - AI sẽ đưa ra những câu hỏi thêm để biết thêm tâm lý của người già.



Use Case 4: Thuê Supporter
Features:
Tìm kiếm Supporter theo địa điểm (GPS phạm vi tầm 20km ) đưa ra danh sách các người hỗ trợ (Lead theo khoảng cách hoặc đánh giá) 
thời gian rảnh, loại dịch vụ, giá, đánh giá.
Xem hồ sơ Supporter (thông tin, kinh nghiệm, đánh giá từ người dùng khác).


Đặt lịch hẹn với Supporter. Book theo buổi sáng (7h30-11h30), chiều (13h30 - 17h30), tối ( hoặc ngày 6h-9h30)


Thanh toán online (VNPay, MoMo, thẻ ngân hàng).
 Phương án 1: Tạo mã và tải ảnh
Phương án 2: Tự chuyển giá trị tiền qua momo trực tiếp
Đánh giá Supporter sau khi kết thúc dịch vụ.



Use Case 5: Kết nối với bác sĩ (Doctor)
Features:
Đặt lịch tư vấn online hoặc offline.
Nêu triệu chứng để AI (đã được training) để có thể đưa ra hướng dẫn và liệt ra bác sĩ phù hợp nhất tư vấn. Người dùng có thể chọn bác sĩ để link qua các thông tin như ngày giờ, hình thức online hay offline


Xem lịch sử tư vấn. (Có form mẫu bác sĩ ghi vào đó)


Thanh toán phí dịch vụ.



Use Case 6: Nhật ký sức khỏe
Features:
Nhập dữ liệu sức khỏe (huyết áp, nhịp tim, đường huyết, BMI) đưa ra kết quả bình thường hay ,......
Ghi chú cảm xúc hàng ngày. (khi chat với AI thì AI tự phân tích vào)
Xem biểu đồ thống kê sức khỏe.
Nhắc nhở uống thuốc, tập thể dục.



Use Case 7: SOS khẩn cấp
Features:
Nút bấm SOS trên mobile app (Gửi thông báo toàn bộ cho người nha, gọi 1 người 30s, lập lại vô hạn đến khi bắt máy).
Gửi thông báo khẩn cấp kèm vị trí GPS cho Family.

Use Case 8: Xác nhận mối quan hệ
Features:
	Xác nhận/Từ chối kết nối với người thân 
2. Family (Người thân)
Use Case 1: Đăng ký & đăng nhập
Giống Elderly.



Use Case 2: Theo dõi sức khỏe người thân
Features:
Xem dữ liệu sức khỏe (huyết áp, nhịp tim, đường huyết,dữ liệu tư vấn bác sĩ cho người già ….).
Xem nhật ký cảm xúc.
Nhận cảnh báo khi hệ thống phát hiện tâm trạng tiêu cực qua phân tích sentiment.
Use Case 3: Giao tiếp
Features:
Chat/video call với Elderly.
Nhận thông báo SOS từ Elderly.
Nhận cuộc gọi từ Elderly


Use Case 4: Hỗ trợ đặt dịch vụ
Features:
Đặt lịch Supporter cho Elderly và thanh toán.
Đặt lịch Doctor cho Elderly và thành toán.


3. Supporter (Người hỗ trợ)
Use Case 1: Đăng ký & đăng nhập
/////// Giống Elderly + upload giấy tờ xác minh (CMND/CCCD, chứng chỉ nếu có).
Đăng kí offline và admin cấp tài khoản
Use Case 2: Quản lý dịch vụ
Features:
Cập nhật hồ sơ dịch vụ (loại dịch vụ: chăm sóc, hỗ trợ y tế cơ bản…).


Thiết lập lịch rảnh.


Thiết lập giá dịch vụ.



Use Case 3: Nhận yêu cầu từ Elderly
Features:
Xem yêu cầu thuê.


Chấp nhận hoặc từ chối yêu cầu.


Giao tiếp với Elderly qua chat/video call.



4. Doctor (Bác sĩ)
Use Case 1: Đăng ký & đăng nhập
Giống Supporter + upload giấy phép hành nghề.



Use Case 2: Lịch tư vấn
Features:
Thiết lập thời gian rảnh.


Nhận và quản lý lịch hẹn từ Elderly hoặc Family.


Tư vấn qua chat/video call.



5. Admin (Quản trị viên)
Use Case 1: Quản lý người dùng
Features:
Duyệt hồ sơ Supporter/Doctor.


Chặn hoặc khóa tài khoản vi phạm.


Quản lý vai trò người dùng.



Use Case 2: Quản lý dịch vụ & nội dung
Features:
Xem thống kê dịch vụ.


Kiểm duyệt nội dung chat nếu cần.


Xem báo cáo từ người dùng.



Use Case 3: Thống kê & báo cáo
Features:
Thống kê số lượng Elderly, Supporter, Doctor, Family.


Thống kê dịch vụ đã đặt.


Báo cáo doanh thu.



Epic 1: Đăng ký & Đăng nhập (Elderly, Family, Supporter, Doctor)
Story 1.1: Đăng ký tài khoản Elderly


Task 1: Thiết kế form đăng ký (FE)


Task 2: API đăng ký (BE)


Task 3: Validate dữ liệu & OTP email


Task 4: Lưu DB & mã hóa mật khẩu


Task 5: Test chức năng


Story 1.2: Đăng ký Supporter (có upload giấy tờ)


Task 1: FE form + upload file


Task 2: API upload file + lưu Cloudinary


Task 3: Validate định dạng file


Task 4: DB lưu file link


Task 5: Test chức năng


Story 1.3: Đăng ký Doctor (có upload giấy phép hành nghề)
 (Task giống story 1.2, chỉ khác nội dung)


Story 1.4: Đăng nhập (tất cả role)


Task 1: FE form login


Task 2: API login (JWT)


Task 3: Middleware bảo vệ route


Task 4: Test chức năng



Epic 2: Quản lý Hồ sơ Cá nhân
Story 2.1: Xem thông tin cá nhân


Task 1: API lấy thông tin từ DB


Task 2: FE hiển thị thông tin


Task 3: Test


Story 2.2: Cập nhật thông tin cá nhân


Task 1: FE form update


Task 2: API update DB


Task 3: Validate dữ liệu


Task 4: Test


Story 2.3: Đổi mật khẩu


Task 1: FE form đổi pass


Task 2: API đổi pass (hash password)


Task 3: Xác thực mật khẩu cũ


Task 4: Test


Story 2.4: Upload ảnh đại diện


Task 1: FE chọn ảnh + preview


Task 2: API upload Cloudinary


Task 3: Lưu link vào DB


Task 4: Test



Epic 3: Đặt dịch vụ / Hỗ trợ
Ví dụ: Elderly đặt lịch hỗ trợ với Supporter
Story 3.1: Tìm kiếm Supporter


Story 3.2: Xem chi tiết profile Supporter


Story 3.3: Gửi yêu cầu hỗ trợ


Story 3.4: Thanh toán dịch vụ


Story 3.5: Theo dõi trạng thái hỗ trợ


(Mỗi story có task FE, BE, DB, Test như trên)

Epic 4: Quản lý & Giám sát (Admin)
Quản lý user


Quản lý dịch vụ


Xem báo cáo, thống kê
