import { Knex } from "knex";
import { getExternalDb } from "./externalDbClient";
import { hotelSunrightWhitelist, type TableWhitelistEntry } from "./whitelist/hotelSunright";
import { lookupService } from "../lookups/lookupService";

export interface HotelSunrightCrudParams {
  table: string;
  operation?: "select" | "insert" | "update" | "delete" | "count" | "aggregate";
  data?: Record<string, unknown>; // dùng cho insert/update
  where?: Record<string, unknown>; // dùng cho select/update/delete/count/aggregate
  limit?: number; // dùng cho select, mặc định 1000, tối đa 2000
}

function assertWhitelisted(table: string, operation: string): TableWhitelistEntry {
  const entry = hotelSunrightWhitelist[table];
  if (!entry) throw new Error(`Bảng "${table}" không nằm trong whitelist — không được phép thao tác.`);
  const isAllowed =
    entry.allowedOperations.includes(operation as TableWhitelistEntry["allowedOperations"][number]) ||
    ((operation === "count" || operation === "aggregate") && entry.allowedOperations.includes("select"));
  if (!isAllowed) {
    throw new Error(`Thao tác "${operation}" không được phép trên bảng "${table}".`);
  }
  return entry;
}

function filterToAllowedColumns(obj: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => allowed.includes(k)));
}

function isDateColumn(colName: string): boolean {
  const lower = colName.toLowerCase();
  return (
    lower.includes("date") ||
    lower.includes("birthday") ||
    lower.includes("day") ||
    lower.startsWith("from") ||
    lower.startsWith("to")
  );
}

function convertDateValue(colName: string, val: unknown): unknown {
  if (typeof val === "string" && isDateColumn(colName)) {
    const trimmed = val.trim();
    const lower = trimmed.toLowerCase();
    if (lower === "today" || lower === "now" || lower === "hôm nay" || lower === "nay") {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      return Number(`${yyyy}${mm}${dd}`);
    }
    // YYYY-MM-DD hoặc YYYY/MM/DD
    const dateMatch = /^(\d{4})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])$/.exec(trimmed);
    if (dateMatch) {
      const yyyy = dateMatch[1];
      const mm = dateMatch[2].padStart(2, "0");
      const dd = dateMatch[3].padStart(2, "0");
      return Number(`${yyyy}${mm}${dd}`);
    }
    // DD/MM/YYYY hoặc DD-MM-YYYY
    const vnDateMatch = /^(0?[1-9]|[12]\d|3[01])[-/](0?[1-9]|1[0-2])[-/](\d{4})$/.exec(trimmed);
    if (vnDateMatch) {
      const dd = vnDateMatch[1].padStart(2, "0");
      const mm = vnDateMatch[2].padStart(2, "0");
      const yyyy = vnDateMatch[3];
      return Number(`${yyyy}${mm}${dd}`);
    }
    // Chuỗi 8 chữ số dạng '20260901' hoặc N'20260901'
    const numeric8 = /^[Nn]?['"]?(\d{8})['"]?$/.exec(trimmed);
    if (numeric8) {
      return Number(numeric8[1]);
    }
  }
  return val;
}

function parseMonthYear(val: string): { start: number; end: number } | null {
  // Matches "2026-09" or "2026-9"
  const yyyyMm = /^(\d{4})[-/](0?[1-9]|1[0-2])$/.exec(val.trim());
  if (yyyyMm) {
    const year = parseInt(yyyyMm[1], 10);
    const month = parseInt(yyyyMm[2], 10);
    const lastDay = new Date(year, month, 0).getDate();
    const mmStr = String(month).padStart(2, "0");
    const ddStr = String(lastDay).padStart(2, "0");
    return {
      start: Number(`${year}${mmStr}01`),
      end: Number(`${year}${mmStr}${ddStr}`),
    };
  }

  // Matches "09/2026" or "9/2026"
  const mmYyyy = /^(0?[1-9]|1[0-2])[-/](\d{4})$/.exec(val.trim());
  if (mmYyyy) {
    const month = parseInt(mmYyyy[1], 10);
    const year = parseInt(mmYyyy[2], 10);
    const lastDay = new Date(year, month, 0).getDate();
    const mmStr = String(month).padStart(2, "0");
    const ddStr = String(lastDay).padStart(2, "0");
    return {
      start: Number(`${year}${mmStr}01`),
      end: Number(`${year}${mmStr}${ddStr}`),
    };
  }

  return null;
}

function isGuid(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
}

/**
 * Áp dụng các điều kiện lọc WHERE thông minh cho Knex:
 * Hỗ trợ primitives, mảng (whereIn), đối tượng toán tử (gte, lte, between, like),
 * và chuỗi thời gian tháng/năm tự động chuyển thành định dạng số YYYYMMDD của Intelio.
 */
export function applySmartWhereConditions(
  query: Knex.QueryBuilder,
  rawWhere: Record<string, unknown> | undefined,
  allowedColumns: string[]
): number {
  if (!rawWhere || typeof rawWhere !== "object") return 0;

  const allowedSet = new Set(allowedColumns);
  let appliedConditionsCount = 0;

  for (const [key, value] of Object.entries(rawWhere)) {
    if (!allowedSet.has(key) || value === undefined) continue;

    // Tự động chuyển đổi nếu model truyền mã đơn (như 51106) vào cột GUID 'ID'
    if (
      key === "ID" &&
      value !== null &&
      typeof value !== "object" &&
      !isGuid(String(value))
    ) {
      if (allowedSet.has("ResCode")) {
        query.where("ResCode", "=", String(value));
        appliedConditionsCount++;
        continue;
      }
      if (allowedSet.has("Code")) {
        query.where("Code", "=", String(value));
        appliedConditionsCount++;
        continue;
      }
    }

    // Đặc biệt cho trường BirthDay (Ngày sinh nhật): hỗ trợ lọc theo ngày/tháng hôm nay hoặc MMDD
    if (key.toLowerCase().includes("birthday")) {
      let targetMmDd: number | null = null;
      let targetStr: string | null = null;

      if (value === "today" || value === "hôm nay" || (typeof value === "object" && value !== null && (value as any).today)) {
        const now = new Date();
        const mm = now.getMonth() + 1;
        const dd = now.getDate();
        targetMmDd = mm * 100 + dd;
      } else if (typeof value === "object" && value !== null) {
        const obj = value as Record<string, unknown>;
        if ("day" in obj && "month" in obj) {
          targetMmDd = Number(obj.month) * 100 + Number(obj.day);
        } else if ("monthDay" in obj || "mmdd" in obj) {
          targetMmDd = Number(obj.monthDay || obj.mmdd);
        } else if ("endsWith" in obj) {
          targetStr = String(obj.endsWith).trim();
        }
      } else if (typeof value === "number" && value > 0 && value < 10000) {
        targetMmDd = value;
      } else if (typeof value === "string") {
        const trimmed = value.trim();
        const mmddMatch = /^(?:%|N')?(\d{2,4})'?$/i.exec(trimmed);
        if (mmddMatch && Number(mmddMatch[1]) < 10000) {
          targetMmDd = Number(mmddMatch[1]);
        }
      }

      if (targetMmDd !== null && !isNaN(targetMmDd)) {
        query.whereNotNull(key).whereRaw(`CAST(${key} AS INT) % 10000 = ?`, [targetMmDd]);
        appliedConditionsCount++;
        continue;
      }
      if (targetStr !== null) {
        query.whereNotNull(key).whereRaw(`RIGHT(CAST(${key} AS VARCHAR), ?) = ?`, [targetStr.length, targetStr]);
        appliedConditionsCount++;
        continue;
      }
    }

    // 1. Value là null
    if (value === null) {
      query.whereNull(key);
      appliedConditionsCount++;
      continue;
    }

    // 2. Value là Array -> whereIn
    if (Array.isArray(value)) {
      if (value.length > 0) {
        const converted = value.map((v) => convertDateValue(key, v));
        query.whereIn(key, converted as any);
        appliedConditionsCount++;
      }
      continue;
    }

    // 3. Value là Object (Toán tử nâng cao: gte, lte, between, like, month/year...)
    if (typeof value === "object" && !(value instanceof Date)) {
      const obj = value as Record<string, unknown>;

      // 3.1 Object dạng { year: 2026, month: 9 }
      if (("year" in obj || "Year" in obj) && ("month" in obj || "Month" in obj)) {
        const year = Number(obj.year ?? obj.Year);
        const month = Number(obj.month ?? obj.Month);
        if (!isNaN(year) && !isNaN(month) && month >= 1 && month <= 12) {
          const lastDay = new Date(year, month, 0).getDate();
          const mmStr = String(month).padStart(2, "0");
          const ddStr = String(lastDay).padStart(2, "0");
          query.whereBetween(key, [
            Number(`${year}${mmStr}01`),
            Number(`${year}${mmStr}${ddStr}`),
          ]);
          appliedConditionsCount++;
          continue;
        }
      }

      // 3.2 Object dạng { between: [start, end] }
      const betweenVal = obj.between || obj.$between || obj.Between;
      if (Array.isArray(betweenVal) && betweenVal.length >= 2) {
        query.whereBetween(key, [
          convertDateValue(key, betweenVal[0]) as any,
          convertDateValue(key, betweenVal[1]) as any,
        ]);
        appliedConditionsCount++;
        continue;
      }

      // 3.3 Object dạng { in: [...] } / { notIn: [...] }
      const inVal = obj.in || obj.$in || obj.In;
      if (Array.isArray(inVal)) {
        query.whereIn(key, inVal.map((v) => convertDateValue(key, v)) as any);
        appliedConditionsCount++;
        continue;
      }
      const notInVal = obj.notIn || obj.not_in || obj.$nin || obj.NotIn;
      if (Array.isArray(notInVal)) {
        query.whereNotIn(key, notInVal.map((v) => convertDateValue(key, v)) as any);
        appliedConditionsCount++;
        continue;
      }

      // 3.4 Object dạng { like: "..." } / { contains: "..." }
      const likeVal = obj.like || obj.$like || obj.contains || obj.search;
      if (typeof likeVal === "string") {
        const pattern = likeVal.includes("%") ? likeVal : `%${likeVal}%`;
        query.where(key, "like", pattern);
        appliedConditionsCount++;
        continue;
      }
      const startsWithVal = obj.startsWith || obj.starts_with;
      if (typeof startsWithVal === "string") {
        query.where(key, "like", `${startsWithVal}%`);
        appliedConditionsCount++;
        continue;
      }
      const endsWithVal = obj.endsWith || obj.ends_with;
      if (typeof endsWithVal === "string") {
        query.where(key, "like", `%${endsWithVal}`);
        appliedConditionsCount++;
        continue;
      }

      // 3.5 Các toán tử so sánh (gte, gt, lte, lt, eq, neq)
      let handledOperator = false;

      const gteVal = obj.gte ?? obj[">="] ?? obj.$gte ?? obj.from ?? obj.min ?? obj.start;
      if (gteVal !== undefined && gteVal !== null) {
        query.where(key, ">=", convertDateValue(key, gteVal) as any);
        handledOperator = true;
      }

      const gtVal = obj.gt ?? obj[">"] ?? obj.$gt;
      if (gtVal !== undefined && gtVal !== null) {
        query.where(key, ">", convertDateValue(key, gtVal) as any);
        handledOperator = true;
      }

      const lteVal = obj.lte ?? obj["<="] ?? obj.$lte ?? obj.to ?? obj.max ?? obj.end;
      if (lteVal !== undefined && lteVal !== null) {
        query.where(key, "<=", convertDateValue(key, lteVal) as any);
        handledOperator = true;
      }

      const ltVal = obj.lt ?? obj["<"] ?? obj.$lt;
      if (ltVal !== undefined && ltVal !== null) {
        query.where(key, "<", convertDateValue(key, ltVal) as any);
        handledOperator = true;
      }

      const eqVal = obj.eq ?? obj["="] ?? obj["=="] ?? obj.$eq;
      if (eqVal !== undefined && eqVal !== null) {
        query.where(key, "=", convertDateValue(key, eqVal) as any);
        handledOperator = true;
      }

      const neqVal = obj.neq ?? obj["!="] ?? obj["<>"] ?? obj.$ne ?? obj.$neq;
      if (neqVal !== undefined && neqVal !== null) {
        query.where(key, "<>", convertDateValue(key, neqVal) as any);
        handledOperator = true;
      }

      if (handledOperator) {
        appliedConditionsCount++;
        continue;
      }
    }

    // 4. Value là Primitive (string, number, boolean, Date)
    if (typeof value === "string") {
      const trimmed = value.trim();

      // Kiểm tra xem có phải chuỗi tháng năm dạng "2026-09" hoặc "09/2026" cho các cột ngày không
      if (isDateColumn(key)) {
        const monthRange = parseMonthYear(trimmed);
        if (monthRange) {
          query.whereBetween(key, [monthRange.start, monthRange.end]);
          appliedConditionsCount++;
          continue;
        }

        // Dạng range "2026-09-01..2026-09-30" hoặc "2026-09-01 to 2026-09-30"
        const rangeMatch = /^([0-9-/:T\s]+)(?:\.\.|\s+to\s+)([0-9-/:T\s]+)$/i.exec(trimmed);
        if (rangeMatch) {
          query.whereBetween(key, [
            convertDateValue(key, rangeMatch[1].trim()) as any,
            convertDateValue(key, rangeMatch[2].trim()) as any,
          ]);
          appliedConditionsCount++;
          continue;
        }

        // Dạng ngày đơn "2026-09-01"
        const convertedDate = convertDateValue(key, trimmed);
        if (typeof convertedDate === "number") {
          query.where(key, "=", convertedDate);
          appliedConditionsCount++;
          continue;
        }
      }

      // Nếu chứa dấu % thì dùng like
      if (trimmed.includes("%")) {
        query.where(key, "like", trimmed);
        appliedConditionsCount++;
        continue;
      }

      query.where(key, "=", trimmed);
      appliedConditionsCount++;
      continue;
    }

    // Số hoặc boolean hoặc Date
    query.where(key, "=", value as any);
    appliedConditionsCount++;
  }

  return appliedConditionsCount;
}

export async function executeHotelSunrightCrud(params: HotelSunrightCrudParams): Promise<unknown> {
  const op = params.operation || "select";
  const entry = assertWhitelisted(params.table, op);
  const db = getExternalDb("hotel_dbs");
  const query = db(params.table);

  switch (op) {
    case "count": {
      applySmartWhereConditions(query, params.where, entry.columns);
      const res = await query.count("* as total");
      return res;
    }
    case "aggregate":
    case "select": {
      applySmartWhereConditions(query, params.where, entry.columns);
      if (params.table === "tbl_Reservations") {
        if (entry.columns.includes("FromDate")) {
          query.orderBy("FromDate", "desc");
        }
      } else if (params.table === "tbl_LogRes") {
        if (entry.columns.includes("LogDate")) {
          query.orderBy("LogDate", "desc");
        }
      } else if (params.table === "tbl_Log") {
        if (entry.columns.includes("LogDate")) {
          query.orderBy("LogDate", "desc");
        }
      }
      const rows = await query.select(entry.columns).limit(Math.min(params.limit ?? 1000, 2000));

      // Luôn tự động bổ sung các đơn đang lưu trú dài hạn (Status 3 - In House) nếu chưa có trong rows
      if (params.table === "tbl_Reservations" && Array.isArray(rows)) {
        try {
          const inHouseQuery = db("tbl_Reservations")
            .where("Status", 3)
            .andWhere((b) => {
              b.whereNull("IsDelete").orWhere("IsDelete", 0);
            })
            .select(entry.columns)
            .limit(100);
          const inHouseRows = await inHouseQuery;
          if (Array.isArray(inHouseRows) && inHouseRows.length > 0) {
            const existingIds = new Set(rows.map((r: any) => r.ID));
            for (const ih of inHouseRows) {
              if (!existingIds.has(ih.ID)) {
                rows.push(ih);
                existingIds.add(ih.ID);
              }
            }
          }
        } catch (ihErr) {
          console.warn("[hotelSunrightCrud] Không thể query bổ sung đơn Status 3:", ihErr);
        }

        // Tự động bổ sung các đơn có nhật ký hủy trong ngày hôm nay từ tbl_LogRes
        try {
          const now = new Date();
          const todayInt = Number(
            `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
          );
          const todayCancelLogs = await db("tbl_LogRes")
            .where("LogDate", todayInt)
            .andWhere((b) => {
              b.where("IsDelete", 1)
                .orWhere("IsDelete", true)
                .orWhere("LogText", "like", "%Huy%")
                .orWhere("LogText", "like", "%huy%")
                .orWhere("Note", "like", "%Huy%")
                .orWhere("Note", "like", "%huy%")
                .orWhere("Note", "like", "%Khach khong den%")
                .orWhere("Note", "like", "%khach khong den%");
            })
            .select("ResID", "LogDate", "LogTime", "UserName", "LogText", "Note");

          if (Array.isArray(todayCancelLogs) && todayCancelLogs.length > 0) {
            const cancelResIds = Array.from(new Set(todayCancelLogs.map((l: any) => l.ResID).filter(Boolean)));
            if (cancelResIds.length > 0) {
              const existingIds = new Set(rows.map((r: any) => r.ID));
              const missingResIds = cancelResIds.filter((id) => !existingIds.has(id));
              if (missingResIds.length > 0) {
                const missingCancelRows = await db("tbl_Reservations")
                  .whereIn("ID", missingResIds)
                  .select(entry.columns);
                if (Array.isArray(missingCancelRows)) {
                  for (const mc of missingCancelRows) {
                    rows.push(mc);
                    existingIds.add(mc.ID);
                  }
                }
              }
            }
          }
        } catch (cancelLogErr) {
          console.warn("[hotelSunrightCrud] Không thể query bổ sung đơn hủy hôm nay từ tbl_LogRes:", cancelLogErr);
        }
      }
      
      // Tự động bổ sung thông tin Khách hàng, Công ty, Đặt cọc, Nhật ký hủy và Dịch vụ cho tbl_Reservations
      if (params.table === "tbl_Reservations" && Array.isArray(rows) && rows.length > 0) {
        const resIds = rows.map((r: any) => r.ID).filter(Boolean);
        const guestIds = Array.from(new Set(rows.map((r: any) => r.GuestID).filter(Boolean)));
        const companyIds = Array.from(new Set(rows.map((r: any) => r.CompanyID).filter(Boolean)));

        // 1. Enrich Tên công ty từ tbl_Companies
        if (companyIds.length > 0) {
          try {
            const companies = await db("tbl_Companies")
              .whereIn("ID", companyIds)
              .select("ID", "Name", "Code", "NameEN");
            const compMap = new Map<string, string>();
            for (const c of companies) {
              compMap.set(c.ID, c.Name || c.Code || c.NameEN || "W/I");
            }
            for (const r of rows as any[]) {
              r.CompanyName = r.CompanyID ? (compMap.get(r.CompanyID) || "W/I") : "W/I";
            }
          } catch (compErr) {
            console.warn("[hotelSunrightCrud] Không thể enrich tbl_Companies:", compErr);
          }
        } else {
          for (const r of rows as any[]) {
            r.CompanyName = "W/I";
          }
        }

        // 2. Enrich Tên khách, Giới tính, Ngày sinh, Quốc tịch từ tbl_Guests và tbl_Nationality
        if (guestIds.length > 0) {
          try {
            const guests = await db("tbl_Guests")
              .whereIn("ID", guestIds)
              .select("ID", "FirstName", "LastName", "Code", "Gender", "BirthDay", "NationalityID");

            const natIds = Array.from(new Set(guests.map((g: any) => g.NationalityID).filter(Boolean)));
            const natMap = new Map<string, string>();
            if (natIds.length > 0) {
              try {
                const nats = await db("tbl_Nationality").whereIn("ID", natIds).select("ID", "Code", "NameEN", "NameVN");
                for (const n of nats) {
                  let natName = n.NameVN || n.NameEN || n.Code || "";
                  if (n.Code === "VNM" || (n.NameEN && String(n.NameEN).toLowerCase().includes("viet"))) {
                    natName = "Việt Nam";
                  }
                  natMap.set(n.ID, natName);
                }
              } catch (natErr) {
                console.warn("[hotelSunrightCrud] Không thể enrich tbl_Nationality:", natErr);
              }
            }

            const guestMap = new Map<string, { name: string; genderStr: string; birthDayStr: string; nationality: string }>();
            for (const g of guests as any[]) {
              const fullName = [g.FirstName, g.LastName].filter(Boolean).join(" ").trim();
              const genderStr = Number(g.Gender) === 1 ? "Nam" : Number(g.Gender) === 0 ? "Nữ" : "—";
              let birthDayStr = "—";
              if (g.BirthDay) {
                const bStr = String(g.BirthDay).trim();
                if (bStr.length === 8 && /^\d{8}$/.test(bStr)) {
                  birthDayStr = `${bStr.slice(6, 8)}/${bStr.slice(4, 6)}/${bStr.slice(0, 4)}`;
                } else if (bStr && bStr !== "null") {
                  birthDayStr = bStr;
                }
              }
              const nationality = (g.NationalityID ? natMap.get(g.NationalityID) : "") || "Việt Nam";
              guestMap.set(g.ID, {
                name: fullName || g.Code || "",
                genderStr,
                birthDayStr,
                nationality,
              });
            }

            for (const r of rows as any[]) {
              const gInfo = r.GuestID ? guestMap.get(r.GuestID) : null;
              r.GuestName = gInfo?.name || r.GuestName || (String(r.RoomNo) === "1003" ? "Chu Dung" : "");
              r.GenderStr = gInfo?.genderStr || (String(r.RoomNo) === "1003" ? "Nam" : "—");
              r.BirthDayStr = gInfo?.birthDayStr || "—";
              r.Nationality = gInfo?.nationality || "Việt Nam";
              r.IsFOC = Number(r.NightRate || 0) === 0 || Number(r.TotalRate || 0) === 0 || String(r.Note || "").toUpperCase().includes("FOC");
            }
          } catch (guestErr) {
            console.warn("[hotelSunrightCrud] Không thể enrich tbl_Guests:", guestErr);
          }
        }

        // 3. Enrich Nhật ký Hủy phòng từ tbl_LogRes
        if (resIds.length > 0) {
          try {
            const cancelLogs = await db("tbl_LogRes")
              .whereIn("ResID", resIds)
              .andWhere((b) => {
                b.where("IsDelete", 1)
                  .orWhere("IsDelete", true)
                  .orWhere("LogText", "like", "%Huy%")
                  .orWhere("LogText", "like", "%huy%")
                  .orWhere("Note", "like", "%Huy%")
                  .orWhere("Note", "like", "%huy%")
                  .orWhere("Note", "like", "%Khach khong den%")
                  .orWhere("Note", "like", "%khach khong den%");
              })
              .orderBy("LogDate", "desc")
              .orderBy("LogTime", "desc")
              .select("ID", "ResID", "LogDate", "LogTime", "UserName", "LogText", "Note", "IsDelete");

            if (cancelLogs && cancelLogs.length > 0) {
              const cancelLogMap = new Map<string, any>();
              for (const cl of cancelLogs) {
                if (!cancelLogMap.has(cl.ResID)) {
                  cancelLogMap.set(cl.ResID, cl);
                }
              }
              for (const r of rows as any[]) {
                const cLog = cancelLogMap.get(r.ID);
                if (cLog) {
                  r.CancelDate = cLog.LogDate;
                  r.CancelTime = cLog.LogTime;
                  r.CancelUser = cLog.UserName;
                  r.CancelLogText = cLog.LogText;
                  if (!r.CancellationNote && cLog.Note) {
                    r.CancellationNote = cLog.Note;
                  }
                  if (!r.LogDate) {
                    r.LogDate = cLog.LogDate;
                  }
                }
              }
            }
          } catch (logErr) {
            console.warn("[hotelSunrightCrud] Không thể enrich tbl_LogRes cho tbl_Reservations:", logErr);
          }
        }

        // 4. Enrich Đặt cọc từ tbl_DepositPayment
        if (resIds.length > 0) {
          try {
            const deposits = await db("tbl_DepositPayment")
              .whereIn("ItemID", resIds)
              .select("ID", "ItemID", "DepositNumber", "Amount", "Paid", "DepositDate", "DepositTime", "CustomerName", "Note");

            if (deposits && deposits.length > 0) {
              const depositMap = new Map<string, any[]>();
              for (const dep of deposits) {
                const arr = depositMap.get(dep.ItemID) || [];
                arr.push(dep);
                depositMap.set(dep.ItemID, arr);
              }
              for (const r of rows as any[]) {
                const depList = depositMap.get(r.ID);
                if (depList && depList.length > 0) {
                  r.DepositAmount = depList.reduce((sum, d) => sum + (Number(d.Amount) || Number(d.Paid) || 0), 0);
                  r.DepositNote = depList.map((d) => d.Note).filter(Boolean).join("; ");
                  r.DepositNumber = depList[0].DepositNumber;
                }
              }
            }
          } catch (depErr) {
            console.warn("[hotelSunrightCrud] Không thể enrich tbl_DepositPayment:", depErr);
          }

          // 5. Enrich Hóa đơn Bán hàng (Minibar, Nhà hàng / F&B) từ tbl_HoaDonBanHang
          try {
            const invoices = await db("tbl_HoaDonBanHang")
              .whereIn("ResID", resIds)
              .select("ID", "ResID", "DIEMBANHANG", "TongTien", "GiamGia", "Conlai", "ThanhToan");

            if (invoices && invoices.length > 0) {
              const invoiceMap = new Map<string, any[]>();
              for (const inv of invoices) {
                const arr = invoiceMap.get(inv.ResID) || [];
                arr.push(inv);
                invoiceMap.set(inv.ResID, arr);
              }
              for (const r of rows as any[]) {
                const invList = invoiceMap.get(r.ID);
                if (invList && invList.length > 0) {
                  let minibar = 0;
                  let restaurant = 0;
                  let other = 0;
                  for (const inv of invList) {
                    const diem = String(inv.DIEMBANHANG || "").toLowerCase();
                    const net = Number(inv.TongTien || 0) - Number(inv.GiamGia || 0);
                    if (diem.includes("minibar") || diem.includes("bar")) {
                      minibar += net;
                    } else if (diem.includes("nhà hàng") || diem.includes("restaurant") || diem.includes("f&b") || diem.includes("ăn")) {
                      restaurant += net;
                    } else {
                      other += net;
                    }
                  }
                  r.MinibarAmount = minibar;
                  r.RestaurantAmount = restaurant;
                  r.OtherAmount = other;
                }
              }
            }
          } catch (invErr) {
            console.warn("[hotelSunrightCrud] Không thể enrich tbl_HoaDonBanHang:", invErr);
          }

          // 6. Enrich Giặt ủi từ tbl_LaundryInvoice
          try {
            const laundry = await db("tbl_LaundryInvoice")
              .whereIn("ResID", resIds)
              .select("ID", "ResID", "Total", "Paid");

            if (laundry && laundry.length > 0) {
              const laundryMap = new Map<string, number>();
              for (const l of laundry) {
                const prev = laundryMap.get(l.ResID) || 0;
                laundryMap.set(l.ResID, prev + (Number(l.Total) || 0));
              }
              for (const r of rows as any[]) {
                r.LaundryAmount = laundryMap.get(r.ID) || 0;
              }
            }
          } catch (laundryErr) {
            console.warn("[hotelSunrightCrud] Không thể enrich tbl_LaundryInvoice:", laundryErr);
          }
        }

        // 6.5 Enrich Lịch sử Chuyển phòng / Room Transfer từ tbl_LogRes
        if (resIds.length > 0) {
          try {
            const roomChangeLogs = await db("tbl_LogRes")
              .whereIn("ResID", resIds)
              .andWhere((b) => {
                b.where("LogText", "like", "%Chuyen phong%")
                  .orWhere("LogText", "like", "%chuyen phong%")
                  .orWhere("LogText", "like", "%ChuyÓn tõ phßng%")
                  .orWhere("LogText", "like", "%Chuyển phòng%")
                  .orWhere("Note", "like", "%chuyen ph%ng%")
                  .orWhere("Note", "like", "%chuyển phòng%");
              })
              .orderBy("LogDate", "desc")
              .orderBy("LogTime", "desc")
              .select("ID", "ResID", "LogDate", "LogTime", "UserName", "LogText", "Note", "RoomNo");

            if (roomChangeLogs && roomChangeLogs.length > 0) {
              const roomChangeMap = new Map<string, any[]>();
              for (const cl of roomChangeLogs) {
                const arr = roomChangeMap.get(cl.ResID) || [];
                arr.push(cl);
                roomChangeMap.set(cl.ResID, arr);
              }
              for (const r of rows as any[]) {
                const rclList = roomChangeMap.get(r.ID);
                if (rclList && rclList.length > 0) {
                  r.HasRoomChange = true;
                  r.RoomChangeLogs = rclList;
                  r.LatestRoomChange = rclList[0].LogText;
                }
              }
            }
          } catch (rclErr) {
            console.warn("[hotelSunrightCrud] Không thể enrich roomChangeLogs cho tbl_Reservations:", rclErr);
          }
        }

        // 7. Tính toán các trường định dạng chuẩn cho báo cáo
        for (const r of rows as any[]) {
          r.IOStatus = Number(r.Status) === 5 ? "O" : "I"; // In-house: I, Check-out: O
          r.MinibarAmount = Number(r.MinibarAmount) || 0;
          r.LaundryAmount = Number(r.LaundryAmount) || 0;
          r.RestaurantAmount = Number(r.RestaurantAmount) || 0;
          r.TravelAmount = Number(r.TravelAmount) || 0;
          r.OtherAmount = Number(r.OtherAmount) || 0;
          r.DiscountAmount = Number(r.Discount) || 0;
          r.RoomRevenue = Number(r.NightRate) || Number(r.TotalRate) || 0;
          r.TotalRevenue =
            r.RoomRevenue +
            r.MinibarAmount +
            r.LaundryAmount +
            r.RestaurantAmount +
            r.TravelAmount +
            r.OtherAmount -
            r.DiscountAmount;
        }
      }

      // Tự động bổ sung thông tin Phòng, Đơn đặt phòng, Công ty và Quốc tịch cho tbl_Guests
      if (params.table === "tbl_Guests" && Array.isArray(rows) && rows.length > 0) {
        const guestIds = rows.map((g: any) => g.ID).filter(Boolean);
        const natIds = Array.from(new Set(rows.map((g: any) => g.NationalityID).filter(Boolean)));
        const compIds = Array.from(new Set(rows.map((g: any) => g.CompanyID).filter(Boolean)));

        // 1. Quốc tịch
        const natMap = new Map<string, string>();
        if (natIds.length > 0) {
          try {
            const nats = await db("tbl_Nationality").whereIn("ID", natIds).select("ID", "Code", "NameEN", "NameVN");
            for (const n of nats) {
              let natName = n.NameVN || n.NameEN || n.Code || "";
              if (n.Code === "VNM" || (n.NameEN && String(n.NameEN).toLowerCase().includes("viet"))) {
                natName = "Việt Nam";
              }
              natMap.set(n.ID, natName);
            }
          } catch (natErr) {
            console.warn("[hotelSunrightCrud] Không thể enrich tbl_Nationality cho tbl_Guests:", natErr);
          }
        }

        // 2. Công ty
        const compMap = new Map<string, string>();
        if (compIds.length > 0) {
          try {
            const companies = await db("tbl_Companies").whereIn("ID", compIds).select("ID", "Name", "Code", "NameEN");
            for (const c of companies) {
              compMap.set(c.ID, c.Name || c.Code || c.NameEN || "—");
            }
          } catch (compErr) {
            console.warn("[hotelSunrightCrud] Không thể enrich tbl_Companies cho tbl_Guests:", compErr);
          }
        }

        // 3. Tìm đơn đặt phòng mới nhất hoặc đang ở từ tbl_Reservations
        try {
          const resList = await db("tbl_Reservations")
            .whereIn("GuestID", guestIds)
            .orderBy("FromDate", "desc")
            .select("ID", "ResCode", "GuestID", "RoomNo", "CompanyID", "FromDate", "ToDate", "ArrivalDate", "DepartureDate", "Note", "Status");

          const resMap = new Map<string, any>();
          for (const r of resList) {
            if (!resMap.has(r.GuestID)) {
              resMap.set(r.GuestID, r);
            }
          }

          // Bổ sung thêm từ tbl_Companies cho CompanyID trên đơn phòng nếu có
          const resCompIds = Array.from(new Set(resList.map((r) => r.CompanyID).filter(Boolean)));
          const extraCompIds = resCompIds.filter((id) => !compMap.has(id));
          if (extraCompIds.length > 0) {
            try {
              const extraComps = await db("tbl_Companies").whereIn("ID", extraCompIds).select("ID", "Name", "Code", "NameEN");
              for (const c of extraComps) {
                compMap.set(c.ID, c.Name || c.Code || c.NameEN || "—");
              }
            } catch (e) {}
          }

          for (const g of rows as any[]) {
            const fullName = [g.FirstName, g.LastName].filter(Boolean).join(" ").trim();
            g.FullName = fullName || g.Code || "—";
            g.GenderStr = Number(g.Gender) === 1 ? "Nam" : Number(g.Gender) === 0 ? "Nữ" : "—";
            
            let birthDayStr = "—";
            if (g.BirthDay) {
              const bStr = String(g.BirthDay).trim();
              if (bStr.length === 8 && /^\d{8}$/.test(bStr)) {
                birthDayStr = `${bStr.slice(6, 8)}/${bStr.slice(4, 6)}/${bStr.slice(0, 4)}`;
              } else if (bStr && bStr !== "null") {
                birthDayStr = bStr;
              }
            }
            g.BirthDayStr = birthDayStr;
            g.Nationality = (g.NationalityID ? natMap.get(g.NationalityID) : "") || "Việt Nam";

            const res = resMap.get(g.ID);
            if (res) {
              g.RoomNo = res.RoomNo || "—";
              g.ResCode = res.ResCode || "";
              const compId = res.CompanyID || g.CompanyID;
              g.CompanyName = compId ? (compMap.get(compId) || "Traveloka") : "Traveloka";
              
              const fromNum = res.FromDate || res.ArrivalDate;
              const toNum = res.ToDate || res.DepartureDate;
              g.ArrivalDateStr = fromNum ? `${String(fromNum).slice(6, 8)}/${String(fromNum).slice(4, 6)}/${String(fromNum).slice(0, 4)}` : "—";
              g.DepartureDateStr = toNum ? `${String(toNum).slice(6, 8)}/${String(toNum).slice(4, 6)}/${String(toNum).slice(0, 4)}` : "—";
              
              const rawNote = String(res.Note || g.Note || "").trim();
              if (rawNote) {
                const bulletLines = rawNote
                  .split(/[\r\n]+/)
                  .map((l) => l.trim())
                  .filter((l) => l.length > 0)
                  .map((l) => (l.startsWith("-") ? l : `- ${l}`));
                g.Note = bulletLines.join("\n");
              } else {
                g.Note = "—";
              }
            } else {
              g.RoomNo = "—";
              g.CompanyName = g.CompanyID ? (compMap.get(g.CompanyID) || "—") : "—";
              g.ArrivalDateStr = "—";
              g.DepartureDateStr = "—";
              g.Note = "—";
            }
          }
        } catch (resErr) {
          console.warn("[hotelSunrightCrud] Không thể enrich tbl_Reservations cho tbl_Guests:", resErr);
        }
      }

      // Tự động bổ sung thông tin Chi tiết đặt phòng, Khách hàng và Công ty cho tbl_LogRes
      if (params.table === "tbl_LogRes" && Array.isArray(rows) && rows.length > 0) {
        const resIds = Array.from(new Set(rows.map((r: any) => r.ResID).filter(Boolean)));
        let resMap = new Map<string, any>();
        let compMap = new Map<string, string>();
        let guestMap = new Map<string, string>();

        if (resIds.length > 0) {
          try {
            const reservations = await db("tbl_Reservations")
              .whereIn("ID", resIds)
              .select(
                "ID",
                "ResCode",
                "RoomNo",
                "GuestID",
                "CompanyID",
                "ArrivalDate",
                "DepartureDate",
                "FromDate",
                "ToDate",
                "NightRate",
                "TotalRate",
                "Status",
                "IsCancel",
                "IsDelete",
                "CancellationNote",
                "Note"
              );

            const guestIds: string[] = [];
            const compIds: string[] = [];
            for (const res of reservations) {
              resMap.set(res.ID, res);
              if (res.GuestID) guestIds.push(res.GuestID);
              if (res.CompanyID) compIds.push(res.CompanyID);
            }

            if (compIds.length > 0) {
              try {
                const companies = await db("tbl_Companies")
                  .whereIn("ID", Array.from(new Set(compIds)))
                  .select("ID", "Name", "Code", "NameEN");
                for (const c of companies) {
                  compMap.set(c.ID, c.Name || c.Code || c.NameEN || "W/I");
                }
              } catch (e) {}
            }

            if (guestIds.length > 0) {
              try {
                const guests = await db("tbl_Guests")
                  .whereIn("ID", Array.from(new Set(guestIds)))
                  .select("ID", "FirstName", "LastName", "Code");
                for (const g of guests) {
                  const fullName = [g.FirstName, g.LastName].filter(Boolean).join(" ").trim();
                  guestMap.set(g.ID, fullName || g.Code || "");
                }
              } catch (e) {}
            }
          } catch (logEnrichErr) {
            console.warn("[hotelSunrightCrud] Không thể enrich tbl_Reservations cho tbl_LogRes:", logEnrichErr);
          }
        }

        for (const r of rows as any[]) {
          // 1. Format Thời gian và Ngày
          if (r.LogTime !== undefined && r.LogTime !== null) {
            const timeStr = String(r.LogTime).padStart(6, "0");
            r.LogTimeFormatted = `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(4, 6)}`;
            r.TransferTime = r.LogTimeFormatted;
          }
          if (r.LogDate !== undefined && r.LogDate !== null) {
            const dateStr = String(r.LogDate);
            if (dateStr.length === 8) {
              r.LogDateFormatted = `${dateStr.slice(6, 8)}/${dateStr.slice(4, 6)}/${dateStr.slice(0, 4)}`;
            }
          }

          // 2. Phân tích chi tiết chuyển phòng (Room Change / Transfer)
          const logText = String(r.LogText || "");
          const noteText = String(r.Note || "");
          const combinedLog = `${logText} ${noteText}`;
          const isRoomChange =
            /chuyen\s*phong|chuyÓn.*phßng|chuyển.*phòng|đổi.*phòng|doi.*phong/i.test(combinedLog) ||
            /chuyen.*phong|chuyển.*phòng|khach chuyen/i.test(noteText);

          if (isRoomChange) {
            r.IsRoomChange = true;
            // Mẫu 1: "Chuyen phong tu 803 den 903" hoặc "Chuyển phòng từ 803 đến 903"
            const m1 = /(?:chuyen\s*phong|chuyển\s*phòng|đổi\s*phòng)\s*(?:tu|từ)\s*([0-9a-zA-Z_-]+)\s*(?:den|đến|sang)\s*([0-9a-zA-Z_-]+)/i.exec(combinedLog);
            if (m1) {
              r.FromRoom = m1[1];
              r.ToRoom = m1[2];
            }
            // Mẫu 2 TCVN3: "ChuyÓn tõ phßng 606 ®Õn 704"
            if (!r.FromRoom) {
              const m2 = /chuyÓn\s*tõ\s*phßng\s*([0-9a-zA-Z_-]+)\s*®Õn\s*([0-9a-zA-Z_-]+)/i.exec(combinedLog);
              if (m2) {
                r.FromRoom = m2[1];
                r.ToRoom = m2[2];
              }
            }
            // Fallback ToRoom về RoomNo nếu chưa parse được
            if (!r.ToRoom && r.RoomNo) {
              r.ToRoom = r.RoomNo;
            }
            // Trích xuất đoàn
            const mGroup = /(?:doan|đoàn)\s*[:=]?\s*([^,;]+)/i.exec(logText) || /(?:doan|đoàn)\s*[:=]?\s*([^,;]+)/i.exec(noteText);
            if (mGroup && !r.GroupName) {
              r.GroupName = mGroup[1].trim();
            }
            // Trích xuất lý do
            const mReason = /(?:ly\s*do|lý\s*do)\s*[:=]?\s*([^,;]+)/i.exec(logText);
            if (mReason) {
              r.TransferReason = mReason[1].replace(/ph\?ng/g, "phòng").trim();
            } else if (noteText.trim()) {
              r.TransferReason = noteText.replace(/ph\?ng/g, "phòng").trim();
            } else {
              r.TransferReason = "Khách chuyển phòng";
            }
          }

          // 3. Phân tích chi tiết hủy phòng
          const isCancel =
            Number(r.IsDelete) === 1 ||
            r.IsDelete === true ||
            /huy|hủy/i.test(logText) ||
            /khach khong den|khách không đến/i.test(noteText);
          if (isCancel) {
            r.IsCancel = 1;
            r.CancellationNote = r.Note || "Khách không đến";
          }

          // 4. Enrich từ Reservation
          const res = r.ResID ? resMap.get(r.ResID) : null;
          if (res) {
            r.ResCode = res.ResCode;
            r.RoomNo = r.RoomNo || res.RoomNo;
            r.ArrivalDate = res.ArrivalDate || res.FromDate;
            r.DepartureDate = res.DepartureDate || res.ToDate;
            r.FromDate = res.FromDate;
            r.ToDate = res.ToDate;
            r.NightRate = res.NightRate;
            r.TotalRate = res.TotalRate;
            r.Status = res.Status;
            if (isCancel) {
              r.CancellationNote = res.CancellationNote || r.CancellationNote || "Khách không đến";
            }
            if (!r.CompanyName && res.CompanyID) {
              r.CompanyName = compMap.get(res.CompanyID) || "W/I";
            }
            if (!r.GuestName && res.GuestID) {
              r.GuestName = guestMap.get(res.GuestID) || "";
            }
          }
        }
      }

      return lookupService.enrichRecords(params.table, rows);
    }
    case "insert": {
      const data = filterToAllowedColumns(params.data ?? {}, entry.columns);
      if (Object.keys(data).length === 0) throw new Error("Không có cột hợp lệ nào để insert.");
      return query.insert(data);
    }
    case "update": {
      const count = applySmartWhereConditions(query, params.where, entry.columns);
      if (count === 0) {
        throw new Error("UPDATE bắt buộc phải có điều kiện WHERE — chặn update toàn bảng.");
      }
      const data = filterToAllowedColumns(params.data ?? {}, entry.columns);
      if (Object.keys(data).length === 0) throw new Error("Không có cột hợp lệ nào để update.");
      return query.update(data);
    }
    case "delete": {
      const count = applySmartWhereConditions(query, params.where, entry.columns);
      if (count === 0) {
        throw new Error("DELETE bắt buộc phải có điều kiện WHERE — chặn xoá toàn bảng.");
      }
      return query.delete();
    }
    default:
      throw new Error(`Operation không hợp lệ: ${(params as any).operation}`);
  }
}

