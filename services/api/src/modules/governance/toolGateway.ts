/**
 * ToolGateway — LỚP CHẶN DUY NHẤT giữa Agent và mọi hệ thống thật (DB, email,
 * CRM, git, thanh toán...). Không module nào khác được phép gọi thẳng driver
 * bên ngoài; mọi thứ phải đi qua execute() ở đây, để đảm bảo:
 *   - Rule 2: Least Privilege
 *   - Rule 3: Read vs Write tách biệt
 *   - Rule 4: Audit Log cho mọi hành động
 *   - Rule 5: Founder Approval cho hành động rủi ro cao
 *   - Budget Guardrail: Agent đang SUSPENDED (do vượt ngân sách hoặc Founder
 *     /stop) không được thực thi bất kỳ tool nào, kiểm tra lại ở đây phòng
 *     trường hợp agent bị suspend đúng lúc giữa bước suy nghĩ và bước thực thi.
 */
import { randomUUID } from "crypto";
import { db } from "../../db/client";
import { logAudit } from "../audit/auditLogger";
import {
  hasNoPermission,
  permissionRequiresApproval,
  riskRequiresApproval,
  riskRank,
} from "./permissionMatrix";
import { notifyFounder } from "../notifications/notifier";
import { env } from "../../config/env";
import type { PermissionLevel, RiskLevel, ToolExecutionResult } from "@ai-opc/shared";

export type ToolDriver = (params: Record<string, unknown>) => Promise<unknown>;

export const TOOL_ALIASES: Record<string, string> = {
  tool_hotel_sunright_read: "tool_hotel_dbs_read",
  tool_hotel_dbs_read: "tool_hotel_sunright_read",
  tool_hotel_sunright_write: "tool_hotel_dbs_write",
  tool_hotel_dbs_write: "tool_hotel_sunright_write",
  tool_hotel_sunright_describe_schema: "tool_hotel_dbs_describe_schema",
  tool_hotel_dbs_describe_schema: "tool_hotel_sunright_describe_schema",
};

// Registry — đăng ký driver trong index.ts khi bootstrap
const toolDrivers = new Map<string, ToolDriver>();

export function registerToolDriver(toolId: string, driver: ToolDriver): void {
  toolDrivers.set(toolId, driver);
}

export function getToolDriver(toolId: string): ToolDriver | undefined {
  return toolDrivers.get(toolId) || (TOOL_ALIASES[toolId] ? toolDrivers.get(TOOL_ALIASES[toolId]) : undefined);
}

export class PermissionError extends Error { }

export class ToolGateway {
  async execute(
    agentId: string,
    toolId: string,
    taskId: string | null,
    params: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    // 0. Budget Guardrail / Founder /stop — agent đang SUSPENDED thì chặn
    // ngay, không kiểm tra gì thêm. Đây là lớp phòng thủ thứ 2 (lớp thứ nhất
    // là AgentWorker không gọi tới đây từ đầu nếu agent đã SUSPENDED).
    const agentState = await db.agent.findUnique({ where: { id: agentId } });
    if (agentState?.status === "SUSPENDED") {
      await logAudit({
        agentId,
        taskId,
        toolId,
        action: "BLOCKED_SUSPENDED",
        inputPayload: params,
        resultSummary: `Agent đang SUSPENDED (${agentState.suspendedReason ?? "không rõ lý do"}) — chặn thực thi tool.`,
      });
      throw new PermissionError(
        `Agent ${agentId} đang bị SUSPENDED (${agentState.suspendedReason ?? "không rõ lý do"}), không thể thực thi tool.`
      );
    }

    // 1. Kiểm tra quyền của Agent đối với Tool
    const permission = await this.getPermission(agentId, toolId);
    if (hasNoPermission(permission)) {
      await logAudit({
        agentId,
        taskId,
        toolId,
        action: "BLOCKED_NO_PERMISSION",
        inputPayload: params,
        resultSummary: "Access Denied",
      });
      throw new PermissionError(
        `Agent ${agentId} không có quyền sử dụng công cụ ${toolId}`
      );
    }

    let tool = await db.tool.findUnique({ where: { id: toolId } });
    if (!tool && TOOL_ALIASES[toolId]) {
      tool = await db.tool.findUnique({ where: { id: TOOL_ALIASES[toolId] } });
    }
    if (!tool) {
      throw new Error(`Tool không tồn tại trong registry: ${toolId}`);
    }
    const riskLevel = tool.riskLevel as RiskLevel;

    // 2. Kiểm tra yêu cầu phê duyệt (L5/L6 hoặc risk R3/R4, hoặc tool đánh dấu requiresApproval)
    const needsApproval =
      tool.requiresApproval ||
      permissionRequiresApproval(permission as PermissionLevel) ||
      riskRequiresApproval(riskLevel);

    if (needsApproval) {
      const decisionId = await this.createDecisionPackage(
        agentId,
        taskId,
        tool,
        params
      );
      await this.updateAgentStatus(agentId, "AWAITING_APPROVAL");
      await this.updateTaskStatus(taskId, "AWAITING_APPROVAL");
      await logAudit({
        agentId,
        taskId,
        toolId,
        action: "AWAITING_APPROVAL",
        inputPayload: params,
        resultSummary: `Decision package ${decisionId} created`,
        riskLevel,
      });
      return {
        status: "AWAITING_APPROVAL",
        decisionPackageId: decisionId,
        message: `Hành động ${toolId} cần sự phê duyệt của Founder trước khi thực thi.`,
      };
    }

    // 3. Thực thi hành động hợp lệ (không cần duyệt)
    try {
      const driver = getToolDriver(toolId);
      if (!driver) {
        throw new Error(`Chưa đăng ký driver thực thi cho tool: ${toolId}`);
      }
      const result = await driver(params);
      await logAudit({
        agentId,
        taskId,
        toolId,
        action: "SUCCESS",
        inputPayload: params,
        resultSummary: JSON.stringify(result).slice(0, 500),
        riskLevel,
      });
      return { status: "SUCCESS", data: result };
    } catch (err) {
      await logAudit({
        agentId,
        taskId,
        toolId,
        action: "FAILED",
        inputPayload: params,
        resultSummary: err instanceof Error ? err.message : String(err),
        riskLevel,
      });
      throw err;
    }
  }

  /**
   * Thực thi quyết định đã được Founder Approve.
   * Đây là nơi DUY NHẤT chạy driver "thay mặt" 1 quyết định đã được duyệt —
   * không có đường nào khác để bỏ qua bước approve mà vẫn thực thi được.
   */
  async executeApprovedDecision(decisionId: string): Promise<ToolExecutionResult> {
    const decision = await db.decisionPackage.findUnique({ where: { id: decisionId } });
    if (!decision) throw new Error(`Decision package không tồn tại: ${decisionId}`);
    if (!decision.toolId) {
      throw new Error(`Decision package ${decisionId} không gắn với tool nào để thực thi.`);
    }

    const params = decision.paramsJson
      ? (JSON.parse(decision.paramsJson) as Record<string, unknown>)
      : {};
    const driver = getToolDriver(decision.toolId);
    if (!driver) throw new Error(`Chưa đăng ký driver thực thi cho tool: ${decision.toolId}`);

    // VQ-1(a) — Re-check TRƯỚC khi chạy driver: grant có thể bị thu hồi và agent
    // có thể bị /stop (SUSPENDED) trong khoảng thời gian DP nằm ở PENDING. Nếu
    // vẫn chạy driver ở đây thì bypass được cả freeze của Founder lẫn
    // Least Privilege (execute() là cửa thứ nhất — đây là cửa thứ hai).
    const freshPermission = await this.getPermission(decision.agentId, decision.toolId);
    if (hasNoPermission(freshPermission)) {
      await logAudit({
        agentId: decision.agentId,
        taskId: decision.taskId,
        toolId: decision.toolId,
        action: "BLOCKED_NO_PERMISSION",
        resultSummary: "Grant revoked after approval — execution refused",
        riskLevel: decision.riskLevel as RiskLevel,
      });
      throw new PermissionError(
        `Grant của agent ${decision.agentId} cho tool ${decision.toolId} đã bị thu hồi sau khi duyệt — từ chối thực thi.`
      );
    }

    // VQ-1(a) — Agent bị SUSPENDED (Founder /stop hoặc budget cap) mà DP tạo trước
    // đó được duyệt: phải từ chối, không thể nhân danh agent đang bị đóng băng.
    const freshAgent = await db.agent.findUnique({ where: { id: decision.agentId } });
    if (freshAgent?.status === "SUSPENDED") {
      await logAudit({
        agentId: decision.agentId,
        taskId: decision.taskId,
        toolId: decision.toolId,
        action: "BLOCKED_NO_PERMISSION",
        resultSummary: "Agent suspended after approval — execution refused",
        riskLevel: decision.riskLevel as RiskLevel,
      });
      throw new PermissionError(
        `Agent ${decision.agentId} đang bị SUSPENDED sau khi duyệt — từ chối thực thi.`
      );
    }

    try {
      const result = await driver(params);
      await logAudit({
        agentId: decision.agentId,
        taskId: decision.taskId,
        toolId: decision.toolId,
        action: "SUCCESS",
        inputPayload: params,
        resultSummary: `[Sau khi duyệt] ${JSON.stringify(result).slice(0, 450)}`,
        riskLevel: decision.riskLevel as RiskLevel,
      });
      // Không "sống lại" agent đang SUSPENDED (mirror agentWorker.ts concludeTask) —
      // quyền khôi phục trạng thái thuộc về Founder (re-staff / reset-budget).
      if (decision.agentId && freshAgent?.status !== "SUSPENDED") {
        await this.updateAgentStatus(decision.agentId, "READY");
      }
      return { status: "SUCCESS", data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logAudit({
        agentId: decision.agentId,
        taskId: decision.taskId,
        toolId: decision.toolId,
        action: "FAILED",
        inputPayload: params,
        resultSummary: `[Sau khi duyệt] ${message}`,
        riskLevel: decision.riskLevel as RiskLevel,
      });
      // Nhất quán với nhánh SUCCESS: nếu trong lúc chạy driver agent bị
      // SUSPENDED thì không ép agent về BLOCKED — giữ nguyên trạng thái đóng băng.
      if (decision.agentId && freshAgent?.status !== "SUSPENDED") {
        await this.updateAgentStatus(decision.agentId, "BLOCKED");
      }
      throw err;
    }
  }

  // ---- Helpers ----------------------------------------------------------

  private async getPermission(
    agentId: string,
    toolId: string
  ): Promise<PermissionLevel | null> {
    let row = await db.agentToolPermission.findUnique({
      where: { agentId_toolId: { agentId, toolId } },
    });
    if (!row && TOOL_ALIASES[toolId]) {
      row = await db.agentToolPermission.findUnique({
        where: { agentId_toolId: { agentId, toolId: TOOL_ALIASES[toolId] } },
      });
    }
    return (row?.permissionLevel as PermissionLevel) ?? null;
  }

  private async updateAgentStatus(agentId: string, status: string): Promise<void> {
    await db.agent.update({ where: { id: agentId }, data: { status } });
  }

  private async updateTaskStatus(
    taskId: string | null,
    status: string
  ): Promise<void> {
    if (!taskId) return;
    await db.task.update({ where: { id: taskId }, data: { status } });
  }

  private async createDecisionPackage(
    agentId: string,
    taskId: string | null,
    tool: { id: string; name: string; riskLevel: string },
    params: Record<string, unknown>
  ): Promise<string> {
    const id = `dp_${randomUUID()}`;
    await db.decisionPackage.create({
      data: {
        id,
        taskId: taskId ?? undefined,
        agentId,
        decisionTitle: `Thực thi công cụ: ${tool.name}`,
        reason: `Agent "${agentId}" yêu cầu chạy tool "${tool.name}" (risk ${tool.riskLevel}).`,
        evidence: JSON.stringify(params).slice(0, 1000),
        riskLevel: tool.riskLevel,
        toolId: tool.id,
        paramsJson: JSON.stringify(params),
        status: "PENDING",
      },
    });

    // Báo Founder ngoài app (Telegram/Email) — không chặn luồng chính nếu gửi
    // lỗi, chỉ log lỗi ra console. Lọc theo NOTIFY_DECISION_MIN_RISK để Founder
    // tự quyết định ngưỡng nào đáng làm phiền (mặc định R0 = báo tất cả).
    if (riskRank(tool.riskLevel as RiskLevel) >= riskRank(env.notifyDecisionMinRisk)) {
      const task = taskId ? await db.task.findUnique({ where: { id: taskId } }) : null;
      const taskInfo = task ? `📋 Task: #${task.id.slice(0, 8)} - ${task.title}\n` : "";
      void notifyFounder({
        category: "DECISION",
        title: `Cần duyệt: ${tool.name} (${tool.riskLevel})`,
        message: `${taskInfo}🤖 Agent: "${agentId}"\n⚠️ Risk: ${tool.riskLevel}\n📝 Hành động: Yêu cầu chạy tool "${tool.name}".\n\nBấm nút bên dưới hoặc vào Web app (cột "Chờ phê duyệt") để duyệt/từ chối.`,
        severity: tool.riskLevel === "R4" ? "critical" : tool.riskLevel === "R3" ? "warning" : "info",
        decisionId: id,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[ToolGateway] Gửi thông báo Decision Package lỗi:", err);
      });
    }

    return id;
  }
}

export const toolGateway = new ToolGateway();
