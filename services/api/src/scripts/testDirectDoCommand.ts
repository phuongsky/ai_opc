import { db } from "../db/client";
import { handleDirectDoCommand } from "../modules/commands/taskAssigner";

async function runTest() {
  console.log("=== KIỂM TRA ĐIỀU PHỐI LỆNH /do VÀ XỬ LÝ AGENT SA THẢI ===");

  const firedAgentId = "agent_fired_test";
  await db.agent.upsert({
    where: { id: firedAgentId },
    create: {
      id: firedAgentId,
      name: "AI-Hotel-Fired",
      title: "Former Hotel Manager",
      mission: "Quản lý khách sạn cũ",
      autonomyLevel: 1,
      active: false,
      status: "SUSPENDED",
      suspendedReason: "FIRED_BY_FOUNDER",
    },
    update: {
      active: false,
      status: "SUSPENDED",
      suspendedReason: "FIRED_BY_FOUNDER",
    },
  });

  // 1. Thử gọi trực tiếp Agent đã sa thải -> Kỳ vọng BÁO LỖI rõ ràng
  let caughtError = false;
  try {
    await handleDirectDoCommand("@ai-hotel-fired thống kê doanh thu phòng");
  } catch (err: any) {
    caughtError = true;
    console.log("✓ Bắt lỗi thành công khi @ Agent đã sa thải:", err.message);
  }
  if (!caughtError) {
    throw new Error("LỖI: Hệ thống vẫn cho phép giao việc cho Agent đã bị sa thải!");
  }

  // 2. Thử gọi Agent đang hoạt động (@tech) -> Thành công
  const resTech = await handleDirectDoCommand("@tech fix bug server");
  console.log(`✓ @tech -> Assigned to: ${resTech.assignedTo} (${resTech.agentName})`);

  // Dọn dẹp
  await db.task.deleteMany({ where: { id: resTech.taskId } });
  await db.agent.delete({ where: { id: firedAgentId } });

  console.log("🎉 KIỂM TRA BẢO VỆ AGENT ĐÃ SA THẢI HOÀN TẤT XUẤT SẮC!");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
