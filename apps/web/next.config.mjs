/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'export' cho phép `apps/desktop` (Tauri) bọc thẳng bản build tĩnh của Web,
  // đúng nguyên tắc "Desktop bọc Web build" trong SPEC.md mục 7.
  // Nếu cần Server Actions / API Route trong tương lai, đổi lại 'standalone'
  // và chạy Next server riêng cho bản Web (server), Desktop dùng bản build khác.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
