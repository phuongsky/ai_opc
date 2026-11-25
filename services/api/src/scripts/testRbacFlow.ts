import { rbacService, RBAC_ROLES, RBAC_MODULES, DEFAULT_RBAC_PERMISSIONS } from "../modules/rbac/rbacService";

async function main() {
  console.log("=== TEST RBAC PERMISSIONS & AGENT SCOPES FLOW ===");

  // 1. Test getPermissionsMatrix
  console.log("1. Kiểm tra getPermissionsMatrix():");
  const matrix1 = await rbacService.getPermissionsMatrix();
  console.log(`✓ Roles count: ${matrix1.roles.length} (kỳ vọng: 4)`);
  console.log(`✓ Modules count: ${matrix1.modules.length} (kỳ vọng: 7)`);
  console.log("✓ Founder full perms:", Object.values(matrix1.permissions.founder).every(Boolean));
  console.log("✓ Manager cockpit_kanban:", matrix1.permissions.manager.cockpit_kanban);
  console.log("✓ Manager company_settings:", matrix1.permissions.manager.company_settings);
  console.log("✓ Founder Agent ai_coo:", matrix1.agentPermissions.founder.ai_coo);
  console.log("✓ Operator Agent agent_sales:", matrix1.agentPermissions.operator.agent_sales);
  console.log("✓ Viewer Agent agent_tech:", matrix1.agentPermissions.viewer.agent_tech);

  // 2. Test updatePermissionsMatrix
  console.log("\n2. Kiểm tra updatePermissionsMatrix():");
  const updated = await rbacService.updatePermissionsMatrix({
    permissions: {
      founder: { company_settings: false } as any, // Cố tình tắt founder -> rbacService phải giữ true
      manager: { company_settings: true },
      viewer: { knowledge_lookups: true },
    },
    agentPermissions: {
      founder: { agent_tech: { canView: false, canControl: false } } as any, // Cố tình tắt founder agent -> giữ true
      operator: {
        agent_tech: { canView: true, canControl: true },
        agent_sales: { canView: false, canControl: false },
      },
      viewer: {
        agent_sales: { canView: false, canControl: false },
      },
    },
  });
  console.log("✓ Founder company_settings sau khi cố tắt (bảo vệ an toàn):", updated.permissions.founder.company_settings);
  console.log("✓ Founder agent_tech sau khi cố tắt (bảo vệ an toàn):", updated.agentPermissions.founder.agent_tech);
  console.log("✓ Manager company_settings sau khi cấp:", updated.permissions.manager.company_settings);
  console.log("✓ Viewer knowledge_lookups sau khi cấp:", updated.permissions.viewer.knowledge_lookups);
  console.log("✓ Operator agent_tech sau khi cấp quyền điều khiển:", updated.agentPermissions.operator.agent_tech);
  console.log("✓ Operator agent_sales sau khi bỏ quyền:", updated.agentPermissions.operator.agent_sales);

  if (updated.permissions.founder.company_settings !== true) {
    throw new Error("Lỗi: Founder role bị tắt quyền trái quy tắc an toàn!");
  }
  if (updated.agentPermissions.founder.agent_tech.canControl !== true) {
    throw new Error("Lỗi: Founder agent permissions bị tắt trái quy tắc an toàn!");
  }
  if (updated.agentPermissions.operator.agent_tech.canControl !== true) {
    throw new Error("Lỗi: Operator chưa được cấp quyền điều khiển agent_tech!");
  }

  // 3. Test resetToDefaults
  console.log("\n3. Kiểm tra resetToDefaults():");
  const restored = await rbacService.resetToDefaults();
  console.log("✓ Manager company_settings sau khi reset:", restored.permissions.manager.company_settings);
  console.log("✓ Operator agent_tech canControl sau khi reset:", restored.agentPermissions.operator.agent_tech.canControl);

  if (restored.permissions.manager.company_settings !== false) {
    throw new Error("Lỗi: Manager không được reset về mặc định false!");
  }

  console.log("\n🎉 TẤT CẢ KIỂM THỬ RBAC MODULES & AGENT SCOPES HOÀN THÀNH XUẤT SẮC!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
