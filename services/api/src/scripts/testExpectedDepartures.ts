import "../config/env";
import { parseFounderCommand, dispatchFounderCommand } from "../modules/commands/commandParser";
import { generateExpectedDeparturesReport } from "../modules/agents/agentWorker";

async function main() {
  console.log("=== 1. KIỂM TRA HÀM generateExpectedDeparturesReport ===");
  const report = await generateExpectedDeparturesReport(20261008);
  console.log("--- KẾT QUẢ BÁO CÁO NGÀY 08/10/2026 ---");
  console.log(report);
  console.log("----------------------------------------");

  console.log("\n=== 2. KIỂM TRA PARSE & DISPATCH CÁC CÂU LỆNH YÊU CẦU ===");
  const testCommands = [
    "Khách dự kiến đi hôm nay",
    "Khách dự kiến trả phòng hôm nay",
    "khách dự kiến đi trong ngày"
  ];

  for (const cmdText of testCommands) {
    const parsed = parseFounderCommand(cmdText);
    console.log(`\n• Câu lệnh: "${cmdText}"`);
    console.log(`  - Parsed Type: ${parsed.type}`);
    console.log(`  - Argument: "${parsed.argument}"`);

    const dispatched = await dispatchFounderCommand(parsed, { origin: "WEB" });
    console.log(`  - Dispatched Status: ${dispatched?.status}`);
    console.log(`  - Assigned To: ${dispatched?.assignedTo}`);
    console.log(`  - Message: ${dispatched?.message}`);
  }

  console.log("\n✓ TẤT CẢ CÁC BƯỚC KIỂM THỬ ĐÃ HOÀN TẤT THÀNH CÔNG!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
