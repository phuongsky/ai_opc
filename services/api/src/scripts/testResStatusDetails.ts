import "../config/env";
import { getExternalDb } from "../modules/datasources/externalDbClient";

async function main() {
  const db = await getExternalDb("hotel_dbs");
  if (!db) process.exit(1);

  const dateNum = 20260929;
  const resList = await db("tbl_Reservations")
    .where("FromDate", "<=", dateNum)
    .where("ToDate", ">=", dateNum)
    .where("IsCancel", 0)
    .where("IsDelete", 0)
    .select("*");

  console.log(`Reservations overlapping 2026-09-29: ${resList.length}`);
  for (const r of resList) {
    console.log(`ResCode: ${r.ResCode}, Room: ${r.RoomNo}, Status: ${r.Status}, From: ${r.FromDate}, To: ${r.ToDate}, CheckInDate: ${r.CheckInDate}, CheckInTime: ${r.CheckInTime}`);
  }

  process.exit(0);
}

main().catch(console.error);
