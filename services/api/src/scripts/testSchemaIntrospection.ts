/**
 * Script chạy thử Schema Introspection cho database bên ngoài (hotel_dbs).
 * Lệnh chạy:
 *   pnpm --filter @ai-opc/api exec tsx src/scripts/testSchemaIntrospection.ts
 */
import "dotenv/config";
import { describeHotelSunrightSchema } from "../modules/datasources/schemaIntrospection";

async function run() {
  console.log("=== BẮT ĐẦU SCHEMA INTROSPECTION CHO HOTEL SUNRIGHT ===");
  console.log("Đang kết nối tới database và truy vấn INFORMATION_SCHEMA...\n");

  try {
    const schema = await describeHotelSunrightSchema();
    console.log(`Tìm thấy ${schema.length} bảng trong database:\n`);

    for (const table of schema) {
      console.log(`📋 Bảng: [${table.tableName}] (${table.tableType})`);
      console.log(`   Số lượng cột: ${table.columns.length}`);
      console.table(
        table.columns.map((c) => ({
          "Tên cột": c.columnName,
          "Kiểu dữ liệu": c.dataType + (c.maxLength ? `(${c.maxLength})` : ""),
          "Nullable": c.isNullable ? "YES" : "NO",
          "Primary Key": c.isPrimaryKey ? "🔑 PK" : "",
        }))
      );
      console.log("-".repeat(70));
    }

    console.log("\n=== TỔNG HỢP JSON SCHEMA TOÀN BỘ DATABASE ===");
    console.log(JSON.stringify(schema, null, 2));

    const fs = await import("fs");
    const path = await import("path");
    const outputPath = path.resolve(__dirname, "schema_intelio_sunset.json");
    fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2), "utf-8");
    console.log(`\n Đã lưu toàn bộ JSON schema ra file: ${outputPath}`);

    console.log("\n Hoàn tất Schema Introspection thành công!");
  } catch (error) {
    console.error("\n Lỗi khi kết nối hoặc đọc schema:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
  }
}

run().catch(console.error);
