/**
 * Seed dữ liệu MVP: AI-COO + 5 Department Agent tối thiểu (Rulebook mục 47),
 * cùng vài Tool mẫu với risk level khác nhau để test Permission Matrix.
 * Chạy: tsx src/db/seed.ts
 *
 * Note: dùng upsert thay vì createMany+skipDuplicates vì SQLite không hỗ trợ skipDuplicates.
 */
import { db } from "./client";

const departments = [
  { id: "dept_sales", name: "Sales" },
  { id: "dept_marketing", name: "Marketing" },
  { id: "dept_product", name: "Product" },
  { id: "dept_tech", name: "Engineering" },
  { id: "dept_finance", name: "Finance" },
];

const agents = [
  {
    id: "ai_coo",
    name: "AI-COO",
    title: "Chief Operating Officer",
    mission: "Điều phối toàn bộ công ty, phân rã /goal của Founder thành sub-task.",
    autonomyLevel: 3,
    departmentId: null as string | null,
    reportsTo: null as string | null,
  },
  {
    id: "agent_sales",
    name: "AI-Sales",
    title: "Sales Lead",
    departmentId: "dept_sales",
    reportsTo: "ai_coo",
    mission: "Tìm lead, quản lý pipeline, soạn báo giá.",
    autonomyLevel: 2,
  },
  {
    id: "agent_marketing",
    name: "AI-Marketing",
    title: "Marketing Lead",
    departmentId: "dept_marketing",
    reportsTo: "ai_coo",
    mission: "Content, SEO, quảng cáo.",
    autonomyLevel: 2,
  },
  {
    id: "agent_product",
    name: "AI-Product",
    title: "Product Lead",
    departmentId: "dept_product",
    reportsTo: "ai_coo",
    mission: "Phân tích sản phẩm, roadmap, tài liệu.",
    autonomyLevel: 2,
  },
  {
    id: "agent_tech",
    name: "AI-Tech",
    title: "Engineering Lead",
    departmentId: "dept_tech",
    reportsTo: "ai_coo",
    mission: "Viết code, review, vận hành hệ thống.",
    autonomyLevel: 2,
  },
  {
    id: "agent_finance",
    name: "AI-Finance",
    title: "Finance Lead",
    departmentId: "dept_finance",
    reportsTo: "ai_coo",
    mission: "Theo dõi thu chi, báo cáo tài chính.",
    autonomyLevel: 1,
  },
];

const tools = [
  { id: "tool_web_search", name: "Web Search", riskLevel: "R0", requiresApproval: false },
  { id: "tool_db_read", name: "Database Read (SELECT)", riskLevel: "R1", requiresApproval: false },
  { id: "tool_send_email", name: "Send Email", riskLevel: "R2", requiresApproval: false },
  { id: "tool_db_write", name: "Database Write", riskLevel: "R3", requiresApproval: true },
  { id: "tool_deploy_prod", name: "Deploy Production", riskLevel: "R4", requiresApproval: true },
  { id: "tool_bank_transfer", name: "Bank Transfer", riskLevel: "R4", requiresApproval: true },
];

const agentToolPermissions = [
  { agentId: "agent_sales", toolId: "tool_web_search", permissionLevel: "L2" },
  { agentId: "agent_sales", toolId: "tool_send_email", permissionLevel: "L4" },
  { agentId: "agent_tech", toolId: "tool_db_read", permissionLevel: "L2" },
  { agentId: "agent_tech", toolId: "tool_db_write", permissionLevel: "L5" },
  { agentId: "agent_tech", toolId: "tool_deploy_prod", permissionLevel: "L6" },
  { agentId: "agent_finance", toolId: "tool_bank_transfer", permissionLevel: "L6" },
];

async function main() {
  // Upsert departments
  for (const dept of departments) {
    await db.department.upsert({
      where: { id: dept.id },
      update: { name: dept.name },
      create: dept,
    });
  }

  // Upsert agents
  for (const agent of agents) {
    await db.agent.upsert({
      where: { id: agent.id },
      update: {
        name: agent.name,
        title: agent.title,
        mission: agent.mission,
        autonomyLevel: agent.autonomyLevel,
      },
      create: agent,
    });
  }

  // Upsert tools
  for (const tool of tools) {
    await db.tool.upsert({
      where: { id: tool.id },
      update: { name: tool.name, riskLevel: tool.riskLevel, requiresApproval: tool.requiresApproval },
      create: tool,
    });
  }

  // Upsert agent-tool permissions
  for (const perm of agentToolPermissions) {
    await db.agentToolPermission.upsert({
      where: { agentId_toolId: { agentId: perm.agentId, toolId: perm.toolId } },
      update: { permissionLevel: perm.permissionLevel },
      create: perm,
    });
  }

  // eslint-disable-next-line no-console
  console.log("Seed hoàn tất: AI-COO + 5 Department Agent + 6 Tool mẫu.");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => db.$disconnect());
