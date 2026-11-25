import { rbacService } from "../modules/rbac/rbacService";
import { parseFounderCommand, dispatchFounderCommand } from "../modules/commands/commandParser";
import type { RbacRoleId } from "@ai-opc/shared";

// Giả lập router logic để test middleware logic của commands.route.ts
async function simulatePostCommand(role: RbacRoleId, command: string) {
  const allowed = rbacService.canRoleExecuteCommand(role, command);
  if (!allowed) {
    return {
      status: 403,
      error: `Tài khoản với vai trò '${role}' không có quyền thực thi lệnh '${command.trim()}'. Vui lòng liên hệ Founder để được cấp quyền trong RBAC Matrix.`,
    };
  }
  const parsed = parseFounderCommand(command);
  const result = await dispatchFounderCommand(parsed);
  return { status: 200, result };
}

async function runRouteTests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ ROUTE COMMANDS RBAC END-TO-END ===");

  // 1. Operator gọi /status -> Cho phép (200)
  const res1 = await simulatePostCommand("operator", "/status");
  if (res1.status !== 200) {
    throw new Error(`Operator phải được phép chạy /status, nhưng bị trả về: ${res1.status}`);
  }
  console.log("✓ Operator gọi /status -> 200 OK.");

  // 2. Operator gọi /stop -> Bị chặn 403 Forbidden
  const res2 = await simulatePostCommand("operator", "/stop");
  if (res2.status !== 403) {
    throw new Error(`Operator gọi /stop phải bị chặn 403, nhưng nhận được: ${res2.status}`);
  }
  console.log(`✓ Operator gọi /stop -> 403 Forbidden: "${res2.error}"`);

  // 3. Operator gọi /settings -> Bị chặn 403 Forbidden
  const res3 = await simulatePostCommand("operator", "/settings");
  if (res3.status !== 403) {
    throw new Error(`Operator gọi /settings phải bị chặn 403, nhưng nhận được: ${res3.status}`);
  }
  console.log(`✓ Operator gọi /settings -> 403 Forbidden: "${res3.error}"`);

  // 4. Viewer gọi /do -> Bị chặn 403 Forbidden
  const res4 = await simulatePostCommand("viewer", "/do @marketing Write blog");
  if (res4.status !== 403) {
    throw new Error(`Viewer gọi /do phải bị chặn 403, nhưng nhận được: ${res4.status}`);
  }
  console.log(`✓ Viewer gọi /do -> 403 Forbidden: "${res4.error}"`);

  // 5. Founder gọi /stop -> Cho phép (200)
  const res5 = await simulatePostCommand("founder", "/stop");
  if (res5.status !== 200) {
    throw new Error(`Founder gọi /stop phải được 200, nhưng nhận được: ${res5.status}`);
  }
  console.log("✓ Founder gọi /stop -> 200 OK (Emergency stop thành công).");

  console.log("\n=======================================================");
  console.log("🎉 TẤT CẢ 5/5 ROUTE ASSERTIONS ĐÃ PASS 100%!");
  console.log("=======================================================\n");
}

runRouteTests().catch((err) => {
  console.error("❌ Test route thất bại:", err);
  process.exit(1);
});
