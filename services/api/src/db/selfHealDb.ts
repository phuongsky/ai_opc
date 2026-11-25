import { env } from "../config/env";
import { db } from "./client";

/**
 * Tự động kiểm tra và bổ sung các cột/bảng bị thiếu trong SQLite Database (Self-Healing).
 * Đảm bảo các cài đặt desktop của người dùng với DB cũ không bị crash khi cập nhật code mới.
 */
export async function selfHealDatabase(): Promise<void> {
  if (env.dbProvider !== "sqlite") return;

  try {
    // 1. Kiểm tra bảng company_settings
    const cols = (await (db as any).$queryRawUnsafe(
      "PRAGMA table_info(company_settings)"
    )) as Array<{ name: string }> | undefined;
    const colList = cols || [];
    const colNames = new Set(colList.map((c: any) => c.name));

    if (colList.length > 0 && !colNames.has("embedding_api_key")) {
      console.log("[selfHealDb] Phát hiện thiếu cột embedding_api_key trong company_settings. Đang tự động bổ sung...");
      await (db as any).$executeRawUnsafe(
        "ALTER TABLE company_settings ADD COLUMN embedding_api_key TEXT;"
      );
      console.log("[selfHealDb] ✓ Đã bổ sung thành công cột embedding_api_key.");
    }

    if (colList.length > 0 && !colNames.has("temperature")) {
      console.log("[selfHealDb] Phát hiện thiếu cột temperature trong company_settings. Đang tự động bổ sung...");
      await (db as any).$executeRawUnsafe(
        "ALTER TABLE company_settings ADD COLUMN temperature REAL DEFAULT 0.2;"
      );
      console.log("[selfHealDb] ✓ Đã bổ sung thành công cột temperature.");
    }

    // 2. Đảm bảo bảng system_lookups tồn tại
    const tables = (await (db as any).$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='system_lookups';"
    )) as Array<{ name: string }> | undefined;
    const tableList = tables || [];
    if (tableList.length === 0) {
      console.log("[selfHealDb] Bảng system_lookups chưa tồn tại. Đang tự động khởi tạo...");
      await (db as any).$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS system_lookups (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          raw_code INTEGER NOT NULL,
          standard_key TEXT NOT NULL,
          display_name TEXT NOT NULL,
          description TEXT,
          is_active BOOLEAN NOT NULL DEFAULT 1,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await (db as any).$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS system_lookups_category_raw_code_key ON system_lookups(category, raw_code);
      `);
      console.log("[selfHealDb] ✓ Đã khởi tạo thành công bảng system_lookups.");
    }
  } catch (err: any) {
    console.warn("[selfHealDb] Cảnh báo kiểm tra cấu trúc SQLite:", err?.message || err);
  }
}
