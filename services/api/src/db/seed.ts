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
  {
    id: "agent_sunright_hotel",
    name: "Sunright_hotel",
    title: "Hotel Operations Lead",
    departmentId: "dept_product",
    reportsTo: "ai_coo",
    mission: "Quản lý đặt phòng và dữ liệu phòng của khách sạn Sunright qua database hotel_dbs (Intelio_Sunset) — tra cứu phòng trống (tbl_Rooms, tbl_RoomTypes), tạo/sửa booking cho khách (tbl_Reservations, tbl_Guests, tbl_DepositPayment).",
    autonomyLevel: 2,
  },
  {
    id: "agent_hotel",
    name: "AI-Hotel",
    title: "Hotel Operations Specialist",
    departmentId: "dept_product",
    reportsTo: "ai_coo",
    mission: "Quản lý đặt phòng, lưu trú, check-in, check-out và dữ liệu khách sạn Sunright qua database Intelio_Sunset.",
    autonomyLevel: 2,
  },
];

const tools = [
  { id: "tool_web_search", name: "Web Search", riskLevel: "R0", requiresApproval: false },
  { id: "tool_db_read", name: "Database Read (SELECT)", riskLevel: "R1", requiresApproval: false },
  { id: "tool_send_email", name: "Send Email", riskLevel: "R2", requiresApproval: false },
  { id: "tool_db_write", name: "Database Write", riskLevel: "R3", requiresApproval: true },
  { id: "tool_deploy_prod", name: "Deploy Production", riskLevel: "R4", requiresApproval: true },
  { id: "tool_bank_transfer", name: "Bank Transfer", riskLevel: "R4", requiresApproval: true },
  {
    id: "tool_hotel_dbs_describe_schema",
    name: "Hotel Sunright — Xem cấu trúc DB",
    description: "Tra cứu toàn bộ danh sách bảng và cột của database khách sạn Intelio_Sunset. Params: {}",
    riskLevel: "R0",
    requiresApproval: false,
  },
  {
    id: "tool_hotel_dbs_read",
    name: "Hotel Sunright — Đọc dữ liệu",
    description:
      'Params JSON: {"table":"tbl_Reservations"|"tbl_Rooms"|"tbl_Guests"|"tbl_RoomTypes"|"tbl_DepositPayment","where":{...},"limit":1000,"operation":"select"|"count"|"aggregate"}. ' +
      'Bảng "tbl_Reservations" (đơn đặt phòng): ID, ResCode, GuestID, RoomID, RoomNo, FromDate (ngày đến YYYYMMDD), ToDate (ngày đi YYYYMMDD), ArrivalDate, DepartureDate, Nights, NoAdults, NoChildren, NightRate, TotalRate, DepositPaid, TotalDue, Status (1: Đang ở, 2: Đã xác nhận, 3: Đặt cọc, 4: Giữ chỗ, 5: Đã trả phòng/hoàn tất), Note. ' +
      'Bảng "tbl_Rooms" (phòng): ID, RoomNo, RoomTypeID, Floor, POSType, Cost, RoomAddress, GuestStatus, StartTime, EndTime. ' +
      'Bảng "tbl_RoomTypes" (loại phòng): ID, Code, Name, OTACode. ' +
      'Bảng "tbl_Guests" (khách hàng): ID, Code, FirstName, LastName, Gender, IdentifyNo, Address, Phone, Mobile, Mail, NationalityID, BirthDay, Note. ' +
      'Ví dụ thống kê đặt phòng tháng 9/2026: {"table":"tbl_Reservations","where":{"FromDate":"2026-09"},"limit":1000}',
    riskLevel: "R1",
    requiresApproval: false,
  },
  {
    id: "tool_hotel_dbs_write",
    name: "Hotel Sunright — Tạo/sửa booking",
    description:
      'Params JSON — TẠO booking mới: {"table":"tbl_Reservations","operation":"insert","data":{"ResCode":"...","GuestID":"...","RoomNo":101,"FromDate":20260925,"ToDate":20260927,"Nights":2,"NoAdults":1,"NightRate":1500000,"Status":1,"Note":"..."}}. ' +
      'SỬA booking đã có: {"table":"tbl_Reservations","operation":"update","where":{"ResCode":"51106"},"data":{"Status":2}} ' +
      '— "where" BẮT BUỘC khi update. Thao tác được trên các bảng: tbl_Reservations, tbl_Guests, tbl_DepositPayment (yêu cầu Founder duyệt).',
    riskLevel: "R3",
    requiresApproval: true,
  },
  {
    id: "tool_hotel_sunright_describe_schema",
    name: "Hotel Sunright — Schema Alias",
    description: "Tra cứu cấu trúc bảng database Intelio_Sunset",
    riskLevel: "R0",
    requiresApproval: false,
  },
  {
    id: "tool_hotel_sunright_read",
    name: "Hotel Sunright — Đọc dữ liệu Alias",
    description: "Đọc dữ liệu database Intelio_Sunset",
    riskLevel: "R1",
    requiresApproval: false,
  },
  {
    id: "tool_hotel_sunright_write",
    name: "Hotel Sunright — Ghi dữ liệu Alias",
    description: "Tạo hoặc cập nhật booking database Intelio_Sunset",
    riskLevel: "R3",
    requiresApproval: true,
  },
];

const agentToolPermissions = [
  { agentId: "agent_sales", toolId: "tool_web_search", permissionLevel: "L2" },
  { agentId: "agent_sales", toolId: "tool_send_email", permissionLevel: "L4" },
  { agentId: "agent_sales", toolId: "tool_hotel_dbs_read", permissionLevel: "L2" },
  { agentId: "agent_sales", toolId: "tool_hotel_dbs_write", permissionLevel: "L4" },
  { agentId: "agent_sales", toolId: "tool_hotel_sunright_read", permissionLevel: "L2" },
  { agentId: "agent_sales", toolId: "tool_hotel_sunright_write", permissionLevel: "L4" },
  { agentId: "agent_tech", toolId: "tool_db_read", permissionLevel: "L2" },
  { agentId: "agent_tech", toolId: "tool_db_write", permissionLevel: "L5" },
  { agentId: "agent_finance", toolId: "tool_bank_transfer", permissionLevel: "L6" },
  { agentId: "agent_finance", toolId: "tool_db_read", permissionLevel: "L2" },
  { agentId: "agent_finance", toolId: "tool_hotel_dbs_read", permissionLevel: "L2" },
  { agentId: "agent_finance", toolId: "tool_hotel_sunright_read", permissionLevel: "L2" },
  { agentId: "agent_finance", toolId: "tool_hotel_dbs_describe_schema", permissionLevel: "L1" },
  { agentId: "agent_sunright_hotel", toolId: "tool_hotel_dbs_read", permissionLevel: "L2" },
  { agentId: "agent_sunright_hotel", toolId: "tool_hotel_dbs_write", permissionLevel: "L4" },
  { agentId: "agent_sunright_hotel", toolId: "tool_hotel_sunright_describe_schema", permissionLevel: "L1" },
  { agentId: "agent_sunright_hotel", toolId: "tool_hotel_sunright_read", permissionLevel: "L2" },
  { agentId: "agent_sunright_hotel", toolId: "tool_hotel_sunright_write", permissionLevel: "L4" },
  { agentId: "agent_hotel", toolId: "tool_hotel_dbs_describe_schema", permissionLevel: "L1" },
  { agentId: "agent_hotel", toolId: "tool_hotel_dbs_read", permissionLevel: "L2" },
  { agentId: "agent_hotel", toolId: "tool_hotel_dbs_write", permissionLevel: "L4" },
  { agentId: "agent_hotel", toolId: "tool_hotel_sunright_describe_schema", permissionLevel: "L1" },
  { agentId: "agent_hotel", toolId: "tool_hotel_sunright_read", permissionLevel: "L2" },
  { agentId: "agent_hotel", toolId: "tool_hotel_sunright_write", permissionLevel: "L4" },
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
      update: {
        name: tool.name,
        description: (tool as any).description ?? null,
        riskLevel: tool.riskLevel,
        requiresApproval: tool.requiresApproval,
      },
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
