/**
 * Shared domain types — dùng chung giữa services/api, apps/web, apps/desktop, apps/mobile.
 * Đây là "hợp đồng" (contract) duy nhất mô tả dữ liệu, tránh lệch schema giữa client/server.
 */

// ---- Governance enums (Rulebook) --------------------------------------

/** Permission Level áp cho quan hệ Agent <-> Tool. L0 = không quyền, L6 = quyền cao nhất. */
export type PermissionLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6";

/** Risk Level của một Tool / Task / Decision Package. R0 = an toàn, R4 = nghiêm trọng. */
export type RiskLevel = "R0" | "R1" | "R2" | "R3" | "R4";

export type AgentStatus =
  | "READY"
  | "RUNNING"
  | "WAITING"
  | "BLOCKED"
  | "ESCALATED"
  | "AWAITING_APPROVAL"
  | "SUSPENDED";

export type TaskStatus =
  | "NEW"
  | "TRIAGED"
  | "PLANNED"
  | "ASSIGNED"
  | "RUNNING"
  | "VERIFYING"
  | "BLOCKED"
  | "ESCALATED"
  | "AWAITING_APPROVAL"
  | "AWAITING_INTERNAL_REVIEW"
  | "COMPLETED";

export type DecisionStatus = "PENDING" | "APPROVED" | "REJECTED";

/** 7 loại Founder Command chuẩn + Navigation Commands. */
export type FounderCommandType =
  | "/goal"
  | "/plan"
  | "/analyze"
  | "/do"
  | "/status"
  | "/stop"
  | "/report"
  | "/settings"
  | "/knowledge"
  | "/audit"
  | "/security";

// ---- Entities ----------------------------------------------------------

export interface Department {
  id: string;
  name: string;
  managerAgentId?: string | null;
}

export interface Agent {
  id: string;
  name: string;
  title: string;
  departmentId?: string | null;
  reportsTo?: string | null;
  mission: string;
  status: AgentStatus;
  autonomyLevel: number; // 0..5
  budgetCapUsd?: number | null;
  suspendedReason?: string | null;
  monthlyCostUsd: number;
  active?: boolean;
  createdAt: string; // ISO date
}

export interface ToolDefinition {
  id: string;
  name: string;
  description?: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
}

export interface AgentToolPermission {
  agentId: string;
  toolId: string;
  permissionLevel: PermissionLevel;
}

export interface Task {
  id: string;
  parentTaskId?: string | null;
  title: string;
  objective: string;
  assignedTo?: string | null;
  status: TaskStatus;
  riskLevel: RiskLevel;
  reviewNeededByRole?: "founder" | "manager" | "team" | "none" | string;
  internalReviewNotes?: string | null;
  result?: string | null;
  createdBy: string; // "FOUNDER" | agentId
  createdAt: string;
  completedAt?: string | null;
}

export interface DecisionPackage {
  id: string;
  taskId?: string | null;
  agentId?: string | null;
  decisionTitle: string;
  reason: string;
  evidence?: string;
  riskLevel: RiskLevel;
  aiRecommendation?: string;
  confidenceScore?: number; // 0..100
  options: string[]; // A/B/C...
  toolId?: string | null;   // tool to execute after approval
  paramsJson?: string | null; // serialised params for that tool
  status: DecisionStatus;
  createdAt?: string;
  decidedAt?: string | null;
}

export interface AuditLogEntry {
  id: number;
  agentId?: string | null;
  taskId?: string | null;
  toolId?: string | null;
  action: string; // e.g. SUCCESS, FAILED, BLOCKED_NO_PERMISSION, AWAITING_APPROVAL
  inputPayload?: Record<string, unknown>;
  resultSummary?: string;
  riskLevel?: RiskLevel;
  timestamp: string;
}

// ---- WebSocket event envelope -------------------------------------------

export type CompanyEventType =
  | "TASK_UPDATED"
  | "DECISION_REQUIRED"
  | "AUDIT_LOG"
  | "AGENT_STATUS";

export interface CompanyEvent<T = unknown> {
  type: CompanyEventType;
  payload: T;
}

// ---- Tool Gateway execution result ---------------------------------------

export interface ToolExecutionResult {
  status: "SUCCESS" | "FAILED" | "AWAITING_APPROVAL" | "BLOCKED_NO_PERMISSION";
  data?: unknown;
  decisionPackageId?: string;
  message?: string;
}

// ---- Company Knowledge Base ----------------------------------------------

export interface KnowledgeDocument {
  documentId: string;
  title: string;
  source: string | null;
  chunkCount: number;
  createdAt: string;
}

export interface KnowledgeSearchResult {
  title: string;
  content: string;
  source: string | null;
  score: number;
}

// ---- Company Settings ----------------------------------------------------

export interface CompanySettings {
  id: string;
  monthlyBudgetCapUsd: number | null;
  updatedAt: string;
}

// ---- Founder Notifications & Preferences ---------------------------------

export type NotificationCategory =
  | "BUDGET_CAP"
  | "DECISION"
  | "BLOCKED_TASK"
  | "WEEKLY_REPORT"
  | "EMERGENCY_STOP"
  | "SYSTEM";

export interface NotificationPreferences {
  sendToTelegram: boolean;
  sendToEmail: boolean;
  sendToZalo: boolean;
  notifyBudgetCapExceeded: boolean;
  notifyDecisionRequired: boolean;
  notifyBlockedTasks: boolean;
  notifyWeeklyReport: boolean;
  notifyEmergencyStop: boolean;
  customTelegramChatId?: string | null;
  customEmailRecipient?: string | null;
  customZaloPhone?: string | null;
  customZaloGroupId?: string | null;
  updatedAt?: string;
}


