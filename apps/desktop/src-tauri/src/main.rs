// AI-OPC Desktop — bọc bản build tĩnh của apps/web (Next.js `output: "export"`).
// Toàn bộ logic nghiệp vụ nằm ở services/api; app này chỉ là 1 cửa sổ hiển thị
// Web UI kết nối tới Core Engine qua HTTP/WebSocket (xem tauri.conf.json -> CSP).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running AI-OPC desktop application");
}
