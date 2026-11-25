import { rbacService, RBAC_COMMANDS } from "../modules/rbac/rbacService";
import type { RbacRoleId } from "@ai-opc/shared";

async function runTests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ PHÂN QUYỀN RBAC COMMANDS ===");

  // 1. Kiểm tra ma trận trả về đầy đủ danh sách commands và commandPermissions
  const matrix = await rbacService.getPermissionsMatrix();
  if (!matrix.commands || matrix.commands.length !== RBAC_COMMANDS.length) {
    throw new Error(`Kỳ vọng ${RBAC_COMMANDS.length} commands, nhưng nhận được ${matrix.commands?.length}`);
  }
  console.log(`✓ Ma trận trả về đủ ${matrix.commands.length} commands.`);

  // 2. Founder luôn luôn có toàn quyền tất cả các lệnh
  for (const cmd of RBAC_COMMANDS) {
    const allowed = rbacService.canRoleExecuteCommand("founder", cmd.command);
    if (!allowed) {
      throw new Error(`Founder phải có quyền chạy ${cmd.command}`);
    }
  }
  console.log("✓ Founder: 100% lệnh được phép thực thi (toàn quyền quản trị).");

  // 3. Kiểm tra quyền mặc định của Viewer
  const viewerExpectedAllowed = ["/report", "/status", "/audit"];
  const viewerExpectedBlocked = ["/hire", "/do @marketing task", "/goal Strategic goal", "/settings", "/stop"];

  for (const cmd of viewerExpectedAllowed) {
    if (!rbacService.canRoleExecuteCommand("viewer", cmd)) {
      throw new Error(`Viewer phải được phép chạy ${cmd}`);
    }
  }
  for (const cmd of viewerExpectedBlocked) {
    if (rbacService.canRoleExecuteCommand("viewer", cmd)) {
      throw new Error(`Viewer KHÔNG được phép chạy ${cmd}`);
    }
  }
  console.log("✓ Viewer: Phân quyền chính xác (Chỉ xem báo cáo, status, audit; chặn hire, do, goal, settings, stop).");

  // 4. Kiểm tra quyền mặc định của Operator
  const operatorExpectedAllowed = ["/report", "/do @marketing Write blog", "/status", "/knowledge", "/security", "Tự nhiên tạo task"];
  const operatorExpectedBlocked = ["/hire", "/goal", "/settings", "/audit", "/stop"];

  for (const cmd of operatorExpectedAllowed) {
    if (!rbacService.canRoleExecuteCommand("operator", cmd)) {
      throw new Error(`Operator phải được phép chạy ${cmd}`);
    }
  }
  for (const cmd of operatorExpectedBlocked) {
    if (rbacService.canRoleExecuteCommand("operator", cmd)) {
      throw new Error(`Operator KHÔNG được phép chạy ${cmd}`);
    }
  }
  console.log("✓ Operator: Phân quyền chính xác (Cho phép giao việc /do, xem report, status, tra cứu; chặn hire, goal, settings, audit, stop).");

  // 5. Kiểm tra quyền mặc định của Manager
  const managerExpectedAllowed = ["/hire", "/report", "/do @tech fix bug", "/goal", "/status", "/knowledge", "/audit", "/security"];
  const managerExpectedBlocked = ["/settings", "/stop"];

  for (const cmd of managerExpectedAllowed) {
    if (!rbacService.canRoleExecuteCommand("manager", cmd)) {
      throw new Error(`Manager phải được phép chạy ${cmd}`);
    }
  }
  for (const cmd of managerExpectedBlocked) {
    if (rbacService.canRoleExecuteCommand("manager", cmd)) {
      throw new Error(`Manager mặc định KHÔNG được phép chạy ${cmd}`);
    }
  }
  console.log("✓ Manager: Phân quyền chính xác (Được tuyển dụng /hire, giao việc, duyệt goal; mặc định chặn /settings và /stop).");

  // 6. Kiểm tra chức năng cập nhật ma trận (Founder cấp quyền /stop cho Manager)
  console.log("Đang kiểm tra cập nhật ma trận: Cấp quyền /stop cho Manager...");
  await rbacService.updatePermissionsMatrix({
    commandPermissions: {
      manager: {
        stop: true,
      },
    },
  });

  if (!rbacService.canRoleExecuteCommand("manager", "/stop")) {
    throw new Error("Manager phải được phép chạy /stop sau khi được Founder cấp quyền");
  }
  console.log("✓ Cập nhật ma trận thành công: Manager đã được cấp quyền /stop.");

  // 7. Kiểm tra khôi phục ma trận về mặc định (resetToDefaults)
  console.log("Đang kiểm tra resetToDefaults...");
  await rbacService.resetToDefaults();

  if (rbacService.canRoleExecuteCommand("manager", "/stop")) {
    throw new Error("Manager phải bị chặn /stop sau khi resetToDefaults");
  }
  console.log("✓ Khôi phục mặc định thành công: Quyền /stop của Manager đã quay về trạng thái mặc định (chặn).");

  console.log("\n=======================================================");
  console.log("🎉 TẤT CẢ 7/7 ASSERTIONS KIỂM THỬ RBAC COMMANDS ĐÃ PASS 100%!");
  console.log("=======================================================\n");
}

runTests().catch((err) => {
  console.error("❌ Test thất bại:", err);
  process.exit(1);
});
