# AI-OPC Mobile (Giai đoạn 2 — React Native)

> **Trạng thái:** stub/placeholder. Theo lộ trình ở `SPEC.md` mục 8, Mobile chỉ
> bắt đầu triển khai ở Tuần 5–7, sau khi Web + Desktop (Giai đoạn 1) đã ổn định
> và `services/api` đã có sẵn endpoint Mobile Gateway (WebSocket + Push).

## Vai trò của app này
"Văn phòng điều hành bỏ túi" — Founder **không** xem log chi tiết hay viết code
trên điện thoại. 4 tính năng trọng tâm (xem SPEC.md mục 8 / tuần 6):

1. **1-Tap Biometric Approval** — nhận push notification khi có Decision Package
   mới, mở app ra thấy `DecisionCard` rút gọn, vuốt để duyệt + xác thực
   FaceID/TouchID/vân tay trước khi gọi `POST /api/decisions/:id/approve`.
2. **Daily Executive Briefing** — card tóm tắt doanh thu/task nổi bật/rủi ro,
   tuỳ chọn nghe bản tóm tắt bằng Text-to-Speech.
3. **Voice Founder Command** — ghi âm, chuyển giọng nói thành text, gọi cùng
   `POST /api/commands` như Web/Desktop.
4. **Emergency Stop Widget** — Home Screen Widget hoặc nút đỏ nổi bật gọi
   `/stop` ngay cả khi app đang ở nền.

## Khi bắt đầu code thật, khởi tạo bằng:
```bash
npx @react-native-community/cli init AiOpcMobile --directory apps/mobile
```
Sau đó:
- Copy `packages/shared/src/types.ts` làm nguồn types chung (qua workspace
  `@ai-opc/shared`, không copy tay để tránh lệch schema với backend).
- Dùng cùng REST + WebSocket endpoint với Web/Desktop (`services/api`) —
  **không** tạo API riêng cho Mobile, chỉ thêm route/DTO rút gọn nếu cần.
- Push Notification: Firebase Cloud Messaging (Android) + APNs (iOS).
- Biometric: `react-native-biometrics` hoặc Expo `expo-local-authentication`.
- Bắt buộc 2FA/biometric gate trước khi gọi `approve` cho Decision Package
  risk R3/R4 (xem SPEC.md mục 10).
