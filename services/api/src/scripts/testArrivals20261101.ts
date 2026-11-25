import "../config/env";
import { generateExpectedArrivalsReport } from "../modules/agents/agentWorker";

async function main() {
  console.log("=== KIỂM THỬ: BÁO CÁO KHÁCH DỰ KIẾN ĐẾN HÔM NAY (01/11/2026) ===");
  const report = await generateExpectedArrivalsReport("Khách dự kiến đến hôm nay");
  console.log("\n--- NỘI DUNG BÁO CÁO XUẤT RA ---\n");
  console.log(report);
  console.log("\n-------------------------------\n");

  if (report.includes("901")) {
    console.error("❌ LỖI: Báo cáo vẫn còn chứa phòng 901 (đã check-in/In-house)!");
    process.exit(1);
  }

  if (!report.includes("801")) {
    console.error("❌ LỖI: Báo cáo không chứa phòng 801 (khách dự kiến đến)!");
    process.exit(1);
  }

  if (!report.includes("SL: 1")) {
    console.error("❌ LỖI: Số lượng đoàn kỳ vọng là SL: 1!");
    process.exit(1);
  }

  if (!report.includes("Tổng số phòng:** 1 phòng")) {
    console.error("❌ LỖI: Tổng số phòng kỳ vọng là 1 phòng!");
    process.exit(1);
  }

  console.log("✅ KIỂM THỬ THÀNH CÔNG: Phòng 901 đã được loại bỏ chính xác, chỉ còn phòng 801!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});

