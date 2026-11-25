import { db } from "../db/client";
import { handleDirectDoCommand } from "../modules/commands/taskAssigner";

async function runDynamicDispatchTest() {
  console.log("=== KIỂM THỬ ĐIỀU PHỐI ĐỘNG KHI SA THẢI VÀ TUYỂN AGENT MỚI ===");

  const originalHotelId = "agent_sunright_hotel";

  // Dọn dẹp bản ghi rác test nếu có
  await db.agent.deleteMany({ where: { id: "agent_hotel_vn" } });

  // 1. Sa thải agent_sunright_hotel
  await db.agent.update({
    where: { id: originalHotelId },
    data: {
      active: false,
      status: "SUSPENDED",
      suspendedReason: "FIRED_BY_FOUNDER",
    },
  });
  console.log(`✓ [Bước 1] Đã xác nhận sa thải Agent cũ "${originalHotelId}"`);

  // 2. Kiểm tra xem Agent "AI-Hotel" (agent_hotel) có đang Active không
  const activeHotelAgent = await db.agent.findFirst({
    where: { id: "agent_hotel", active: true },
  });
  console.log(`✓ [Bước 2] Agent khách sạn đang Active: "${activeHotelAgent?.name}" (@${activeHotelAgent?.id})`);

  // 3. Giao việc bằng @hotel: Hệ thống PHẢI gán cho AI-Hotel (@agent_hotel), KHÔNG gán cho Sunright_hotel cũ
  const resHotel = await handleDirectDoCommand(
    "/do @hotel hãy thống kê tình trạng đặt phòng có status = 1 và trong tháng 9/2026"
  );
  console.log(`✓ [Bước 3] Kết quả phân giải @hotel -> Giao cho: ${resHotel.agentName} (@${resHotel.assignedTo})`);
  if (resHotel.assignedTo !== "agent_hotel") {
    throw new Error(
      `LỖI: Kỳ vọng giao cho agent_hotel (AI-Hotel) nhưng lại giao cho ${resHotel.assignedTo}!`
    );
  }

  // 4. Giao việc bằng từ khóa nghiệp vụ mà không có @: Kỳ vọng gán cho AI-Hotel
  const resKeyword = await handleDirectDoCommand(
    "/do hãy kiểm tra danh sách phòng deluxe còn trống"
  );
  console.log(`✓ [Bước 4] Kết quả phân giải từ khóa -> Giao cho: ${resKeyword.agentName} (@${resKeyword.assignedTo})`);
  if (resKeyword.assignedTo !== "agent_hotel") {
    throw new Error(
      `LỖI: Kỳ vọng giao cho agent_hotel nhưng lại giao cho ${resKeyword.assignedTo}!`
    );
  }

  // 5. Thử gõ đích danh ID cũ @agent_sunright_hotel: Kỳ vọng hệ thống báo lỗi rõ ràng
  let caughtExplicitFired = false;
  try {
    await handleDirectDoCommand(`@${originalHotelId} lấy báo cáo cũ`);
  } catch (err: any) {
    caughtExplicitFired = true;
    console.log(`✓ [Bước 5] Báo lỗi chính xác khi gõ đích danh ID cũ: "${err.message}"`);
  }
  if (!caughtExplicitFired) {
    throw new Error("LỖI: Cố tình gọi ID cũ đã sa thải mà không có lỗi cảnh báo!");
  }

  // 6. Sa thải cả agent_hotel, sau đó gõ @hotel: Kỳ vọng tự động chuyển an toàn về AI-COO
  await db.agent.update({
    where: { id: "agent_hotel" },
    data: { active: false, status: "SUSPENDED", suspendedReason: "FIRED_BY_FOUNDER" },
  });
  const resFallbackCoo = await handleDirectDoCommand("@hotel xử lý việc khẩn cấp khi mọi agent khách sạn đều ngưng hoạt động");
  console.log(`✓ [Bước 6] Fallback an toàn khi không có agent khách sạn nào active -> Giao cho: ${resFallbackCoo.agentName} (@${resFallbackCoo.assignedTo})`);
  if (resFallbackCoo.assignedTo !== "ai_coo") {
    throw new Error(`Kỳ vọng fallback về ai_coo nhưng nhận ${resFallbackCoo.assignedTo}`);
  }

  // 7. Khôi phục lại trạng thái active cho agent_hotel và dọn dẹp task test
  await db.agent.update({
    where: { id: "agent_hotel" },
    data: { active: true, status: "READY", suspendedReason: null },
  });
  await db.task.deleteMany({
    where: {
      id: { in: [resHotel.taskId, resKeyword.taskId, resFallbackCoo.taskId] },
    },
  });

  console.log("🎉 TẤT CẢ KIỂM THỬ ĐIỀU PHỐI ĐỘNG KHI SA THẢI AGENT HOÀN THÀNH XUẤT SẮC!");
}

runDynamicDispatchTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
