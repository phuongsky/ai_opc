import fs from "fs";
import path from "path";
import { db } from "../../db/client";
import { resolveDataDir } from "../../config/env";
import { getAccountRoleByEmail } from "../auth/accountService";
import type { AuthedRequest } from "../../middleware/requireAuth";
import type {
  RbacRoleId,
  RbacModuleId,
  RbacCommandId,
  RbacRoleDefinition,
  RbacModuleDefinition,
  RbacCommandDefinition,
  RbacAgentPermission,
  RbacPermissionsMatrix,
} from "@ai-opc/shared";

export const RBAC_ROLES: RbacRoleDefinition[] = [
  {
    id: "founder",
    name: "Founder / Super Admin",
    nameVi: "Founder / Quản trị tối cao",
    description: "Toàn quyền điều hành và quản trị hệ thống AI-OPC",
    descriptionVi: "Toàn quyền điều hành và quản trị hệ thống AI-OPC",
    badge: "Super Admin",
    isImmutableAdmin: true,
  },
  {
    id: "manager",
    name: "Department Manager",
    nameVi: "Trưởng phòng ban điều hành",
    description: "Quản trị Agent, phân công nhiệm vụ và duyệt quyết định theo thẩm quyền",
    descriptionVi: "Quản trị Agent, phân công nhiệm vụ và duyệt quyết định theo thẩm quyền",
    badge: "Manager",
  },
  {
    id: "operator",
    name: "Operator / Staff",
    nameVi: "Nhân viên vận hành tác vụ",
    description: "Tạo task mới, cập nhật tiến độ công việc và tra cứu tri thức",
    descriptionVi: "Tạo task mới, cập nhật tiến độ công việc và tra cứu tri thức",
    badge: "Staff",
  },
  {
    id: "viewer",
    name: "Viewer / Auditor",
    nameVi: "Người xem / Kiểm toán viên",
    description: "Chỉ xem tổng quan điều hành và tra cứu nhật ký kiểm toán",
    descriptionVi: "Chỉ xem tổng quan điều hành và tra cứu nhật ký kiểm toán",
    badge: "Auditor",
  },
];

export const RBAC_MODULES: RbacModuleDefinition[] = [
  {
    id: "cockpit_kanban",
    name: "Cockpit & Task Kanban",
    nameVi: "Điều hành Cockpit & Task Kanban",
    description: "Xem bảng Kanban, tạo task, kéo thả cập nhật tiến độ công việc",
    descriptionVi: "Xem bảng Kanban, tạo task, kéo thả cập nhật tiến độ công việc",
    category: "operations",
  },
  {
    id: "agent_management",
    name: "AI Agents & Tooling",
    nameVi: "Quản trị AI Agents & Tooling",
    description: "Tuyển dụng, sa thải, cấu hình Mission, trần ngân sách riêng và phân quyền Tool",
    descriptionVi: "Tuyển dụng, sa thải, cấu hình Mission, trần ngân sách riêng và phân quyền Tool",
    category: "operations",
  },
  {
    id: "decision_approval",
    name: "Decision Approval (R3/R4)",
    nameVi: "Phê duyệt Quyết định (R3/R4)",
    description: "Phê duyệt (Approve) hoặc Từ chối (Reject) hành động nhạy cảm của Agent",
    descriptionVi: "Phê duyệt (Approve) hoặc Từ chối (Reject) hành động nhạy cảm của Agent",
    category: "governance",
  },
  {
    id: "knowledge_lookups",
    name: "Knowledge Base & Lookups",
    nameVi: "Cơ sở Tri thức & Từ điển quy ước",
    description: "Quản lý tài liệu SOP doanh nghiệp và cấu hình từ điển chuyển đổi số liệu",
    descriptionVi: "Quản lý tài liệu SOP doanh nghiệp và cấu hình từ điển chuyển đổi số liệu",
    category: "operations",
  },
  {
    id: "company_settings",
    name: "System Settings & AI Gateway",
    nameVi: "Cài đặt Hệ thống & AI Gateway (/settings)",
    description: "Cấu hình AI Gateway, API Keys, trần ngân sách công ty và kênh thông báo",
    descriptionVi: "Cấu hình AI Gateway, API Keys, trần ngân sách công ty và kênh thông báo",
    category: "governance",
  },
  {
    id: "audit_console_logs",
    name: "Audit Logs & System Console",
    nameVi: "Nhật ký Kiểm toán & Console Logs",
    description: "Xem lịch sử kiểm toán gọi tool, giám sát luồng log real-time và xuất báo cáo",
    descriptionVi: "Xem lịch sử kiểm toán gọi tool, giám sát luồng log real-time và xuất báo cáo",
    category: "infrastructure",
  },
  {
    id: "security_2fa",
    name: "Security & 2FA Auth",
    nameVi: "Bảo mật & Xác thực 2FA",
    description: "Cấu hình mã 2FA TOTP bảo mật tài khoản và quản lý thông tin bảo mật",
    descriptionVi: "Cấu hình mã 2FA TOTP bảo mật tài khoản và quản lý thông tin bảo mật",
    category: "infrastructure",
  },
];

export const DEFAULT_RBAC_PERMISSIONS: Record<RbacRoleId, Record<RbacModuleId, boolean>> = {
  founder: {
    cockpit_kanban: true,
    agent_management: true,
    decision_approval: true,
    knowledge_lookups: true,
    company_settings: true,
    audit_console_logs: true,
    security_2fa: true,
  },
  manager: {
    cockpit_kanban: true,
    agent_management: true,
    decision_approval: true,
    knowledge_lookups: true,
    company_settings: false,
    audit_console_logs: true,
    security_2fa: true,
  },
  operator: {
    cockpit_kanban: true,
    agent_management: false,
    decision_approval: false,
    knowledge_lookups: true,
    company_settings: false,
    audit_console_logs: false,
    security_2fa: true,
  },
  viewer: {
    cockpit_kanban: true,
    agent_management: false,
    decision_approval: false,
    knowledge_lookups: false,
    company_settings: false,
    audit_console_logs: true,
    security_2fa: false,
  },
};

export const RBAC_COMMANDS: RbacCommandDefinition[] = [
  {
    id: "hire",
    command: "/hire",
    prefix: "/hire",
    name: "Hire New AI Agent",
    nameVi: "Tuyển dụng AI Agent mới (/hire)",
    description: "Khởi tạo và tuyển dụng Agent mới vào bộ máy công ty (/agents/new)",
    descriptionVi: "Khởi tạo và tuyển dụng Agent mới vào bộ máy công ty (/agents/new)",
    isNav: true,
    category: "navigation",
  },
  {
    id: "report",
    command: "/report",
    prefix: "/report",
    name: "Weekly / Executive Report",
    nameVi: "Báo cáo điều hành tổng hợp (/report)",
    description: "Xuất báo cáo tổng quan đa chiều, số lượng task và chi phí vận hành",
    descriptionVi: "Xuất báo cáo tổng quan đa chiều, số lượng task và chi phí vận hành",
    category: "dispatch",
  },
  {
    id: "do",
    command: "/do",
    prefix: "/do",
    name: "Direct Task Dispatch",
    nameVi: "Giao việc trực tiếp cho Agent (/do)",
    description: "Giao thẳng nhiệm vụ cho Agent chuyên môn (@marketing, @tech, hotel...)",
    descriptionVi: "Giao thẳng nhiệm vụ cho Agent chuyên môn (@marketing, @tech, hotel...)",
    category: "dispatch",
  },
  {
    id: "goal",
    command: "/goal",
    prefix: "/goal",
    name: "Strategic Goal Assignment",
    nameVi: "Giao mục tiêu chiến lược cho COO (/goal)",
    description: "Giao mục tiêu cấp cao cho AI-COO tự động lập kế hoạch và phân rã task",
    descriptionVi: "Giao mục tiêu cấp cao cho AI-COO tự động lập kế hoạch và phân rã task",
    category: "dispatch",
  },
  {
    id: "status",
    command: "/status",
    prefix: "/status",
    name: "Company Progress & Health",
    nameVi: "Xem tiến độ & chi phí công ty (/status)",
    description: "Truy vấn nhanh tình trạng hoạt động của các Agent, task đang chạy và ngân sách",
    descriptionVi: "Truy vấn nhanh tình trạng hoạt động của các Agent, task đang chạy và ngân sách",
    category: "dispatch",
  },
  {
    id: "settings",
    command: "/settings",
    prefix: "/settings",
    name: "Company Settings & Guardrails",
    nameVi: "Cài đặt công ty & Ngân sách (/settings)",
    description: "Truy cập cấu hình hệ thống, AI Gateway, hạn mức ngân sách và kênh thông báo",
    descriptionVi: "Truy cập cấu hình hệ thống, AI Gateway, hạn mức ngân sách và kênh thông báo",
    isNav: true,
    category: "navigation",
  },
  {
    id: "knowledge",
    command: "/knowledge",
    prefix: "/knowledge",
    name: "Company Knowledge Base & SOPs",
    nameVi: "Cơ sở Tri thức & Bộ nhớ AI (/knowledge)",
    description: "Truy cập kho tài liệu SOP, tri thức doanh nghiệp và bộ nhớ dài hạn",
    descriptionVi: "Truy cập kho tài liệu SOP, tri thức doanh nghiệp và bộ nhớ dài hạn",
    isNav: true,
    category: "navigation",
  },
  {
    id: "audit",
    command: "/audit",
    prefix: "/audit",
    name: "Audit Log & AI Trace",
    nameVi: "Nhật ký kiểm toán AI (/audit)",
    description: "Truy vết chi tiết mọi hành vi, lượt gọi tool và log thực thi của Agent",
    descriptionVi: "Truy vết chi tiết mọi hành vi, lượt gọi tool và log thực thi của Agent",
    isNav: true,
    category: "navigation",
  },
  {
    id: "security",
    command: "/security",
    prefix: "/security",
    name: "Account Security & 2FA",
    nameVi: "Bảo mật tài khoản & 2FA (/security)",
    description: "Quản lý bảo mật đăng nhập, mã xác thực hai lớp TOTP 2FA",
    descriptionVi: "Quản lý bảo mật đăng nhập, mã xác thực hai lớp TOTP 2FA",
    isNav: true,
    category: "navigation",
  },
  {
    id: "stop",
    command: "/stop",
    prefix: "/stop",
    name: "Emergency Stop (Rule 12)",
    nameVi: "DỪNG KHẨN CẤP toàn bộ Agent (/stop)",
    description: "Lệnh dừng khẩn cấp toàn bộ các AI Agent đang chạy khi có sự cố nghiêm trọng",
    descriptionVi: "Lệnh dừng khẩn cấp toàn bộ các AI Agent đang chạy khi có sự cố nghiêm trọng",
    danger: true,
    category: "governance",
  },
  {
    id: "plan",
    command: "/plan",
    prefix: "/plan",
    name: "AI Planning Mode",
    nameVi: "Lập kế hoạch hành động (/plan)",
    description: "Kích hoạt AI nghiên cứu và phác thảo kế hoạch chi tiết",
    descriptionVi: "Kích hoạt AI nghiên cứu và phác thảo kế hoạch chi tiết",
    category: "dispatch",
  },
  {
    id: "analyze",
    command: "/analyze",
    prefix: "/analyze",
    name: "Deep Business Analytics",
    nameVi: "Phân tích dữ liệu chuyên sâu (/analyze)",
    description: "Phân tích số liệu kinh doanh, doanh thu phòng hoặc hiệu suất",
    descriptionVi: "Phân tích số liệu kinh doanh, doanh thu phòng hoặc hiệu suất",
    category: "dispatch",
  },
];

export const DEFAULT_RBAC_COMMAND_PERMISSIONS: Record<RbacRoleId, Record<RbacCommandId, boolean>> = {
  founder: {
    hire: true,
    report: true,
    do: true,
    goal: true,
    status: true,
    settings: true,
    knowledge: true,
    audit: true,
    security: true,
    stop: true,
    plan: true,
    analyze: true,
  },
  manager: {
    hire: true,
    report: true,
    do: true,
    goal: true,
    status: true,
    settings: false,
    knowledge: true,
    audit: true,
    security: true,
    stop: false,
    plan: true,
    analyze: true,
  },
  operator: {
    hire: false,
    report: true,
    do: true,
    goal: false,
    status: true,
    settings: false,
    knowledge: true,
    audit: false,
    security: true,
    stop: false,
    plan: false,
    analyze: false,
  },
  viewer: {
    hire: false,
    report: true,
    do: false,
    goal: false,
    status: true,
    settings: false,
    knowledge: false,
    audit: true,
    security: false,
    stop: false,
    plan: false,
    analyze: false,
  },
};

const DEFAULT_KNOWN_AGENTS = [
  "ai_coo",
  "agent_sales",
  "agent_marketing",
  "agent_product",
  "agent_tech",
  "agent_finance",
  "agent_sunright_hotel",
  "agent_create_video_ai",
];

function getRbacFilePath(): string {
  const dataDir = resolveDataDir();
  return path.join(dataDir, "rbac_matrix.json");
}

interface StoredRbacData {
  permissions: Record<RbacRoleId, Record<RbacModuleId, boolean>>;
  agentPermissions: Record<RbacRoleId, Record<string, RbacAgentPermission>>;
  commandPermissions?: Record<RbacRoleId, Record<RbacCommandId, boolean>>;
  lastUpdatedAt: string;
}

function readRbacFromFile(): StoredRbacData | null {
  const filePath = getRbacFilePath();
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.permissions && parsed.agentPermissions) {
        return parsed as StoredRbacData;
      }
    } catch (err) {
      console.warn("[rbacService] Lỗi đọc rbac_matrix.json:", err);
    }
  }
  return null;
}

function writeRbacToFile(data: StoredRbacData): void {
  const filePath = getRbacFilePath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[rbacService] Lỗi ghi rbac_matrix.json:", err);
  }
}

class RbacService {
  private inMemoryPermissions!: Record<RbacRoleId, Record<RbacModuleId, boolean>>;
  private inMemoryAgentPermissions!: Record<RbacRoleId, Record<string, RbacAgentPermission>>;
  private inMemoryCommandPermissions!: Record<RbacRoleId, Record<RbacCommandId, boolean>>;
  private lastUpdatedAt: string = new Date().toISOString();

  constructor() {
    this.loadFromDiskOrDefault();
  }

  private normalizeCommandPermissions(
    stored?: Partial<Record<RbacRoleId, Partial<Record<RbacCommandId, boolean>>>>
  ): Record<RbacRoleId, Record<RbacCommandId, boolean>> {
    const res: Record<RbacRoleId, Record<RbacCommandId, boolean>> = JSON.parse(
      JSON.stringify(DEFAULT_RBAC_COMMAND_PERMISSIONS)
    );
    if (stored) {
      for (const role of RBAC_ROLES) {
        const roleData = stored[role.id];
        if (roleData) {
          for (const cmd of RBAC_COMMANDS) {
            if (typeof roleData[cmd.id] === "boolean") {
              res[role.id][cmd.id] = roleData[cmd.id]!;
            }
          }
        }
      }
    }
    for (const cmd of RBAC_COMMANDS) {
      res.founder[cmd.id] = true;
    }
    return res;
  }

  private loadFromDiskOrDefault(): void {
    const stored = readRbacFromFile();
    if (stored) {
      this.inMemoryPermissions = stored.permissions;
      this.inMemoryAgentPermissions = stored.agentPermissions;
      this.inMemoryCommandPermissions = this.normalizeCommandPermissions(stored.commandPermissions);
      this.lastUpdatedAt = stored.lastUpdatedAt || new Date().toISOString();
    } else {
      this.inMemoryPermissions = JSON.parse(JSON.stringify(DEFAULT_RBAC_PERMISSIONS));
      this.inMemoryAgentPermissions = this.buildDefaultAgentPermissions(DEFAULT_KNOWN_AGENTS);
      this.inMemoryCommandPermissions = JSON.parse(JSON.stringify(DEFAULT_RBAC_COMMAND_PERMISSIONS));
      this.lastUpdatedAt = new Date().toISOString();
    }
  }

  private buildDefaultAgentPermissions(
    agentIds: string[]
  ): Record<RbacRoleId, Record<string, RbacAgentPermission>> {
    const res: Record<RbacRoleId, Record<string, RbacAgentPermission>> = {
      founder: {},
      manager: {},
      operator: {},
      viewer: {},
    };

    for (const id of agentIds) {
      res.founder[id] = { canView: true, canControl: true };
      res.manager[id] = { canView: true, canControl: true };
      res.operator[id] = {
        canView: true,
        canControl: ["ai_coo", "agent_sales", "agent_marketing"].includes(id),
      };
      res.viewer[id] = { canView: true, canControl: false };
    }

    return res;
  }

  private async getActiveAgentIds(): Promise<string[]> {
    try {
      const agents = await db.agent.findMany({ select: { id: true } });
      const ids = agents.map((a: { id: string }) => a.id);
      return ids.length > 0 ? ids : DEFAULT_KNOWN_AGENTS;
    } catch {
      return DEFAULT_KNOWN_AGENTS;
    }
  }

  /**
   * Lấy cấu hình ma trận phân quyền hiện hành (bao gồm cả phân hệ và AI Agent)
   */
  async getPermissionsMatrix(): Promise<RbacPermissionsMatrix> {
    if (!this.inMemoryPermissions || !this.inMemoryAgentPermissions) {
      this.loadFromDiskOrDefault();
    }

    const agentIds = await this.getActiveAgentIds();
    for (const role of RBAC_ROLES) {
      if (!this.inMemoryAgentPermissions[role.id]) {
        this.inMemoryAgentPermissions[role.id] = {};
      }
      for (const agentId of agentIds) {
        if (!this.inMemoryAgentPermissions[role.id][agentId]) {
          this.inMemoryAgentPermissions[role.id][agentId] = {
            canView: role.id !== "viewer",
            canControl: role.id === "founder" || role.id === "manager",
          };
        }
      }
    }

    // Đảm bảo Founder luôn giữ trọn bộ quyền tối cao cả phân hệ, Agent lẫn Commands
    for (const mod of RBAC_MODULES) {
      this.inMemoryPermissions.founder[mod.id] = true;
    }
    for (const agentId of agentIds) {
      this.inMemoryAgentPermissions.founder[agentId] = {
        canView: true,
        canControl: true,
      };
    }
    for (const cmd of RBAC_COMMANDS) {
      this.inMemoryCommandPermissions.founder[cmd.id] = true;
    }

    return {
      roles: RBAC_ROLES,
      modules: RBAC_MODULES,
      commands: RBAC_COMMANDS,
      permissions: this.inMemoryPermissions,
      agentPermissions: this.inMemoryAgentPermissions,
      commandPermissions: this.inMemoryCommandPermissions,
      updatedAt: this.lastUpdatedAt,
    };
  }

  /**
   * Cập nhật ma trận phân quyền mới
   */
  async updatePermissionsMatrix(
    updates: {
      permissions?: Partial<Record<RbacRoleId, Partial<Record<RbacModuleId, boolean>>>>;
      agentPermissions?: Partial<
        Record<RbacRoleId, Partial<Record<string, { canView?: boolean; canControl?: boolean }>>>
      >;
      commandPermissions?: Partial<Record<RbacRoleId, Partial<Record<RbacCommandId, boolean>>>>;
    },
    updatedBy = "FOUNDER"
  ): Promise<RbacPermissionsMatrix> {
    const current = await this.getPermissionsMatrix();
    const mergedPerms = JSON.parse(JSON.stringify(current.permissions)) as Record<
      RbacRoleId,
      Record<RbacModuleId, boolean>
    >;
    const mergedAgentPerms = JSON.parse(JSON.stringify(current.agentPermissions)) as Record<
      RbacRoleId,
      Record<string, RbacAgentPermission>
    >;
    const mergedCmdPerms = JSON.parse(JSON.stringify(current.commandPermissions)) as Record<
      RbacRoleId,
      Record<RbacCommandId, boolean>
    >;

    // 1. Cập nhật phân hệ (Modules)
    if (updates.permissions) {
      for (const role of RBAC_ROLES) {
        const rolePerms = updates.permissions[role.id];
        if (rolePerms) {
          for (const mod of RBAC_MODULES) {
            if (typeof rolePerms[mod.id] === "boolean") {
              mergedPerms[role.id][mod.id] = rolePerms[mod.id]!;
            }
          }
        }
      }
    }

    // 2. Cập nhật quyền AI Agent
    if (updates.agentPermissions) {
      for (const role of RBAC_ROLES) {
        const roleAgentPerms = updates.agentPermissions[role.id];
        if (roleAgentPerms) {
          for (const [agentId, perm] of Object.entries(roleAgentPerms)) {
            if (!mergedAgentPerms[role.id]) {
              mergedAgentPerms[role.id] = {};
            }
            const existing = mergedAgentPerms[role.id][agentId] || { canView: true, canControl: false };
            const canControl = typeof perm?.canControl === "boolean" ? perm.canControl : existing.canControl;
            // Nếu có quyền Điều khiển -> tự động bật quyền Xem
            const canView = canControl
              ? true
              : typeof perm?.canView === "boolean"
              ? perm.canView
              : existing.canView;

            mergedAgentPerms[role.id][agentId] = { canView, canControl };
          }
        }
      }
    }

    // 3. Cập nhật quyền Commands
    if (updates.commandPermissions) {
      for (const role of RBAC_ROLES) {
        const roleCmdPerms = updates.commandPermissions[role.id];
        if (roleCmdPerms) {
          for (const cmd of RBAC_COMMANDS) {
            if (typeof roleCmdPerms[cmd.id] === "boolean") {
              mergedCmdPerms[role.id][cmd.id] = roleCmdPerms[cmd.id]!;
            }
          }
        }
      }
    }

    // 4. Founder luôn luôn có full quyền
    for (const mod of RBAC_MODULES) {
      mergedPerms.founder[mod.id] = true;
    }
    const agentIds = await this.getActiveAgentIds();
    for (const agentId of agentIds) {
      mergedAgentPerms.founder[agentId] = { canView: true, canControl: true };
    }
    for (const cmd of RBAC_COMMANDS) {
      mergedCmdPerms.founder[cmd.id] = true;
    }

    this.inMemoryPermissions = mergedPerms;
    this.inMemoryAgentPermissions = mergedAgentPerms;
    this.inMemoryCommandPermissions = mergedCmdPerms;
    this.lastUpdatedAt = new Date().toISOString();

    writeRbacToFile({
      permissions: mergedPerms,
      agentPermissions: mergedAgentPerms,
      commandPermissions: mergedCmdPerms,
      lastUpdatedAt: this.lastUpdatedAt,
    });

    return {
      roles: RBAC_ROLES,
      modules: RBAC_MODULES,
      commands: RBAC_COMMANDS,
      permissions: mergedPerms,
      agentPermissions: mergedAgentPerms,
      commandPermissions: mergedCmdPerms,
      updatedAt: this.lastUpdatedAt,
      updatedBy,
    };
  }

  /**
   * Khôi phục ma trận về mặc định ban đầu
   */
  async resetToDefaults(): Promise<RbacPermissionsMatrix> {
    const agentIds = await this.getActiveAgentIds();
    this.inMemoryPermissions = JSON.parse(JSON.stringify(DEFAULT_RBAC_PERMISSIONS));
    this.inMemoryAgentPermissions = this.buildDefaultAgentPermissions(agentIds);
    this.inMemoryCommandPermissions = JSON.parse(JSON.stringify(DEFAULT_RBAC_COMMAND_PERMISSIONS));
    this.lastUpdatedAt = new Date().toISOString();

    writeRbacToFile({
      permissions: this.inMemoryPermissions,
      agentPermissions: this.inMemoryAgentPermissions,
      commandPermissions: this.inMemoryCommandPermissions,
      lastUpdatedAt: this.lastUpdatedAt,
    });

    return {
      roles: RBAC_ROLES,
      modules: RBAC_MODULES,
      commands: RBAC_COMMANDS,
      permissions: this.inMemoryPermissions,
      agentPermissions: this.inMemoryAgentPermissions,
      commandPermissions: this.inMemoryCommandPermissions,
      updatedAt: this.lastUpdatedAt,
    };
  }

  /**
   * Trích xuất vai trò RBAC từ AuthedRequest
   */
  async getUserRole(req: AuthedRequest): Promise<RbacRoleId> {
    if (req.founder?.role) {
      return req.founder.role as RbacRoleId;
    }
    if (req.founder?.email) {
      const role = await getAccountRoleByEmail(req.founder.email);
      return role;
    }
    return "operator";
  }

  /**
   * Lấy danh sách ID các AI Agent mà Role được phép Xem (canView = true)
   */
  async getAllowedAgentIdsForRole(role: RbacRoleId): Promise<string[]> {
    const allAgentIds = await this.getActiveAgentIds();
    if (role === "founder") {
      return allAgentIds;
    }
    const matrix = await this.getPermissionsMatrix();
    const perms = matrix.agentPermissions?.[role] || {};
    return allAgentIds.filter((id) => perms[id]?.canView === true);
  }

  /**
   * Kiểm tra xem Role có quyền Xem (canView) một AI Agent cụ thể không
   */
  async canRoleViewAgent(role: RbacRoleId, agentId: string): Promise<boolean> {
    if (role === "founder") return true;
    const matrix = await this.getPermissionsMatrix();
    return Boolean(matrix.agentPermissions?.[role]?.[agentId]?.canView);
  }

  /**
   * Kiểm tra xem Role có quyền Điều khiển (canControl) một AI Agent cụ thể không
   */
  async canRoleControlAgent(role: RbacRoleId, agentId: string): Promise<boolean> {
    if (role === "founder") return true;
    const matrix = await this.getPermissionsMatrix();
    return Boolean(matrix.agentPermissions?.[role]?.[agentId]?.canControl);
  }

  /**
   * Kiểm tra xem Role có quyền truy cập một Module cụ thể không
   */
  async hasModulePermission(role: RbacRoleId, moduleId: RbacModuleId): Promise<boolean> {
    if (role === "founder") return true;
    const matrix = await this.getPermissionsMatrix();
    return Boolean(matrix.permissions?.[role]?.[moduleId]);
  }

  /**
   * Phân giải một chuỗi lệnh (command string) thành RbacCommandId
   */
  resolveCommandId(commandInput: string): RbacCommandId {
    const trimmed = (commandInput || "").trim().toLowerCase();
    if (trimmed.startsWith("/hire")) return "hire";
    if (trimmed.startsWith("/report")) return "report";
    if (trimmed.startsWith("/do")) return "do";
    if (trimmed.startsWith("/goal")) return "goal";
    if (trimmed.startsWith("/status")) return "status";
    if (trimmed.startsWith("/settings")) return "settings";
    if (trimmed.startsWith("/knowledge")) return "knowledge";
    if (trimmed.startsWith("/audit")) return "audit";
    if (trimmed.startsWith("/security")) return "security";
    if (trimmed.startsWith("/stop")) return "stop";
    if (trimmed.startsWith("/plan")) return "plan";
    if (trimmed.startsWith("/analyze")) return "analyze";
    // Mặc định câu lệnh tự nhiên (không có '/') được chuyển sang /do
    return "do";
  }

  /**
   * Kiểm tra xem Role có quyền thực thi một lệnh cụ thể không
   */
  canRoleExecuteCommand(role: RbacRoleId, commandInput: string): boolean {
    if (role === "founder") return true;
    const cmdId = this.resolveCommandId(commandInput);
    if (!this.inMemoryCommandPermissions) {
      this.loadFromDiskOrDefault();
    }
    return Boolean(this.inMemoryCommandPermissions?.[role]?.[cmdId]);
  }
}

export const rbacService = new RbacService();
