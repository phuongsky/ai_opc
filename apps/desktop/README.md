# AI-OPC Desktop (Tauri 2.0)

App desktop này **không chứa logic riêng** — nó chỉ đóng gói bản build tĩnh
của `apps/web` (`next build` với `output: "export"`) thành 1 cửa sổ native,
kết nối tới `services/api` qua HTTP/WebSocket giống hệt bản Web.

## Icon
Đặt icon thật vào `src-tauri/icons/` trước khi build production
(32x32.png, 128x128.png, icon.icns, icon.ico) — Tauri CLI có lệnh
`tauri icon <nguồn.png>` để tự sinh đủ bộ từ 1 ảnh gốc.

## Chạy dev
```bash
pnpm --filter @ai-opc/web dev &     # Next.js dev server (tuỳ chọn, để hot-reload UI)
pnpm --filter @ai-opc/desktop dev   # mở cửa sổ Tauri
```

## Build production
```bash
pnpm --filter @ai-opc/web build     # sinh apps/web/out (static export)
pnpm --filter @ai-opc/desktop build # đóng gói .exe / .dmg / .AppImage
```

Yêu cầu: cài Rust toolchain (`rustup`) + các dependency hệ thống của Tauri
theo hệ điều hành (xem https://tauri.app/start/prerequisites/).
