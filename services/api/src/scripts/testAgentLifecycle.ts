import { db } from "../db/client";
import { decomposeGoal } from "../modules/orchestrator/orchestrator";

async function run() {
  console.log("=== BẮT ĐẦU KIỂM TRA AGENT LIFECYCLE ===");

  const testDeptId = "dept_test_lifecycle";
  const testAgentId = "agent_test_growth";

  // Dọn dẹp dữ liệu cũ nếu có
  await db.agentToolPermission.deleteMany({ where: { agentId: testAgentId } });
  await db.task.deleteMany({ where: { assignedTo: testAgentId } });
  await db.agent.deleteMany({ where: { id: testAgentId } });
  await db.department.deleteMany({ where: { id: testDeptId } });

  console.log("1. Tạo phòng ban mới...");
  const dept = await db.department.create({
    data: {
      id: testDeptId,
      name: "Phòng Tăng Trưởng Thử Nghiệm",
    },
  });
  console.log("✓ Tạo phòng ban thành công:", dept.name, `(${dept.id})`);

  console.log("2. Tuyển dụng Agent mới (Hire Agent)...");
  const agent = await db.agent.create({
    data: {
      id: testAgentId,
      name: "Growth Master AI",
      title: "Chuyên Gia Tăng Trưởng",
      departmentId: dept.id,
      reportsTo: "ai_coo",
      mission: "Phân tích số liệu và mở rộng kênh khách hàng tiềm năng",
      autonomyLevel: 3,
      budgetCapUsd: 10.0,
      active: true,
      status: "READY",
      monthlyCostUsd: 0,
    },
  });
  console.log("✓ Tuyển dụng Agent thành công:", agent.name, `[active=${agent.active}, status=${agent.status}]`);

  console.log("3. Kiểm tra danh sách Agent cho Orchestrator (Active only)...");
  const activeAgents = await db.agent.findMany({
    where: { id: { not: "ai_coo" }, active: true },
    select: { id: true, name: true, active: true },
  });
  const hasAgent = activeAgents.some((a: any) => a.id === testAgentId);
  console.log(`✓ Tìm thấy Agent trong danh sách active của Orchestrator: ${hasAgent ? "CÓ" : "KHÔNG"}`);
  if (!hasAgent) throw new Error("Agent mới tạo không xuất hiện trong danh sách active!");

  console.log("4. Cập nhật thông tin Agent (Update Agent)...");
  const updated = await db.agent.update({
    where: { id: testAgentId },
    data: {
      title: "Senior Growth Lead",
      autonomyLevel: 4,
    },
  });
  console.log("✓ Cập nhật thành công:", updated.title, `(Autonomy L${updated.autonomyLevel})`);

  console.log("5. Sa thải Agent (Fire / Soft-delete)...");
  const fired = await db.agent.update({
    where: { id: testAgentId },
    data: {
      active: false,
      status: "SUSPENDED",
      suspendedReason: "FIRED_BY_FOUNDER",
    },
  });
  console.log("✓ Sa thải thành công: active =", fired.active, "status =", fired.status);

  console.log("6. Kiểm tra lại danh sách Orchestrator khi Agent đã bị sa thải...");
  const activeAfterFire = await db.agent.findMany({
    where: { id: { not: "ai_coo" }, active: true },
    select: { id: true },
  });
  const hasFiredAgent = activeAfterFire.some((a: any) => a.id === testAgentId);
  console.log(`✓ Agent bị sa thải có bị ẩn khỏi Orchestrator không: ${!hasFiredAgent ? "ĐÚNG (ĐÃ ẨN)" : "SAI (VẪN CÒN)"}`);
  if (hasFiredAgent) throw new Error("Agent đã sa thải vẫn còn trong danh sách active!");

  console.log("7. Tuyển dụng lại Agent (Rehire Agent)...");
  const rehired = await db.agent.update({
    where: { id: testAgentId },
    data: {
      active: true,
      status: "READY",
      suspendedReason: null,
    },
  });
  console.log("✓ Tuyển dụng lại thành công: active =", rehired.active, "status =", rehired.status);

  console.log("8. Dọn dẹp dữ liệu test...");
  await db.agent.delete({ where: { id: testAgentId } });
  await db.department.delete({ where: { id: testDeptId } });
  console.log("✓ Dọn dẹp hoàn tất.");

  console.log("=== TẤT CẢ CÁC BƯỚC KIỂM TRA AGENT LIFECYCLE ĐỀU THÀNH CÔNG ===");
}

run()
  .catch((err) => {
    console.error("LỖI TEST:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
