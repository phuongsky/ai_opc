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

    if (colList.length > 0 && !colNames.has("video_gen_api_url")) {
      console.log("[selfHealDb] Phát hiện thiếu cột video_gen_api_url trong company_settings. Đang tự động bổ sung...");
      await (db as any).$executeRawUnsafe(
        "ALTER TABLE company_settings ADD COLUMN video_gen_api_url TEXT;"
      );
      console.log("[selfHealDb] ✓ Đã bổ sung thành công cột video_gen_api_url.");
    }

    if (colList.length > 0 && !colNames.has("video_gen_api_key")) {
      console.log("[selfHealDb] Phát hiện thiếu cột video_gen_api_key trong company_settings. Đang tự động bổ sung...");
      await (db as any).$executeRawUnsafe(
        "ALTER TABLE company_settings ADD COLUMN video_gen_api_key TEXT;"
      );
      console.log("[selfHealDb] ✓ Đã bổ sung thành công cột video_gen_api_key.");
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

  // 3. Đảm bảo bảng videos (Agent quản lý video) tồn tại — idempotent.
  try {
    await (db as any).$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS videos (
        id VARCHAR(50) PRIMARY KEY,
        title TEXT NOT NULL,
        brief TEXT,
        script TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'IDEA',
        platform VARCHAR(30),
        aspect_ratio VARCHAR(10) NOT NULL DEFAULT '16:9',
        duration_sec INTEGER,
        tags TEXT,
        asset_url TEXT,
        thumbnail_url TEXT,
        provider VARCHAR(50),
        provider_job_id VARCHAR(200),
        published_url TEXT,
        cost_usd REAL NOT NULL DEFAULT 0,
        notes TEXT,
        agent_id VARCHAR(50) NOT NULL DEFAULT 'agent_create_video_ai',
        task_id VARCHAR(50),
        created_by VARCHAR(50) NOT NULL DEFAULT 'AGENT',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        published_at DATETIME
      );
    `);
    await (db as any).$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS videos_status_idx ON videos(status);"
    );
    // 3b. Video Studio: cột timeline (JSON) cho DB đã tạo bảng videos từ trước.
    const vcols = (await (db as any).$queryRawUnsafe("PRAGMA table_info(videos)")) as Array<{ name: string }> | undefined;
    if ((vcols || []).length > 0 && !(vcols || []).some((c) => c.name === "timeline")) {
      await (db as any).$executeRawUnsafe("ALTER TABLE videos ADD COLUMN timeline TEXT;");
      console.log("[selfHealDb] ✓ Đã bổ sung cột videos.timeline.");
    }
  } catch (err: any) {
    console.warn("[selfHealDb] Cảnh báo khởi tạo bảng videos:", err?.message || err);
  }
}
