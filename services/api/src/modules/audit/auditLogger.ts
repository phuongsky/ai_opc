import { db } from "../../db/client";
import type { RiskLevel } from "@ai-opc/shared";

interface AuditParams {
  agentId?: string | null;
  taskId?: string | null;
  toolId?: string | null;
  action: string; // SUCCESS, FAILED, BLOCKED_NO_PERMISSION, AWAITING_APPROVAL...
  inputPayload?: Record<string, unknown>;
  resultSummary?: string;
  riskLevel?: RiskLevel | null;
}

/**
 * Ghi audit log — CHỈ được phép INSERT. Không có hàm update/delete nào trong
 * module này một cách cố ý: bảng audit_logs phải bất biến (Rule 4 & 10).
 * Ở tầng DB, user kết nối của API cũng không nên có quyền UPDATE/DELETE bảng này.
 */
export async function logAudit(params: AuditParams): Promise<void> {
  await db.auditLog.create({
    data: {
      agentId: params.agentId ?? null,
      taskId: params.taskId ?? null,
      toolId: params.toolId ?? null,
      action: params.action,
      inputPayload: params.inputPayload ? JSON.stringify(params.inputPayload) : null,
      resultSummary: params.resultSummary?.slice(0, 2000),
      riskLevel: params.riskLevel ?? null,
    },
  });
}

export async function listAuditLogs(limit = 100, offset = 0) {
  return db.auditLog.findMany({
    orderBy: { timestamp: "desc" },
    take: limit,
    skip: offset,
  });
}
