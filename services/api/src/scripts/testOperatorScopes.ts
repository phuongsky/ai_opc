import { rbacService } from "../modules/rbac/rbacService";

async function main() {
  console.log("=== KIỂM THỬ PHÂN QUYỀN OPERATOR CHỈ ĐƯỢC XEM AGENT_HOTEL ===");

  const matrix = await rbacService.getPermissionsMatrix();
  const allKnownAgentIds = Object.keys(matrix.agentPermissions.founder);
  
  const operatorPerms: Record<string, { canView: boolean; canControl: boolean }> = {};
  for (const id of allKnownAgentIds) {
    operatorPerms[id] = id === "agent_hotel" 
      ? { canView: true, canControl: false }
      : { canView: false, canControl: false };
  }

  // Cấu hình Operator chỉ có quyền Xem duy nhất cho agent_hotel
  await rbacService.updatePermissionsMatrix({
    agentPermissions: {
      operator: operatorPerms,
    },
  });

  const allowedAgentIds = await rbacService.getAllowedAgentIdsForRole("operator");
  console.log("Allowed agents for Operator:", allowedAgentIds);

  const canViewHotel = await rbacService.canRoleViewAgent("operator", "agent_hotel");
  const canControlHotel = await rbacService.canRoleControlAgent("operator", "agent_hotel");
  const canViewCoo = await rbacService.canRoleViewAgent("operator", "ai_coo");
  const canViewSales = await rbacService.canRoleViewAgent("operator", "agent_sales");

  console.log("Operator -> agent_hotel canView:", canViewHotel);
  console.log("Operator -> agent_hotel canControl:", canControlHotel);
  console.log("Operator -> ai_coo canView:", canViewCoo);
  console.log("Operator -> agent_sales canView:", canViewSales);

  if (!canViewHotel || canControlHotel || canViewCoo || canViewSales) {
    throw new Error("Lỗi logic phân quyền Operator!");
  }

  if (allowedAgentIds.length !== 1 || allowedAgentIds[0] !== "agent_hotel") {
    throw new Error(`Kỳ vọng allowedAgentIds chỉ có ['agent_hotel'], nhưng nhận: ${JSON.stringify(allowedAgentIds)}`);
  }

  console.log("✅ XÁC NHẬN: Operator CHỈ CÓ THỂ XEM agent_hotel, hoàn toàn bị chặn với tất cả Agent và Task khác!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
