# AI-OPC Company OS

Company Operating System cho mô hình "AI-Native One-Person Company" — một
Founder điều hành cả công ty qua đội ngũ AI Agent, với Governance chặt (Permission
Matrix L0–L6, Risk Level R0–R4, Decision Package, Audit Log bất biến).

📄 Xem **[SPEC.md](./SPEC.md)** để hiểu đầy đủ kiến trúc, data model, API, và lộ trình.

## Cấu trúc

```
apps/web/       Next.js 15 + React — Executive Cockpit (Giai đoạn 1, web)
apps/desktop/   Tauri 2.0 — bọc bản build của apps/web thành app desktop (Giai đoạn 1)
apps/mobile/    React Native — Executive Pocket App (Giai đoạn 2, đang là stub)
services/api/   Node.js (TypeScript) — Core Engine: REST + WebSocket + Governance
packages/shared/ Types dùng chung giữa mọi client và API
```

## Yêu cầu môi trường

- Node.js ≥ 20, pnpm ≥ 9 (`corepack enable`)
- Docker (nếu chạy chế độ PostgreSQL qua `docker compose`)
- Rust toolchain (chỉ cần khi build Desktop — xem `apps/desktop/README.md`)

## Chạy nhanh — Cách 1: hoàn toàn local, dùng SQLite (không cần Docker)

```bash
cp .env.example .env
# Sửa trong .env: DB_PROVIDER=sqlite  DATABASE_URL="file:./data/company_os.db"

pnpm install
pnpm --filter @ai-opc/api exec prisma generate --schema src/db/prisma/schema.sqlite.prisma
pnpm --filter @ai-opc/api exec prisma migrate dev --schema src/db/prisma/schema.sqlite.prisma --name init
pnpm db:seed

pnpm dev:api     # Core Engine tại http://localhost:8000
pnpm dev:web     # Web Cockpit tại http://localhost:3000
```

## Chạy nhanh — Cách 2: PostgreSQL qua Docker Compose (1-click)

```bash
cp .env.example .env   # giữ nguyên DB_PROVIDER=postgresql
docker compose up -d
# Postgres :5432 · API :8000 · Web :3000
```

Chạy migrate + seed lần đầu (nếu chưa tự động trong image):
```bash
pnpm --filter @ai-opc/api db:migrate
pnpm db:seed
```

## Chạy nhanh — Cách 3: SQL Server on-prem có sẵn

```bash
# .env: DB_PROVIDER=sqlserver
#       DATABASE_URL="sqlserver://user:pass@host:1433;database=company_os"
pnpm --filter @ai-opc/api db:migrate:mssql
pnpm db:seed
```

## Đóng gói Desktop (Tauri)

```bash
pnpm build:web
pnpm build:desktop
```

Xem chi tiết tại `apps/desktop/README.md`.

## Mobile (Giai đoạn 2)

Chưa triển khai — xem kế hoạch & hướng dẫn khởi tạo tại `apps/mobile/README.md`.

## Video Agent (`agent_create_video_ai`)

AI-Video quản lý vòng đời video: `IDEA → SCRIPTED → GENERATING → REVIEW → APPROVED → PUBLISHED`.
Trang agent: `/agents?id=agent_create_video_ai` (kèm thư viện video: lọc, tạo, duyệt/từ chối, lưu trữ).

- Giao việc: `/do @video Viết kịch bản video TikTok 30s giới thiệu sản phẩm X`.
- Tool (qua Tool Gateway): `tool_video_search` (R0) · `tool_video_draft` (R1) · `tool_video_set_status` (R1) · `tool_video_generate` (R2) · `tool_video_publish` (R3, luôn cần Founder duyệt).
- Agent **không** tự APPROVED/REJECTED; chỉ Founder (UI). `PUBLISHED` chỉ đạt được sau khi Founder duyệt Decision Package, và chỉ *ghi nhận* trạng thái — không tự đăng lên nền tảng.
- Provider sinh video mặc định là **mô phỏng** (không có file thật). Đặt `VIDEO_GEN_API_URL` để dùng provider HTTP.
- Agent và tool tự được tạo khi API khởi động (hoặc `pnpm db:seed`). Bảng `videos`: `services/api/migrations/*/003_add_videos.sql` (SQLite tự cập nhật qua `selfHealDb`; PostgreSQL: `prisma migrate deploy`).
- Test: `pnpm --filter @ai-opc/api exec tsx src/scripts/testVideoAgent.ts` (không cần DB).

### Video Studio (`/studio?id=<videoId>`)

Giao diện dựng video kiểu NLE (preview · timeline nhiều track · inspector). Mở từ trang Agent → "Mở Studio dựng video".
- Timeline JSON (`VideoAsset.timeline`, schema zod ở `packages/shared/src/videoTimeline.ts`) lưu qua `PUT /api/videos/:id/timeline` và là căn cứ để Agent/provider tạo video (`tool_video_generate` truyền `timeline` cho provider).
- `POST /api/videos/:id/timeline/from-script` dựng timeline từ script. Chỉ sửa được khi trạng thái IDEA/SCRIPTED/REVIEW/REJECTED/FAILED.
- Xuất WebM ngay trên trình duyệt (MediaRecorder, thời gian thực, chưa có âm thanh).
- Phím tắt: Space, S (cắt), Del, Ctrl+D, Ctrl+Z/Shift+Z, Ctrl+S.
- Migration `004_add_video_timeline` (cột `videos.timeline`); SQLite tự vá khi khởi động.
- Test: `pnpm --filter @ai-opc/api exec tsx src/scripts/testVideoTimeline.ts`.

## Nguyên tắc quan trọng khi phát triển tiếp

1. **Không gọi thẳng driver bên ngoài** (DB ghi, email, git, thanh toán...) —
   luôn đi qua `services/api/src/modules/governance/toolGateway.ts`.
2. **Không thêm route UPDATE/DELETE cho `audit_logs`** — bảng này phải bất biến.
3. **Đổi DB engine chỉ qua `.env` (`DB_PROVIDER`)** — không sửa code nghiệp vụ
   trong `modules/*` hay `routes/*`.
4. Mọi type dùng chung giữa client/server đặt trong `packages/shared`, không
   định nghĩa lại rải rác ở từng app.

## Bản quyền/ License
This project is open source and welcomes contributions.
Licensed under the MIT License.

Mã nguồn mở, hoan nghênh mọi đóng góp.
Cùng nhau phát triển và xây dựng một dự án tốt hơn!


