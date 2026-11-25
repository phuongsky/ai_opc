import "../config/env";
import { getExternalDb } from "../modules/datasources/externalDbClient";

async function testConn() {
  console.log("=== KIỂM TRA KẾT NỐI EXTERNAL DB (HOTEL_DBS) ===");
  try {
    const db = getExternalDb("hotel_dbs");
    console.log("Knex instance created. Testing raw query...");
    const start = Date.now();
    const result = await db.raw("SELECT @@VERSION as version");
    console.log(`✓ Kết nối thành công trong ${Date.now() - start}ms:`, result);
  } catch (err: any) {
    console.error("✗ Lỗi kết nối:", err);
  } finally {
    process.exit(0);
  }
}

testConn().catch(console.error);
