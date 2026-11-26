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
