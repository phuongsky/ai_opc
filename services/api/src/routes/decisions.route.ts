/**
 * Decisions route — list, approve (with TOTP for R3/R4), reject.
 *
 * v1.1: Sau khi Founder Approve, nếu DecisionPackage có toolId + paramsJson
 * thì ToolGateway.executeApprovedDecision() chạy lại tool đó ngay lập tức
 * (resume-after-approval). Task liên quan tự chuyển COMPLETED hoặc BLOCKED
 * tuỳ kết quả.
 */
import { Router } from "express";
import { db } from "../db/client";
import { logAudit } from "../modules/audit/auditLogger";
import { broadcastCompanyEvent } from "../ws/gateway";
import { requireTotpForHighRisk } from "../middleware/requireTotpForHighRisk";
import { toolGateway } from "../modules/governance/toolGateway";
import type { RiskLevel } from "@ai-opc/shared";

export const decisionsRouter = Router();

// ---- GET / -------------------------------------------------------------
decisionsRouter.get("/", async (req, res) => {
  const status = (req.query.status as string) || undefined;
  const decisions = await db.decisionPackage.findMany({
    where: status ? { status } : undefined,
    orderBy: { id: "desc" },
  });
  res.json(decisions);
});

// ---- POST /:id/approve -------------------------------------------------
decisionsRouter.post("/:id/approve", requireTotpForHighRisk, async (req, res) => {
  const { id } = req.params;

  const decision = await db.decisionPackage.findUnique({ where: { id } });
  if (!decision) return res.status(404).json({ error: "Decision Package không tồn tại." });
  if (decision.status !== "PENDING")
    return res.status(400).json({ error: `Decision đã ở trạng thái "${decision.status}".` });

  // 1. Đánh dấu APPROVED
  const updated = await db.decisionPackage.update({
    where: { id },
    data: { status: "APPROVED", decidedAt: new Date() },
  });

  await logAudit({
    agentId: updated.agentId,
    taskId: updated.taskId,
    action: "DECISION_APPROVED",
    resultSummary: `Founder approved decision ${id} (risk ${updated.riskLevel})`,
    riskLevel: updated.riskLevel as RiskLevel,
  });
  broadcastCompanyEvent({ type: "DECISION_REQUIRED", payload: updated });

  // 2. Thực thi THẬT ngay sau khi duyệt — đúng tool + params đã lưu lúc tạo decision.
  let executionResult: { status: string; message?: string } = { status: "SKIPPED" };
  if (updated.toolId) {
    try {
      const result = await toolGateway.executeApprovedDecision(id);
      executionResult = { status: result.status };
      if (updated.taskId) {
        await db.task.update({
          where: { id: updated.taskId },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      }
    } catch (err) {
      executionResult = { status: "FAILED", message: err instanceof Error ? err.message : String(err) };
      if (updated.taskId) {
        await db.task.update({ where: { id: updated.taskId }, data: { status: "BLOCKED" } });
      }
    }
    if (updated.taskId) {
      const task = await db.task.findUnique({ where: { id: updated.taskId } });
      if (task) broadcastCompanyEvent({ type: "TASK_UPDATED", payload: task });
    }
    if (updated.agentId) {
      const agent = await db.agent.findUnique({ where: { id: updated.agentId } });
      if (agent) broadcastCompanyEvent({ type: "AGENT_STATUS", payload: agent });
    }
  }

  res.json({ ...updated, execution: executionResult });
});

// ---- POST /:id/reject --------------------------------------------------
decisionsRouter.post("/:id/reject", async (req, res) => {
  const { id } = req.params;

  const decision = await db.decisionPackage.findUnique({ where: { id } });
  if (!decision) return res.status(404).json({ error: "Decision Package không tồn tại." });
  if (decision.status !== "PENDING")
    return res.status(400).json({ error: `Decision đã ở trạng thái "${decision.status}".` });

  const updated = await db.decisionPackage.update({
    where: { id },
    data: { status: "REJECTED", decidedAt: new Date() },
  });

  await logAudit({
    agentId: updated.agentId,
    taskId: updated.taskId,
    action: "DECISION_REJECTED",
    resultSummary: `Founder rejected decision ${id} (risk ${updated.riskLevel})`,
    riskLevel: updated.riskLevel as RiskLevel,
  });
  broadcastCompanyEvent({ type: "DECISION_REQUIRED", payload: updated });

  // Task bị reject → chuyển BLOCKED, agent về READY
  if (updated.taskId) {
    const task = await db.task.update({
      where: { id: updated.taskId },
      data: { status: "BLOCKED" },
    });
    broadcastCompanyEvent({ type: "TASK_UPDATED", payload: task });
  }
  if (updated.agentId) {
    const agent = await db.agent.update({ where: { id: updated.agentId }, data: { status: "READY" } });
    broadcastCompanyEvent({ type: "AGENT_STATUS", payload: agent });
  }

  res.json(updated);
});
