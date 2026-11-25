/**
 * LookupService — Quản lý Từ điển quy ước động (Dynamic System Dictionary)
 * kết hợp In-Memory Caching (Bộ nhớ đệm RAM) và Dynamic Tool Definition.
 *
 * Cho phép Founder / Admin cấu hình bảng quy ước (vd: Status 1=Checkin, 5=Checkout/No-Show)
 * trên giao diện (UI) và tự động:
 *   1. Chiều DB -> AI (Enrich Data): Dịch các mã số thô (1, 2, 3, 4, 5...) sang Text rõ nghĩa
 *      trong 0.00001s từ RAM trước khi gửi cho AI Agent.
 *   2. Chiều AI -> Tool (Dynamic Tool Schema): Tự động sinh mô tả Tool mới nhất cho AI hiểu
 *      mà KHÔNG CẦN sửa code hay huấn luyện lại AI.
 */
import { db } from "../../db/client";

export interface SystemLookupItem {
  id: string;
  category: string;
  rawCode: number;
  standardKey: string;
  displayName: string;
  description: string | null;
  isActive: boolean;
  updatedAt: Date | string;
}

const DEFAULT_BOOKING_STATUSES: Omit<SystemLookupItem, "updatedAt">[] = [
  {
    id: "lookup_status_0",
    category: "booking_status",
    rawCode: 0,
    standardKey: "NEW",
    displayName: "Chưa xác nhận / Mới tạo (New / Pending)",
    description: "Đơn mới tạo trên hệ thống, chưa đến ngày nhận phòng hoặc chờ xác nhận",
    isActive: true,
  },
  {
    id: "lookup_status_1",
    category: "booking_status",
    rawCode: 1,
    standardKey: "CHECKIN",
    displayName: "Check-in / Đang ở (In-House)",
    description: "Khách đã làm thủ tục nhận phòng và đang lưu trú tại khách sạn",
    isActive: true,
  },
  {
    id: "lookup_status_2",
    category: "booking_status",
    rawCode: 2,
    standardKey: "CONFIRMED",
    displayName: "Confirmed (Đã xác nhận)",
    description: "Đơn đặt phòng đã được xác nhận giữ phòng thành công",
    isActive: true,
  },
  {
    id: "lookup_status_3",
    category: "booking_status",
    rawCode: 3,
    standardKey: "DEPOSIT",
    displayName: "Deposit Paid (Đã đặt cọc)",
    description: "Khách đã thanh toán tiền đặt cọc trước cho đơn phòng",
    isActive: true,
  },
  {
    id: "lookup_status_4",
    category: "booking_status",
    rawCode: 4,
    standardKey: "TENTATIVE",
    displayName: "Tentative / Giữ chỗ tạm (On-Hold)",
    description: "Đơn phòng giữ chỗ tạm thời có thời hạn chờ thanh toán",
    isActive: true,
  },
  {
    id: "lookup_status_5",
    category: "booking_status",
    rawCode: 5,
    standardKey: "CHECKOUT",
    displayName: "Check-out / Đã trả phòng (Completed)",
    description: "Khách đã hoàn tất trả phòng, thanh toán xong và rời khách sạn",
    isActive: true,
  },
  {
    id: "lookup_status_6",
    category: "booking_status",
    rawCode: 6,
    standardKey: "CANCELLED",
    displayName: "Cancelled (Đã hủy)",
    description: "Khách hoặc khách sạn đã hủy đơn đặt phòng này",
    isActive: true,
  },
  {
    id: "lookup_status_7",
    category: "booking_status",
    rawCode: 7,
    standardKey: "NOSHOW",
    displayName: "No-Show (Khách không đến)",
    description: "Đến ngày nhận phòng nhưng khách không đến và không báo trước",
    isActive: true,
  },
];

class LookupService {
  // In-Memory RAM Cache: category -> (rawCode -> SystemLookupItem)
  private cache = new Map<string, Map<number, SystemLookupItem>>();
  private initialized = false;

  constructor() {
    // Tải bộ nhớ đệm ban đầu
    this.reloadCache().catch((err) => {
      console.warn("[LookupService] Khởi động cache ban đầu:", err.message);
    });
  }

  /**
   * Tải toàn bộ quy ước từ DB lên RAM Cache.
   * Chạy khi khởi động server hoặc ngay khi Founder bấm Lưu trên giao diện Settings.
   */
  async reloadCache(): Promise<void> {
    try {
      let rows: any[] = [];
      try {
        if ((db as any).systemLookup) {
          rows = await (db as any).systemLookup.findMany({
            orderBy: [{ category: "asc" }, { rawCode: "asc" }],
          });
        } else {
          rows = await (db as any).$queryRawUnsafe(
            `SELECT id, category, raw_code as rawCode, standard_key as standardKey, display_name as displayName, description, is_active as isActive, updated_at as updatedAt FROM "system_lookups" ORDER BY "category", "raw_code"`
          );
        }
      } catch (dbErr) {
        // Fallback tạo bảng nếu chưa có
        await this.ensureTable();
        rows = await (db as any).$queryRawUnsafe(
          `SELECT id, category, raw_code as rawCode, standard_key as standardKey, display_name as displayName, description, is_active as isActive, updated_at as updatedAt FROM "system_lookups" ORDER BY "category", "raw_code"`
        );
      }

      if (rows.length === 0) {
        await this.seedDefaults();
        return;
      }

      const newCache = new Map<string, Map<number, SystemLookupItem>>();
      for (const row of rows) {
        const cat = String(row.category);
        const code = Number(row.rawCode ?? row.raw_code);
        if (!newCache.has(cat)) {
          newCache.set(cat, new Map<number, SystemLookupItem>());
        }

        newCache.get(cat)!.set(code, {
          id: String(row.id),
          category: cat,
          rawCode: code,
          standardKey: String(row.standardKey ?? row.standard_key ?? ""),
          displayName: String(row.displayName ?? row.display_name ?? `Mã ${code}`),
          description: row.description ? String(row.description) : null,
          isActive: Boolean(row.isActive ?? row.is_active ?? true),
          updatedAt: row.updatedAt ?? row.updated_at ?? new Date(),
        });
      }

      this.cache = newCache;
      this.initialized = true;
      console.log(`[LookupService] Đã nạp thành công ${rows.length} quy ước vào In-Memory RAM Cache.`);
    } catch (err) {
      console.error("[LookupService] Lỗi khi reload cache quy ước:", err);
    }
  }

  private async ensureTable(): Promise<void> {
    try {
      await (db as any).$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "system_lookups" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "category" TEXT NOT NULL,
          "raw_code" INTEGER NOT NULL,
          "standard_key" TEXT NOT NULL,
          "display_name" TEXT NOT NULL,
          "description" TEXT,
          "is_active" INTEGER NOT NULL DEFAULT 1,
          "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await (db as any).$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "system_lookups_category_raw_code_key" 
        ON "system_lookups"("category", "raw_code");
      `);
    } catch (e) {
      // Ignored
    }
  }

  private async seedDefaults(): Promise<void> {
    try {
      await this.ensureTable();
      for (const d of DEFAULT_BOOKING_STATUSES) {
        await (db as any).$executeRawUnsafe(`
          INSERT OR IGNORE INTO "system_lookups" ("id", "category", "raw_code", "standard_key", "display_name", "description", "is_active", "updated_at")
          VALUES ('${d.id}', '${d.category}', ${d.rawCode}, '${d.standardKey}', '${d.displayName.replace(/'/g, "''")}', '${(d.description || "").replace(/'/g, "''")}', 1, CURRENT_TIMESTAMP);
        `);
      }
      await this.reloadCache();
    } catch (e) {
      console.warn("[LookupService] Seed defaults error:", e);
    }
  }

  /**
   * Lấy tên hiển thị của mã trạng thái từ RAM Cache trong 0.00001ms.
   */
  getDisplayName(category: string, rawCode: number | string | undefined | null): string {
    if (rawCode === undefined || rawCode === null) return "Không xác định";
    const codeNum = Number(rawCode);
    if (isNaN(codeNum)) return String(rawCode);

    const catMap = this.cache.get(category);
    if (catMap && catMap.has(codeNum)) {
      const item = catMap.get(codeNum)!;
      if (item.isActive) {
        return item.displayName;
      }
    }

    return `Mã ${codeNum}`;
  }

  /**
   * Lấy đối tượng Map từ điển { code: displayName } cho 1 danh mục.
   */
  getLookupMap(category: string): Record<number, string> {
    const res: Record<number, string> = {};
    const catMap = this.cache.get(category);
    if (catMap) {
      for (const [code, item] of catMap.entries()) {
        if (item.isActive) {
          res[code] = item.displayName;
        }
      }
    }
    return res;
  }

  /**
   * Sinh câu mô tả động cho Tool Description để AI Agent hiểu rõ bảng mã mới nhất.
   */
  getToolDescription(category: string): string {
    const catMap = this.cache.get(category);
    if (!catMap || catMap.size === 0) {
      return "1=Check-in (Đang ở), 2=Confirmed (Đã xác nhận), 3=Deposit (Đặt cọc), 4=Tentative (Giữ chỗ), 5=Check-out (Đã trả phòng), 6=Cancelled (Đã hủy)";
    }

    const parts: string[] = [];
    for (const [code, item] of Array.from(catMap.entries()).sort((a, b) => a[0] - b[0])) {
      if (item.isActive) {
        const desc = item.description ? ` - ${item.description}` : "";
        parts.push(`${code}: ${item.displayName}${desc}`);
      }
    }
    return parts.join(" | ");
  }

  /**
   * Chiều Database -> AI (Enrich Data):
   * Tự động dịch mã số thô (Status, TrangThai, GuestStatus...) thành trường Text rõ nghĩa
   * trước khi kết quả được chuyển cho AI Agent xử lý.
   */
  enrichRecords(table: string, records: unknown): unknown {
    if (!Array.isArray(records) || records.length === 0) return records;

    const lowerTable = table.toLowerCase();
    const isBookingTable =
      lowerTable.includes("reservation") ||
      lowerTable.includes("booking") ||
      lowerTable.includes("order") ||
      lowerTable.includes("hoadon");

    if (!isBookingTable) return records;

    return records.map((row) => {
      if (!row || typeof row !== "object") return row;
      const copy = { ...row } as Record<string, unknown>;

      // 1. Status -> StatusText
      if (copy.Status !== undefined && copy.Status !== null) {
        copy.StatusText = this.getDisplayName("booking_status", copy.Status as any);
      } else if (copy.status !== undefined && copy.status !== null) {
        copy.statusText = this.getDisplayName("booking_status", copy.status as any);
      }

      // 2. TrangThai -> TrangThaiText (cho các bảng hóa đơn/order tiếng Việt)
      if (copy.TrangThai !== undefined && copy.TrangThai !== null) {
        copy.TrangThaiText = this.getDisplayName("booking_status", copy.TrangThai as any);
      }

      return copy;
    });
  }

  /**
   * Lấy danh sách tất cả Lookups (cho API Settings).
   */
  async getAllLookups(category?: string): Promise<SystemLookupItem[]> {
    if (!this.initialized || this.cache.size === 0) {
      await this.reloadCache();
    }

    const items: SystemLookupItem[] = [];
    for (const [cat, map] of this.cache.entries()) {
      if (category && cat !== category) continue;
      for (const item of map.values()) {
        items.push(item);
      }
    }

    return items.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.rawCode - b.rawCode;
    });
  }

  /**
   * Tạo mới hoặc cập nhật một mục quy ước.
   */
  async upsertLookup(data: {
    id?: string;
    category: string;
    rawCode: number;
    standardKey: string;
    displayName: string;
    description?: string | null;
    isActive?: boolean;
  }): Promise<SystemLookupItem> {
    const id = data.id || `lookup_${data.category}_${data.rawCode}_${Date.now()}`;
    const desc = data.description ? data.description.replace(/'/g, "''") : "";
    const disp = data.displayName.replace(/'/g, "''");
    const activeVal = data.isActive === false ? 0 : 1;

    await (db as any).$executeRawUnsafe(`
      INSERT INTO "system_lookups" ("id", "category", "raw_code", "standard_key", "display_name", "description", "is_active", "updated_at")
      VALUES ('${id}', '${data.category}', ${data.rawCode}, '${data.standardKey}', '${disp}', '${desc}', ${activeVal}, CURRENT_TIMESTAMP)
      ON CONFLICT("category", "raw_code") DO UPDATE SET
        "standard_key" = '${data.standardKey}',
        "display_name" = '${disp}',
        "description" = '${desc}',
        "is_active" = ${activeVal},
        "updated_at" = CURRENT_TIMESTAMP;
    `);

    await this.reloadCache();

    return {
      id,
      category: data.category,
      rawCode: data.rawCode,
      standardKey: data.standardKey,
      displayName: data.displayName,
      description: data.description || null,
      isActive: data.isActive !== false,
      updatedAt: new Date(),
    };
  }

  /**
   * Xóa một mục quy ước theo ID.
   */
  async deleteLookup(id: string): Promise<boolean> {
    await (db as any).$executeRawUnsafe(`DELETE FROM "system_lookups" WHERE "id" = '${id}'`);
    await this.reloadCache();
    return true;
  }

  /**
   * Khôi phục toàn bộ quy ước về mặc định ban đầu.
   */
  async resetToDefaults(): Promise<void> {
    await (db as any).$executeRawUnsafe(`DELETE FROM "system_lookups" WHERE "category" = 'booking_status'`);
    await this.seedDefaults();
  }
}

// Singleton instance dùng chung cho toàn bộ Backend
export const lookupService = new LookupService();
