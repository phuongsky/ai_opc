// AI-OPC Desktop — Tự động khởi chạy Backend Engine Sidecar và bọc giao diện Next.js
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::WindowEvent;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

fn get_log_file_path() -> PathBuf {
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        let log_dir = PathBuf::from(local_appdata).join("AI-OPC Company OS").join("logs");
        let _ = std::fs::create_dir_all(&log_dir);
        return log_dir.join("api-server.log");
    }
    PathBuf::from("api-server.log")
}

fn append_log(msg: &str) {
    let path = get_log_file_path();
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let now = chrono_lite_timestamp();
        let _ = writeln!(file, "[{}] {}", now, msg.trim_end());
    }
}

fn chrono_lite_timestamp() -> String {
    // Đơn giản trả về định dạng thời gian chuẩn
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| format!("+{}s", d.as_secs()))
        .unwrap_or_default()
}

fn main() {
    let sidecar_child: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>> =
        Arc::new(Mutex::new(None));
    let sidecar_child_clone = sidecar_child.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            append_log("[AI-OPC Desktop] Bắt đầu khởi động ứng dụng và spawn Backend API Server Sidecar...");

            // Khởi chạy Backend API Server Sidecar ngầm
            match app.shell().sidecar("api-server") {
                Ok(command) => match command.spawn() {
                    Ok((mut rx, child)) => {
                        append_log("[AI-OPC Desktop] ✓ Sidecar API Server đã spawn thành công.");
                        if let Ok(mut lock) = sidecar_child.lock() {
                            *lock = Some(child);
                        }

                        // Lắng nghe stdout/stderr từ backend để gỡ lỗi và ghi file log
                        tauri::async_runtime::spawn(async move {
                            while let Some(event) = rx.recv().await {
                                match event {
                                    CommandEvent::Stdout(line) => {
                                        let text = String::from_utf8_lossy(&line);
                                        append_log(&format!("[Backend API] {}", text));
                                    }
                                    CommandEvent::Stderr(line) => {
                                        let text = String::from_utf8_lossy(&line);
                                        append_log(&format!("[Backend API ERR] {}", text));
                                    }
                                    CommandEvent::Terminated(payload) => {
                                        append_log(&format!(
                                            "[Backend API] Tiến trình dừng với mã: {:?}",
                                            payload.code
                                        ));
                                    }
                                    _ => {}
                                }
                            }
                        });
                    }
                    Err(err) => {
                        append_log(&format!("[AI-OPC Desktop] ❌ Không thể spawn api-server: {:?}", err));
                    }
                },
                Err(err) => {
                    append_log(&format!("[AI-OPC Desktop] ❌ Không tìm thấy sidecar api-server: {:?}", err));
                }
            }

            Ok(())
        })
        .on_window_event(move |_window, event| {
            // Khi đóng cửa sổ, tự động terminate process Backend API Sidecar
            if let WindowEvent::Destroyed = event {
                if let Ok(mut lock) = sidecar_child_clone.lock() {
                    if let Some(child) = lock.take() {
                        let _ = child.kill();
                        println!("[AI-OPC Desktop] Đã dừng Backend API Server.");
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running AI-OPC desktop application");
}

