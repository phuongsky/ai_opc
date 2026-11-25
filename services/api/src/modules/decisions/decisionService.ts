/**
 * DecisionService — logic approve/reject Decision Package DÙNG CHUNG cho mọi
 * kênh gọi vào (Web API, Telegram Inbound, sau này có thể thêm Zalo). Tách
 * riêng ra khỏi routes/decisions.route.ts để KHÔNG có 2 nơi viết trùng logic
 * (dễ lệch nhau về sau) — mọi kênh đều đi qua đúng 1 con đường governance.
 */
import { db } from "../../db/client";
import { logAudit } from "../audit/auditLogger";
import { broadcastCompanyEvent } from "../../ws/gateway";
import { toolGateway } from "../governance/toolGateway";
import { verifyTotpCode } from "../auth/twoFactorService";
import type { RiskLevel } from "@ai-opc/shared";

const HIGH_RISK = new Set(["R3", "R4"]);

export async function decisionNeedsTotp(decisionId: string): Promise<boolean> {
  const decision = await db.decisionPackage.findUnique({ where: { id: decisionId } });
  if (!decision) throw new Error(`Decision không tồn tại: ${decisionId}`);
  return HIGH_RISK.has(decision.riskLevel);
}

/** Xác thực mã TOTP của Founder DUY NHẤT trong hệ thống (single-user). */
export async function verifyFounderTotp(code: string): Promise<boolean> {
  const founder = await db.founder.findFirst();
  if (!founder?.totpEnabled || !founder.totpSecret) return false;
  return verifyTotpCode(founder.totpSecret, code);
}

export async function approveDecision(decisionId: string) {
  const existing = await db.decisionPackage.findUnique({ where: { id: decisionId } });
  if (!existing) throw new Error(`Decision Package không tồn tại: ${decisionId}`);
  if (existing.status !== "PENDING") {
    throw new Error(`Decision đã ở trạng thái "${existing.status}".`);
  }

  const decision = await db.decisionPackage.update({
    where: { id: decisionId },
    data: { status: "APPROVED", decidedAt: new Date() },
  });
  await logAudit({
    agentId: decision.agentId,
    taskId: decision.taskId,
    action: "DECISION_APPROVED",
    resultSummary: `Decision ${decisionId} approved`,
    riskLevel: decision.riskLevel as RiskLevel,
  });
  broadcastCompanyEvent({ type: "DECISION_REQUIRED", payload: decision });

  let executionResult: { status: string; message?: string } = { status: "SKIPPED" };
  if (decision.toolId) {
    try {
      const result = await toolGateway.executeApprovedDecision(decisionId);
      executionResult = { status: result.status };
      if (decision.taskId) {
        await db.task.update({
          where: { id: decision.taskId },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      }
    } catch (err) {
      executionResult = { status: "FAILED", message: err instanceof Error ? err.message : String(err) };
      if (decision.taskId) {
        await db.task.update({ where: { id: decision.taskId }, data: { status: "BLOCKED" } });
      }
    }
    if (decision.taskId) {
      const task = await db.task.findUnique({ where: { id: decision.taskId } });
      if (task) broadcastCompanyEvent({ type: "TASK_UPDATED", payload: task });
    }
    if (decision.agentId) {
      const agent = await db.agent.findUnique({ where: { id: decision.agentId } });
      if (agent) broadcastCompanyEvent({ type: "AGENT_STATUS", payload: agent });
    }
  }

  return { ...decision, execution: executionResult };
}

export async function rejectDecision(decisionId: string) {
  const existing = await db.decisionPackage.findUnique({ where: { id: decisionId } });
  if (!existing) throw new Error(`Decision Package không tồn tại: ${decisionId}`);
  if (existing.status !== "PENDING") {
    throw new Error(`Decision đã ở trạng thái "${existing.status}".`);
  }

  const decision = await db.decisionPackage.update({
    where: { id: decisionId },
    data: { status: "REJECTED", decidedAt: new Date() },
  });
  await logAudit({
    agentId: decision.agentId,
    taskId: decision.taskId,
    action: "DECISION_REJECTED",
    resultSummary: `Decision ${decisionId} rejected`,
    riskLevel: decision.riskLevel as RiskLevel,
  });

  if (decision.taskId) {
    await db.task.update({ where: { id: decision.taskId }, data: { status: "BLOCKED" } });
    const task = await db.task.findUnique({ where: { id: decision.taskId } });
    if (task) broadcastCompanyEvent({ type: "TASK_UPDATED", payload: task });
  }
  if (decision.agentId) {
    await db.agent.update({ where: { id: decision.agentId }, data: { status: "READY" } });
    const agent = await db.agent.findUnique({ where: { id: decision.agentId } });
    if (agent) broadcastCompanyEvent({ type: "AGENT_STATUS", payload: agent });
  }

  broadcastCompanyEvent({ type: "DECISION_REQUIRED", payload: decision });
  return decision;
}
