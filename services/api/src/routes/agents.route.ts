import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { logAudit } from "../modules/audit/auditLogger";
import { broadcastCompanyEvent } from "../ws/gateway";
import { BUDGET_REASON_AGENT } from "../modules/cost/costTracker";
import type { PermissionLevel, RiskLevel } from "@ai-opc/shared";

export const agentsRouter = Router();

const createAgentSchema = z.object({
  id: z
    .string()
    .trim()
    .min(2, "ID Agent phải có ít nhất 2 ký tự")
    .regex(/^[a-z0-9_]+$/, "ID chỉ gồm chữ thường, số và dấu gạch dưới (vd: agent_growth)"),
  name: z.string().trim().min(2, "Tên Agent phải có ít nhất 2 ký tự"),
  title: z.string().trim().min(2, "Chức danh phải có ít nhất 2 ký tự"),
  departmentId: z.string().trim().optional().nullable(),
  reportsTo: z.string().trim().optional().nullable(),
  mission: z.string().trim().min(5, "Nhiệm vụ (Mission) phải có ít nhất 5 ký tự"),
  autonomyLevel: z.number().int().min(0).max(6).default(1),
  budgetCapUsd: z.number().nonnegative().optional().nullable(),
  initialPermissions: z
    .array(
      z.object({
        toolId: z.string().trim(),
        permissionLevel: z.enum(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]),
      })
    )
    .optional(),
});

const updateAgentSchema = z.object({
  name: z.string().trim().min(2).optional(),
  title: z.string().trim().min(2).optional(),
  departmentId: z.string().trim().optional().nullable(),
  reportsTo: z.string().trim().optional().nullable(),
  mission: z.string().trim().min(5).optional(),
  autonomyLevel: z.number().int().min(0).max(6).optional(),
  budgetCapUsd: z.number().nonnegative().optional().nullable(),
});

// GET /api/agents — Lấy danh sách Agents (mặc định chỉ lấy active, hoặc tất cả nếu includeInactive=true)
agentsRouter.get("/", async (req, res) => {
  const includeInactive = req.query.includeInactive === "true" || req.query.all === "true";
  const where = includeInactive ? {} : { active: true };
  const agents = await db.agent.findMany({
    where,
    include: { department: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(agents);
});

// POST /api/agents — Thuê Agent mới (Agent Lifecycle)
agentsRouter.post("/", async (req, res) => {
  const parsed = createAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dữ liệu tuyển dụng Agent không hợp lệ",
      details: parsed.error.format(),
    });
  }

  const {
    id,
    name,
    title,
    departmentId,
    reportsTo,
    mission,
    autonomyLevel,
    budgetCapUsd,
    initialPermissions,
  } = parsed.data;

  const existing = await db.agent.findUnique({ where: { id } });
  if (existing) {
    return res.status(409).json({ error: `Agent với ID "${id}" đã tồn tại.` });
  }

  // Nếu có departmentId, đảm bảo department tồn tại
  if (departmentId) {
    const dept = await db.department.findUnique({ where: { id: departmentId } });
    if (!dept) {
      return res.status(400).json({ error: `Phòng ban "${departmentId}" không tồn tại` });
    }
  }

  const createdAgent = await db.agent.create({
    data: {
      id,
      name,
      title,
      departmentId: departmentId || null,
      reportsTo: reportsTo || "ai_coo",
      mission,
      autonomyLevel,
      budgetCapUsd: budgetCapUsd ?? null,
      active: true,
      status: "READY",
      monthlyCostUsd: 0,
    },
    include: { department: true },
  });

  // Gán quyền tool ban đầu nếu có
  if (initialPermissions && initialPermissions.length > 0) {
    for (const perm of initialPermissions) {
      if (perm.permissionLevel !== "L0") {
        await db.agentToolPermission.upsert({
          where: { agentId_toolId: { agentId: id, toolId: perm.toolId } },
          create: { agentId: id, toolId: perm.toolId, permissionLevel: perm.permissionLevel },
          update: { permissionLevel: perm.permissionLevel },
        });
      }
    }
  }

  await logAudit({
    agentId: createdAgent.id,
    action: "AGENT_HIRED",
    resultSummary: `Founder tuyển dụng Agent mới: ${createdAgent.name} (${createdAgent.title}) [Dept: ${departmentId || "N/A"}, Autonomy: L${autonomyLevel}]`,
    riskLevel: "R2",
  });

  broadcastCompanyEvent({ type: "AGENT_STATUS", payload: createdAgent });

  res.status(201).json(createdAgent);
});

// GET /api/agents/:id — Lấy chi tiết Agent
agentsRouter.get("/:id", async (req, res) => {
  const agent = await db.agent.findUnique({
    where: { id: req.params.id },
    include: { toolPermissions: { include: { tool: true } }, department: true },
  });
  if (!agent) return res.status(404).json({ error: "Agent không tồn tại" });

  // Thống kê nhanh để hiển thị ở trang chi tiết — tính luôn ở server để
  // frontend không phải tải toàn bộ task/log rồi tự group.
  const [taskStats, toolCallStats, totalAuditEntries] = await Promise.all([
    db.task.groupBy({ by: ["status"], where: { assignedTo: agent.id }, _count: true }),
    db.auditLog.groupBy({ by: ["action"], where: { agentId: agent.id }, _count: true }),
    db.auditLog.count({ where: { agentId: agent.id } }),
  ]);

  res.json({
    ...agent,
    stats: {
      tasksByStatus: Object.fromEntries(taskStats.map((s: any) => [s.status, s._count])),
      auditByAction: Object.fromEntries(toolCallStats.map((s: any) => [s.action, s._count])),
      totalAuditEntries,
    },
  });
});

// PATCH /api/agents/:id — Cập nhật thông tin Agent (Sửa thông tin)
agentsRouter.patch("/:id", async (req, res) => {
  const parsed = updateAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dữ liệu cập nhật Agent không hợp lệ",
      details: parsed.error.format(),
    });
  }

  const existing = await db.agent.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Agent không tồn tại" });

  if (parsed.data.departmentId) {
    const dept = await db.department.findUnique({ where: { id: parsed.data.departmentId } });
    if (!dept) {
      return res.status(400).json({ error: `Phòng ban "${parsed.data.departmentId}" không tồn tại` });
    }
  }

  const updatedAgent = await db.agent.update({
    where: { id: req.params.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.departmentId !== undefined ? { departmentId: parsed.data.departmentId } : {}),
      ...(parsed.data.reportsTo !== undefined ? { reportsTo: parsed.data.reportsTo } : {}),
      ...(parsed.data.mission !== undefined ? { mission: parsed.data.mission } : {}),
      ...(parsed.data.autonomyLevel !== undefined ? { autonomyLevel: parsed.data.autonomyLevel } : {}),
      ...(parsed.data.budgetCapUsd !== undefined ? { budgetCapUsd: parsed.data.budgetCapUsd } : {}),
    },
    include: { department: true, toolPermissions: { include: { tool: true } } },
  });

  await logAudit({
    agentId: updatedAgent.id,
    action: "AGENT_UPDATED",
    resultSummary: `Founder cập nhật thông tin Agent: ${updatedAgent.name} (${updatedAgent.title})`,
    riskLevel: "R1",
  });

  broadcastCompanyEvent({ type: "AGENT_STATUS", payload: updatedAgent });

  res.json(updatedAgent);
});

// POST /api/agents/:id/fire — Sa thải Agent (Soft-delete: active=false, status=SUSPENDED)
agentsRouter.post("/:id/fire", async (req, res) => {
  const agent = await db.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ error: "Agent không tồn tại" });

  if (agent.id === "ai_coo") {
    return res.status(400).json({ error: "Không thể sa thải AI-COO" });
  }

  const updated = await db.agent.update({
    where: { id: req.params.id },
    data: {
      active: false,
      status: "SUSPENDED",
      suspendedReason: "FIRED_BY_FOUNDER",
    },
    include: { department: true },
  });

  await logAudit({
    agentId: updated.id,
    action: "AGENT_FIRED",
    resultSummary: `Founder sa thải Agent: ${updated.name} (${updated.title}) — toàn bộ dữ liệu task/audit được giữ nguyên`,
    riskLevel: "R3",
  });

  broadcastCompanyEvent({ type: "AGENT_STATUS", payload: updated });

  res.json({ status: "OK", message: `Đã sa thải agent ${updated.name}`, agent: updated });
});

// POST /api/agents/:id/rehire — Tuyển dụng lại Agent (active=true, status=READY)
agentsRouter.post("/:id/rehire", async (req, res) => {
  const agent = await db.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ error: "Agent không tồn tại" });

  const updated = await db.agent.update({
    where: { id: req.params.id },
    data: {
      active: true,
      status: "READY",
      suspendedReason: null,
    },
    include: { department: true },
  });

  await logAudit({
    agentId: updated.id,
    action: "AGENT_REHIRED",
    resultSummary: `Founder tuyển dụng lại Agent: ${updated.name} (${updated.title})`,
    riskLevel: "R2",
  });

  broadcastCompanyEvent({ type: "AGENT_STATUS", payload: updated });

  res.json({ status: "OK", message: `Đã tuyển dụng lại agent ${updated.name}`, agent: updated });
});

/** Lịch sử task đã/đang xử lý của 1 Agent, mới nhất trước. */
agentsRouter.get("/:id/tasks", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const tasks = await db.task.findMany({
    where: { assignedTo: req.params.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const missingResultTaskIds = tasks.filter((t: any) => !t.result).map((t: any) => t.id);
  if (missingResultTaskIds.length > 0) {
    const logs = await db.auditLog.findMany({
      where: {
        taskId: { in: missingResultTaskIds },
        action: {
          in: [
            "COMPLETED_NO_TOOL",
            "COMPLETED_MULTI_STEP",
            "COMPLETED_MAX_STEPS",
            "AWAITING_INTERNAL_REVIEW",
            "INTERNAL_REVIEW_APPROVED",
            "SUCCESS",
          ],
        },
      },
      orderBy: { timestamp: "desc" },
    });

    const resultMap = new Map<string, string>();
    for (const log of logs) {
      if (log.taskId && log.resultSummary && !resultMap.has(log.taskId)) {
        resultMap.set(log.taskId, log.resultSummary);
      }
    }

    const enriched = tasks.map((t: any) => {
      if (!t.result && resultMap.has(t.id)) {
        return { ...t, result: resultMap.get(t.id) };
      }
      return t;
    });

    return res.json(enriched);
  }

  res.json(tasks);
});

/** Audit log riêng của 1 Agent (mọi hành động: SUCCESS, FAILED, BLOCKED, AWAITING_APPROVAL...). */
agentsRouter.get("/:id/audit-logs", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const logs = await db.auditLog.findMany({
    where: { agentId: req.params.id },
    orderBy: { timestamp: "desc" },
    take: limit,
  });
  res.json(logs);
});

/**
 * Đặt/xoá trần ngân sách riêng cho 1 Agent (Budget Guardrail). Gửi
 * `budgetCapUsd: null` để xoá trần (không giới hạn).
 */
agentsRouter.patch("/:id/budget", async (req, res) => {
  const { budgetCapUsd } = req.body as { budgetCapUsd: number | null };
  const agent = await db.agent.update({
    where: { id: req.params.id },
    data: { budgetCapUsd: budgetCapUsd === null || budgetCapUsd === undefined ? null : Number(budgetCapUsd) },
  });
  await logAudit({
    agentId: agent.id,
    action: "BUDGET_CAP_UPDATED",
    resultSummary:
      budgetCapUsd == null ? "Founder xoá trần ngân sách riêng" : `Founder đặt trần ngân sách riêng: $${budgetCapUsd}`,
  });
  broadcastCompanyEvent({ type: "AGENT_STATUS", payload: agent });
  res.json(agent);
});

/**
 * Reset `monthlyCostUsd` về 0 — dùng thủ công đầu mỗi tháng, hoặc gọi từ 1
 * cron job production.
 */
agentsRouter.post("/:id/reset-cost", async (req, res) => {
  const current = await db.agent.findUnique({ where: { id: req.params.id } });
  const shouldUnsuspend = current?.suspendedReason === BUDGET_REASON_AGENT;

  const agent = await db.agent.update({
    where: { id: req.params.id },
    data: {
      monthlyCostUsd: 0,
      ...(shouldUnsuspend ? { status: "READY", suspendedReason: null } : {}),
    },
  });

  await logAudit({
    agentId: agent.id,
    action: "COST_RESET",
    resultSummary: shouldUnsuspend
      ? "Founder reset chi phí về $0 + tự động mở lại Agent (trước đó bị SUSPENDED do vượt ngân sách riêng)"
      : "Founder reset monthlyCostUsd về 0",
  });
  broadcastCompanyEvent({ type: "AGENT_STATUS", payload: agent });
  res.json(agent);
});

/**
 * Cấp / Cập nhật quyền sử dụng Tool cho Agent (Permission Matrix).
 * Body: { toolId: string, permissionLevel: "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6" }
 */
agentsRouter.post("/:id/permissions", async (req, res) => {
  const agentId = req.params.id;
  const { toolId, permissionLevel } = req.body as { toolId: string; permissionLevel: PermissionLevel };

  if (!toolId || !permissionLevel) {
    return res.status(400).json({ error: "Thiếu toolId hoặc permissionLevel" });
  }

  const [agent, tool] = await Promise.all([
    db.agent.findUnique({ where: { id: agentId } }),
    db.tool.findUnique({ where: { id: toolId } }),
  ]);

  if (!agent) return res.status(404).json({ error: "Agent không tồn tại" });
  if (!tool) return res.status(404).json({ error: "Tool không tồn tại" });

  const permission = await db.agentToolPermission.upsert({
    where: { agentId_toolId: { agentId, toolId } },
    create: { agentId, toolId, permissionLevel },
    update: { permissionLevel },
    include: { tool: true },
  });

  await logAudit({
    agentId,
    toolId,
    action: "TOOL_PERMISSION_UPDATED",
    resultSummary: `Founder cấp/sửa quyền tool "${tool.name}" cho Agent "${agent.name}": ${permissionLevel}`,
    riskLevel: tool.riskLevel as RiskLevel,
  });

  broadcastCompanyEvent({ type: "AGENT_STATUS", payload: agent });

  res.json(permission);
});

/**
 * Xóa quyền sử dụng Tool của Agent.
 */
agentsRouter.delete("/:id/permissions/:toolId", async (req, res) => {
  const { id: agentId, toolId } = req.params;

  const existing = await db.agentToolPermission.findUnique({
    where: { agentId_toolId: { agentId, toolId } },
    include: { tool: true, agent: true },
  });

  if (!existing) {
    return res.status(404).json({ error: "Agent chưa từng được cấp quyền tool này" });
  }

  await db.agentToolPermission.delete({
    where: { agentId_toolId: { agentId, toolId } },
  });

  await logAudit({
    agentId,
    toolId,
    action: "TOOL_PERMISSION_REMOVED",
    resultSummary: `Founder gỡ quyền tool "${existing.tool.name}" khỏi Agent "${existing.agent.name}"`,
    riskLevel: existing.tool.riskLevel as RiskLevel,
  });

  broadcastCompanyEvent({ type: "AGENT_STATUS", payload: existing.agent });

  res.json({ status: "OK", message: `Đã gỡ quyền ${existing.tool.name}` });
});
