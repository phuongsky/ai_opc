/**
 * Schema Introspection cho DB ngoài (vd: 'hotel_dbs').
 * Đọc INFORMATION_SCHEMA để lấy danh sách bảng, cột, kiểu dữ liệu, nullable, primary key.
 * Hoàn toàn read-only, an toàn tuyệt đối (R0).
 *
 * Chạy thử độc lập:
 *   npx tsx -e "import { describeHotelSunrightSchema } from './services/api/src/modules/datasources/schemaIntrospection'; describeHotelSunrightSchema().then(res => console.log(JSON.stringify(res, null, 2)));"
 */
import { getExternalDb } from "./externalDbClient";

export interface ColumnSchemaInfo {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  maxLength?: number | null;
  isPrimaryKey?: boolean;
}

export interface TableSchemaInfo {
  tableName: string;
  tableType: string;
  columns: ColumnSchemaInfo[];
}

export async function describeHotelSunrightSchema(): Promise<TableSchemaInfo[]> {
  const db = getExternalDb("hotel_dbs");

  // Query danh sách bảng trong database (bỏ qua sysdiagrams / hệ thống)
  const tables = await db("INFORMATION_SCHEMA.TABLES")
    .select("TABLE_NAME as tableName", "TABLE_TYPE as tableType")
    .whereNotIn("TABLE_NAME", ["sysdiagrams"])
    .where("TABLE_TYPE", "BASE TABLE")
    .orderBy("TABLE_NAME", "asc");

  // Query danh sách cột
  const columns = await db("INFORMATION_SCHEMA.COLUMNS")
    .select(
      "TABLE_NAME as tableName",
      "COLUMN_NAME as columnName",
      "DATA_TYPE as dataType",
      "IS_NULLABLE as isNullable",
      "CHARACTER_MAXIMUM_LENGTH as maxLength"
    )
    .orderBy(["TABLE_NAME", "ORDINAL_POSITION"]);

  // Query Primary Keys (SQL Server / ANSI compatible)
  const pkMap = new Map<string, Set<string>>();
  try {
    const pks = await db.raw(`
      SELECT 
        kcu.TABLE_NAME as tableName,
        kcu.COLUMN_NAME as columnName
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
    `);
    const pkRows = Array.isArray(pks) ? pks : (pks?.recordset || pks?.rows || []);
    for (const r of pkRows) {
      if (!pkMap.has(r.tableName)) pkMap.set(r.tableName, new Set());
      pkMap.get(r.tableName)!.add(r.columnName);
    }
  } catch {
    // fallback if raw constraint query fails
  }

  const columnsByTable = new Map<string, ColumnSchemaInfo[]>();
  for (const col of columns as Array<{ tableName: string; columnName: string; dataType: string; isNullable: string; maxLength?: number | null }>) {
    const tableCols = columnsByTable.get(col.tableName) || [];
    const isPk = pkMap.get(col.tableName)?.has(col.columnName) ?? false;
    tableCols.push({
      columnName: col.columnName,
      dataType: col.dataType,
      isNullable: col.isNullable === "YES",
      maxLength: col.maxLength ?? null,
      isPrimaryKey: isPk,
    });
    columnsByTable.set(col.tableName, tableCols);
  }

  return (tables as Array<{ tableName: string; tableType: string }>).map((t) => ({
    tableName: t.tableName,
    tableType: t.tableType,
    columns: columnsByTable.get(t.tableName) || [],
  }));
}
