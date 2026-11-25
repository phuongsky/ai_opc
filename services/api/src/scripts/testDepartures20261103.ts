import "../config/env";
import { generateExpectedDeparturesReport } from "../modules/agents/agentWorker";

async function main() {
  console.log("=== KIỂM THỬ: BÁO CÁO KHÁCH DỰ KIẾN CHECKOUT NGÀY 03/11/2026 ===");
  const report = await generateExpectedDeparturesReport("Khách dự kiến checkout ngày 3/11/2026");
  console.log("\n--- NỘI DUNG BÁO CÁO XUẤT RA ---\n");
  console.log(report);
  console.log("\n-------------------------------\n");

  if (report.includes("Phòng:** 801")) {
    console.error("❌ LỖI: Báo cáo vẫn còn chứa phòng 801 (khách chưa check-in / Exp Arr)!");
    process.exit(1);
  }

  if (!report.includes("Phòng:** 901")) {
    console.error("❌ LỖI: Báo cáo không chứa phòng 901 (khách đã check-in / In-House)!");
    process.exit(1);
  }

  if (!report.includes("Tổng số phòng:** 1")) {
    console.error("❌ LỖI: Tổng số phòng kỳ vọng là 1!");
    process.exit(1);
  }

  if (!report.includes("Tổng số khách:** 1")) {
    console.error("❌ LỖI: Tổng số khách kỳ vọng là 1!");
    process.exit(1);
  }

  console.log("✅ KIỂM THỬ THÀNH CÔNG: Phòng 801 đã được loại trừ chính xác, chỉ còn phòng 901!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Lỗi kiểm thử:", err);
  process.exit(1);
});

