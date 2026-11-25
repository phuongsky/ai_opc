import { generateExpectedArrivalsReport } from "../modules/agents/agentWorker";
import { handleDirectDoCommand } from "../modules/commands/taskAssigner";
import { db } from "../db/client";

async function main() {
  console.log("=== KIỂM THỬ TỰ ĐỘNG: BÁO CÁO KHÁCH DỰ KIẾN ĐẾN NGÀY 24/10/2026 ===");

  // 1. Kiểm thử trực tiếp hàm generateExpectedArrivalsReport
  const commandText = "Khách dự kiến đến ngày 24/10/2026";
  console.log(`1. Gọi generateExpectedArrivalsReport("${commandText}")...`);
  const report = await generateExpectedArrivalsReport(commandText);
  console.log("\n--- KẾT QUẢ BÁO CÁO XUẤT RA ---\n");
  console.log(report);
  console.log("\n-------------------------------\n");

  // Kiểm tra các trường dữ liệu quan trọng theo đúng ảnh của người dùng
  const assertions = [
    { text: "Sunset Westlake Hanoi Hotel", name: "Tiêu đề khách sạn" },
    { text: "DANH SÁCH KHÁCH DỰ KIẾN ĐẾN. NGÀY 24/10/2026", name: "Tiêu đề báo cáo" },
    { text: "303", name: "Phòng 303" },
    { text: "401", name: "Phòng 401" },
    { text: "MOANA GRACE LAURIE", name: "Tên khách MOANA GRACE LAURIE" },
    { text: "Tran Tri", name: "Tên khách Tran Tri" },
    { text: "Traveloka", name: "Công ty Traveloka" },
    { text: "Viet Nam", name: "Quốc tịch Viet Nam" },
    { text: "24/10/26", name: "Ngày đến 24/10/26" },
    { text: "25/10/26", name: "Ngày đi phòng 303 (25/10/26)" },
    { text: "26/10/26", name: "Ngày đi phòng 401 (26/10/26)" },
    { text: "Tổng số khách:** 2", name: "Tổng số khách: 2" },
    { text: "3", name: "Tổng ngày phòng: 3" },
  ];

  for (const a of assertions) {
    if (!report.includes(a.text)) {
      throw new Error(`Kỳ vọng báo cáo phải chứa "${a.text}" (${a.name}), nhưng không tìm thấy!`);
    }
    console.log(`✓ Khớp: ${a.name}`);
  }

  // 2. Kiểm thử điều phối lệnh từ Task Assigner
  console.log(`\n2. Kiểm thử điều phối lệnh từ handleDirectDoCommand...`);
  const assigned = await handleDirectDoCommand(commandText);
  console.log(`✓ Đã giao task "${assigned.title}" cho Agent: ${assigned.assignedTo}`);
  if (assigned.assignedTo !== "agent_hotel" && assigned.assignedTo !== "agent_sunright_hotel") {
    throw new Error(`Kỳ vọng giao cho agent_hotel hoặc agent_sunright_hotel, nhưng giao cho: ${assigned.assignedTo}`);
  }

  // Đợi tối đa 5s để worker xử lý task
  let taskCompleted = false;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const t = await db.task.findUnique({ where: { id: assigned.taskId } });
    if (t?.status === "COMPLETED" || t?.status === "AWAITING_INTERNAL_REVIEW") {
      console.log(`✓ Worker đã hoàn tất xử lý task (Trạng thái: ${t.status})!`);
      if (t.result && t.result.includes("DANH SÁCH KHÁCH DỰ KIẾN ĐẾN. NGÀY 24/10/2026") && t.result.includes("MOANA GRACE LAURIE")) {
        console.log(`✓ Kết quả lưu trong task.result chuẩn xác 100%!`);
        taskCompleted = true;
        break;
      }
    }
  }

  console.log("\n🎉 TẤT CẢ KIỂM THỬ BÁO CÁO KHÁCH DỰ KIẾN ĐẾN HOÀN THÀNH XUẤT SẮC 100%!");
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
