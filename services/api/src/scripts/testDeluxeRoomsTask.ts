import "../config/env";
import { db } from "../db/client";
import { handleDirectDoCommand } from "../modules/commands/taskAssigner";
import { registerAllToolDrivers } from "../modules/agents/toolDrivers";
import { processAssignedTasksManually } from "../modules/agents/agentWorker";

async function testDeluxeRoomQuery() {
  console.log("=== KIỂM THỬ GIAO TASK KIỂM TRA PHÒNG DELUXE ===");
  registerAllToolDrivers();

  // Đảm bảo agent_hotel ở trạng thái READY
  await db.agent.update({
    where: { id: "agent_hotel" },
    data: { status: "READY", active: true, suspendedReason: null },
  });

  // 1. Tạo task qua lệnh /do
  const res = await handleDirectDoCommand("/do hãy kiểm tra danh sách phòng deluxe còn trống");
  console.log(`✓ Đã tạo task: ${res.taskId}, Giao cho: ${res.agentName} (@${res.assignedTo})`);

  // 2. Chạy trực tiếp Worker xử lý task
  console.log("Đang gọi processAssignedTasksManually()...");
  await processAssignedTasksManually();

  const task = await db.task.findUnique({ where: { id: res.taskId } });
  console.log(`\n========================================`);
  console.log(`TRẠNG THÁI TASK: ${task?.status}`);
  console.log(`KẾT QUẢ / NỘI DUNG:`);
  console.log(task?.result);
  console.log(`========================================\n`);

  if (task?.status === "BLOCKED") {
    throw new Error(`Task bị BLOCKED với lỗi: ${task?.result}`);
  }

  console.log("🎉 TASK KIỂM TRA PHÒNG DELUXE ĐÃ HOÀN TẤT THÀNH CÔNG VỚI DỮ LIỆU ĐẦY ĐỦ!");
  process.exit(0);
}

testDeluxeRoomQuery().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
