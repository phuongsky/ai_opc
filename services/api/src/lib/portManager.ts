/**
 * portManager.ts — Tiện ích quản lý và tự động giải phóng port khi bị chiếm dụng (EADDRINUSE)
 */

import { execSync } from "child_process";

/**
 * Tự động tìm và giải phóng tiến trình đang chiếm port
 */
export function freePortIfOccupied(port: number): boolean {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf-8" });
      const lines = output.trim().split("\n");
      const pids = new Set<string>();

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        // Kiểm tra trạng thái LISTENING trên đúng port
        if (
          parts.length >= 5 &&
          (parts[1].endsWith(`:${port}`) || parts[1].includes(`:${port}`)) &&
          parts[3].toUpperCase() === "LISTENING"
        ) {
          const pid = parts[4];
          if (pid && pid !== "0" && pid !== String(process.pid)) {
            pids.add(pid);
          }
        }
      }

      if (pids.size > 0) {
        for (const pid of pids) {
          console.log(`[portManager] Phát hiện tiến trình cũ (PID: ${pid}) đang chiếm cổng ${port}. Đang tự động giải phóng...`);
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
          } catch {}
        }
        return true;
      }
    } else {
      // macOS / Linux
      const output = execSync(`lsof -t -i:${port}`, { encoding: "utf-8" }).trim();
      if (output) {
        const pids = output.split("\n").map((p) => p.trim()).filter((p) => p && p !== String(process.pid));
        for (const pid of pids) {
          console.log(`[portManager] Phát hiện tiến trình cũ (PID: ${pid}) đang chiếm cổng ${port}. Đang tự động giải phóng...`);
          try {
            execSync(`kill -9 ${pid}`, { stdio: "ignore" });
          } catch {}
        }
        return pids.length > 0;
      }
    }
  } catch {
    // Không tìm thấy tiến trình nào chiếm cổng
  }
  return false;
}
