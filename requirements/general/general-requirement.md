# General Requirements

<!-- arr-fingerprint:cc906712599c8c1162ea -->
## REQ-GEN-0001: Tích hợp tính năng Quản lý Vòng đời Video cho AI-Video (agent_create_video_ai)

- **Created:** 2026-11-26T14:42:10+07:00
- **Project:** ai-opc
- **Module:** general
- **Type:** feature
- **Status:** Pending
- **Related modules:** permissions

### Description
Phát triển tính năng cho Agent AI-Video (agent_create_video_ai) theo tài liệu video_guide.md và video_code.md: quản lý vòng đời video, giao diện quản lý trên /agents?id=agent_create_video_ai, bộ công cụ Tool Gateway, và cơ chế duyệt an toàn từ Founder.

### Acceptance Criteria
- [ ] Agent agent_create_video_ai (AI-Video) được khởi tạo và nhận lệnh /do @video
- [ ] Quản lý đầy đủ vòng đời video qua các trạng thái: IDEA -> SCRIPTED -> GENERATING -> REVIEW -> APPROVED -> PUBLISHED (kèm REJECTED, FAILED, ARCHIVED)
- [ ] Giao diện thư viện video hiển thị trên trang /agents?id=agent_create_video_ai hỗ trợ lọc, tìm kiếm, tạo mới, duyệt/từ chối, lưu trữ
- [ ] 5 công cụ được tích hợp qua Tool Gateway với phân quyền an toàn (tool_video_publish rủi ro R3 luôn tạo Decision Package chờ Founder duyệt)
- [ ] Tích hợp Video Provider mô phỏng mặc định và hỗ trợ HTTP provider khi cấu hình biến môi trường

### Original Request
> Tích hợp tính năng cho Ai-Video (agent_create_video_ai): Quản lý vòng đời video (ý tưởng, kịch bản, sinh video, chờ duyệt, xuất bản), trang chi tiết agent /agents?id=agent_create_video_ai, tool gateway và video provider.

---

<!-- arr-fingerprint:dcabd14c8e146c00438e -->
## REQ-GEN-0002: Tích hợp Video Studio NLE và Quản lý Timeline cho AI-Video (Phần 2)

- **Created:** 2026-11-26T16:59:16+07:00
- **Project:** ai-opc
- **Module:** general
- **Type:** feature
- **Status:** Pending
- **Related modules:** permissions

### Description
Triển khai tính năng Video Studio cho Agent AI-Video theo tài liệu video_guide.md (Phần 2) và video_code_part2.md: trang dựng video NLE tại /studio, timeline nhiều track (text, color, image), canvas preview, xuất video WebM trực tiếp trên trình duyệt, lưu schema timeline vào CSDL làm căn cứ cho Agent/Provider tạo video.

### Acceptance Criteria
- [ ] Truy cập /studio?id=<videoId> mở giao diện Studio dựng video với timeline nhiều track, canvas preview và bảng thuộc tính clip
- [ ] Hỗ trợ các thao tác kéo thả clip, cắt (split), nhân bản, xóa, undo/redo, phím tắt (Space, S, Del, Ctrl+D, Ctrl+Z, Ctrl+S)
- [ ] Tự động dựng timeline từ script (from-script) và lưu timeline vào cột videos.timeline
- [ ] Chỉ cho phép sửa timeline ở các trạng thái IDEA, SCRIPTED, REVIEW, REJECTED, FAILED (các trạng thái APPROVED, PUBLISHED, GENERATING khóa sửa)
- [ ] Xuất video định dạng WebM trực tiếp trên trình duyệt bằng MediaRecorder canvas

### Original Request
> Tích hợp Video Studio (Phần 2) cho AI-Video (agent_create_video_ai): Giao diện dựng video NLE tại /studio?id=<videoId>, timeline nhiều track, canvas preview, xuất WebM, và lưu cấu trúc timeline vào videos.timeline làm căn cứ sinh video.

---

<!-- arr-fingerprint:e3f03acb45ffecb7cba0 -->
## REQ-GEN-0003: Sửa lỗi Phân tích Quyết định Agent Video và Khôi phục Phong bì Tự động (Phần 3)

- **Created:** 2026-11-27T08:10:42+07:00
- **Project:** ai-opc
- **Module:** general
- **Type:** bugfix
- **Status:** Pending
- **Related modules:** permissions

### Description
Khắc phục lỗi khi model trả về params mà thiếu lớp bọc action/toolId hoặc trả văn bản từ chối; triển khai videoRecovery.ts tự động suy luận tool từ operation; củng cố prompt khẳng định khả năng tạo video và yêu cầu autoTimeline; thêm studioUrl và thông báo nhanh trong giao diện.

### Acceptance Criteria
- [ ] Tự động khôi phục phong bì CALL_TOOL cho các thao tác create, update, list, submit khi model chỉ trả params
- [ ] Prompt củng cố rõ vai trò tạo video và hướng dẫn tự sinh script kịch bản dự án thay vì từ chối hoặc hỏi lại
- [ ] Tự động thiết lập autoTimeline=true khi tạo bản nháp có script
- [ ] Trả về studioUrl trong kết quả tool để điều hướng trực tiếp đến Studio
- [ ] Hiển thị thông báo Mở Studio trên giao diện /agents?id=agent_create_video_ai khi có video được tạo/cập nhật

### Original Request
> Sửa lỗi Model không trả JSON hợp lệ khi giao lệnh tạo video (Phần 3 Errors): Khôi phục phong bì CALL_TOOL tự động (videoRecovery), củng cố prompt chuyên biệt chống từ chối, hỗ trợ autoTimeline, trả studioUrl và hiển thị banner Mở Studio trong UI.

---

<!-- arr-fingerprint:452c32e813a8b5ab0fbb -->
## REQ-GEN-0004: Sửa lỗi Platform reels và Bổ sung Hành động Sinh Video / Xuất Bản Trực Tiếp

- **Created:** 2026-11-27T08:36:29+07:00
- **Project:** ai-opc
- **Module:** general
- **Type:** bugfix
- **Status:** Pending
- **Related modules:** permissions

### Description
Chuẩn hóa platform reels/shorts thành các nền tảng hợp lệ (instagram/youtube); xử lý nhận diện lệnh gọi tool_video_generate và tool_video_publish khi Founder gõ lệnh; bổ sung nút hành động 'Sinh video' (trạng thái SCRIPTED) và 'Xuất bản' (trạng thái APPROVED) ngay trên giao diện thư viện video.

### Acceptance Criteria
- [ ] Tự động ánh xạ platform reels/reel thành instagram, shorts/short thành youtube và hỗ trợ trong VIDEO_PLATFORMS
- [ ] Nhận diện lệnh tool_video_generate, sinh video, tạo video [id] và tự động kích hoạt tool_video_generate với video tương ứng
- [ ] Bổ sung nút bấm trực quan Sinh video (trạng thái SCRIPTED) và Xuất bản (trạng thái APPROVED) trên card video tại /agents?id=agent_create_video_ai
- [ ] Cung cấp API POST /api/videos/:id/generate và POST /api/videos/:id/publish

### Original Request
> Sửa lỗi Platform không hợp lệ reels và bổ sung luồng thực thi sinh video, xuất bản trực tiếp qua nút bấm UI hoặc câu lệnh tự nhiên cho AI-Video.

---

<!-- arr-fingerprint:603f1c303d79b7afe3c5 -->
## REQ-GEN-0005: Luồng Duyệt Video Tương Đương Save & Hỏi Xác Nhận Xuất Bản Tương Đương Export Qua Chat

- **Created:** 2026-11-27T09:22:18+07:00
- **Project:** ai-opc
- **Module:** general
- **Type:** feature
- **Status:** Pending
- **Related modules:** permissions

### Description
Xử lý luồng duyệt (Approve) và xuất bản (Publish/Export) thông minh qua lệnh chat: Nhận diện lệnh Approve/Duyệt chuyển trạng thái video REVIEW thành APPROVED, thông báo kèm câu hỏi xuất bản, và thực thi xuất bản khi Founder xác nhận.

### Acceptance Criteria
- [ ] Gõ 'Approve', 'duyệt', 'phê duyệt' hoặc khi model trả status APPROVED thì hệ thống không báo lỗi JSON mà tự động duyệt video thành APPROVED (tương đương nút Save).
- [ ] Sau khi duyệt thành công, hệ thống thông báo trạng thái APPROVED và hỏi Founder có muốn xuất bản/export video lên nền tảng không.
- [ ] Nếu Founder đồng ý (gõ 'có', 'đồng ý', 'xuất bản', 'publish', 'export'), hệ thống tự động gọi tool_video_publish/exportVideo để hoàn tất xuất bản (tương đương nút Export).

### Original Request
> Xử lý lệnh Approve/Duyệt video tương đương nút Save trong Studio, hỏi xác nhận xuất bản và thực thi xuất bản (tương đương nút Export) khi Founder đồng ý.

---

<!-- arr-fingerprint:c34c598da27d3e2512d3 -->
## REQ-GEN-0006: Nút Xem Video Studio Trước Khi Duyệt Trong Video Library

- **Created:** 2026-11-27T11:06:09+07:00
- **Project:** ai-opc
- **Module:** general
- **Type:** feature
- **Status:** Pending
- **Related modules:** None

### Description
Thêm nút Xem (route sang /studio?id=) ở bên trái nút Approve (Duyệt) trên từng thẻ video trong danh sách Video Library của Agent AI-Video.

### Acceptance Criteria
- [ ] Trong danh sách video của card 'Video Library' (/agents?id=agent_create_video_ai), hiển thị nút 'Xem' nằm ở bên trái nút 'Approve' (Duyệt) khi video ở trạng thái REVIEW.
- [ ] Khi người dùng bấm vào nút 'Xem', hệ thống điều hướng trực tiếp đến trang '/studio?id=<videoId>' với đúng ID của video đó.

### Original Request
> Thêm nút 'Xem' ở bên trái nút 'Approve' trong card 'Video Library', khi bấm route sang '/studio?id='.

---
