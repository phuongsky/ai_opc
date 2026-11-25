import "../config/env";
import { describeHotelSunrightSchema } from "../modules/datasources/schemaIntrospection";

async function testSchema() {
  console.log("=== KIỂM TRA DESCRIBE HOTEL SUNRIGHT SCHEMA ===");
  try {
    const start = Date.now();
    const schema = await describeHotelSunrightSchema();
    console.log(`✓ Schema lấy thành công trong ${Date.now() - start}ms:`, schema.length, "tables");
  } catch (err: any) {
    console.error("✗ Lỗi describe schema:", err);
  } finally {
    process.exit(0);
  }
}

testSchema().catch(console.error);
