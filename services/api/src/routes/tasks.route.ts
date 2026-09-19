import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { logAudit } from "../modules/audit/auditLogger";
import { broadcastCompanyEvent } from "../ws/gateway";
import { notifyTaskDeliverable } from "../modules/notifications/notifier";
import type { RiskLevel } from "@ai-opc/shared";

export const tasksRouter = Router();

const internalReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  comment: z.string().trim().optional(),
});

// GET /api/tasks — Danh sách tasks
tasksRouter.get("/", async (req, res) => {
  const status = (req.query.status as string) || undefined;
  const assignedTo = (req.query.assignedTo as string) || undefined;

  const tasks = await db.task.findMany({
    where: {
      status: status ? status : undefined,
      assignedTo: assignedTo ? assignedTo : undefined,
    },
    orderBy: { createdAt: "desc" },
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

// GET /api/tasks/:id — Chi tiết 1 task
tasksRouter.get("/:id", async (req, res) => {
  const { id } = req.params;
  const task = await db.task.findUnique({
    where: { id },
    include: {
      agent: true,
      decisions: { orderBy: { id: "desc" } },
    },
  });

  if (!task) {
    return res.status(404).json({ error: "Task không tồn tại." });
  }

  if (!task.result) {
    const log = await db.auditLog.findFirst({
      where: {
        taskId: task.id,
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
    if (log?.resultSummary) {
      return res.json({ ...task, result: log.resultSummary });
    }
  }

  res.json(task);
});

// POST /api/tasks/:id/internal-review — Founder / Manager đánh giá nội bộ
tasksRouter.post("/:id/internal-review", async (req, res) => {
  const { id } = req.params;
  const parsed = internalReviewSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Dữ liệu không hợp lệ. action phải là 'approve' hoặc 'reject'.",
      details: parsed.error.format(),
    });
  }

  const { action, comment } = parsed.data;

  const task = await db.task.findUnique({ where: { id } });
  if (!task) {
    return res.status(404).json({ error: "Task không tồn tại." });
  }

  if (action === "approve") {
    const timestamp = new Date().toLocaleString("vi-VN", { hour12: false });
    const approvalNote = comment
      ? `[${timestamp} · Founder Phê duyệt]: ${comment}`
      : null;

    const updatedNotes = approvalNote
      ? task.internalReviewNotes
        ? `${task.internalReviewNotes}\n${approvalNote}`
        : approvalNote
      : task.internalReviewNotes;

    const updatedTask = await db.task.update({
      where: { id },
      data: {
        status: "COMPLETED",
        reviewNeededByRole: "none",
        internalReviewNotes: updatedNotes,
        completedAt: new Date(),
      },
    });

    await logAudit({
      agentId: updatedTask.assignedTo,
      taskId: updatedTask.id,
      action: "INTERNAL_REVIEW_APPROVED",
      resultSummary: comment
        ? `Founder phê duyệt task: ${comment}`
        : "Founder phê duyệt hoàn tất task sau đánh giá nội bộ.",
      riskLevel: updatedTask.riskLevel as RiskLevel,
    });

    broadcastCompanyEvent({ type: "TASK_UPDATED", payload: updatedTask });

    if (updatedTask.assignedTo) {
      const runningCount = await db.task.count({
        where: { assignedTo: updatedTask.assignedTo, status: "RUNNING" },
      });
      if (runningCount === 0) {
        const agent = await db.agent.update({
          where: { id: updatedTask.assignedTo },
          data: { status: "READY" },
        });
        broadcastCompanyEvent({ type: "AGENT_STATUS", payload: agent });
      }
    }

    return res.json({ status: "OK", task: updatedTask });
  }

  // action === 'reject' (Yêu cầu làm lại / Request changes)
  const timestamp = new Date().toLocaleString("vi-VN", { hour12: false });
  const rejectionNote = `[${timestamp} · Founder Review (Yêu cầu sửa)]: ${comment || "Yêu cầu rà soát và thực hiện lại."}`;
  const updatedNotes = task.internalReviewNotes
    ? `${task.internalReviewNotes}\n${rejectionNote}`
    : rejectionNote;

  const updatedTask = await db.task.update({
    where: { id },
    data: {
      status: "ASSIGNED", // chuyển về ASSIGNED để AgentWorker tự động quét và phân tích lại
      internalReviewNotes: updatedNotes,
      reviewNeededByRole: "founder",
      completedAt: null,
    },
  });

  await logAudit({
    agentId: updatedTask.assignedTo,
    taskId: updatedTask.id,
    action: "INTERNAL_REVIEW_REJECTED",
    resultSummary: comment
      ? `Founder từ chối / yêu cầu sửa: ${comment}`
      : "Founder yêu cầu chỉnh sửa lại task sau đánh giá nội bộ.",
    riskLevel: updatedTask.riskLevel as RiskLevel,
  });

  broadcastCompanyEvent({ type: "TASK_UPDATED", payload: updatedTask });

  return res.json({ status: "OK", task: updatedTask });
});

/**
 * Requeue — đưa 1 task đang ESCALATED/BLOCKED trở lại ASSIGNED để AgentWorker
 * nhặt lại và xử lý (thường dùng sau khi Founder đã xử lý nguyên nhân: tăng
 * trần ngân sách, sửa lỗi mạng, cấp thêm quyền tool...). Chỉ cho phép requeue
 * từ ESCALATED/BLOCKED — không cho requeue task đang RUNNING/AWAITING_APPROVAL
 * để tránh đá văng 1 tiến trình đang thực sự chạy dở.
 */
tasksRouter.post("/:id/requeue", async (req, res) => {
  const task = await db.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: "Task không tồn tại" });

  if (!["ESCALATED", "BLOCKED"].includes(task.status)) {
    return res.status(400).json({
      error: `Chỉ requeue được task đang ESCALATED hoặc BLOCKED (task này đang ${task.status})`,
    });
  }
  if (!task.assignedTo) {
    return res.status(400).json({ error: "Task chưa gán cho Agent nào, không thể requeue" });
  }

  const updated = await db.task.update({ where: { id: task.id }, data: { status: "ASSIGNED" } });
  await logAudit({
    agentId: task.assignedTo,
    taskId: task.id,
    action: "TASK_REQUEUED",
    resultSummary: `Founder requeue task từ ${task.status} về ASSIGNED`,
    riskLevel: task.riskLevel as RiskLevel,
  });
  broadcastCompanyEvent({ type: "TASK_UPDATED", payload: updated });

  res.json(updated);
});

/**
 * POST /api/tasks/:id/notify — Gửi thông báo kết quả bàn giao (Agent Output)
 * qua cả 2 kênh Telegram và Email cho Founder.
 */
tasksRouter.post("/:id/notify", async (req, res) => {
  const { id } = req.params;
  const task = await db.task.findUnique({ where: { id } });

  if (!task) {
    return res.status(404).json({ error: "Task không tồn tại" });
  }

  let deliverable = task.result;
  if (!deliverable) {
    const log = await db.auditLog.findFirst({
      where: {
        taskId: task.id,
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
    if (log?.resultSummary) {
      deliverable = log.resultSummary;
    }
  }

  if (!deliverable || !deliverable.trim()) {
    return res.status(400).json({ error: "Task chưa có kết quả bàn giao (Deliverable) để gửi thông báo." });
  }

  const notificationResult = await notifyTaskDeliverable({
    id: task.id,
    title: task.title,
    objective: task.objective,
    assignedTo: task.assignedTo,
    createdBy: task.createdBy,
    result: deliverable,
  });

  return res.json(notificationResult);
});

const updateDeliverableSchema = z.object({
  result: z.string(),
});

/**
 * PATCH /api/tasks/:id/deliverable — Chỉnh sửa và lưu lại nội dung Kết quả bàn giao (Deliverable)
 */
tasksRouter.patch("/:id/deliverable", async (req, res) => {
  const { id } = req.params;
  const parsed = updateDeliverableSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Dữ liệu không hợp lệ. result là trường bắt buộc (string).",
      details: parsed.error.format(),
    });
  }

  const task = await db.task.findUnique({ where: { id } });
  if (!task) {
    return res.status(404).json({ error: "Task không tồn tại" });
  }

  const updatedTask = await db.task.update({
    where: { id },
    data: {
      result: parsed.data.result,
    },
  });

  await logAudit({
    agentId: updatedTask.assignedTo,
    taskId: updatedTask.id,
    action: "DELIVERABLE_UPDATED",
    resultSummary: `Founder đã chỉnh sửa và cập nhật văn bản bàn giao (Deliverable) cho task #${updatedTask.id.slice(0, 8)}`,
    riskLevel: (updatedTask.riskLevel || "R1") as RiskLevel,
  });

  broadcastCompanyEvent({ type: "TASK_UPDATED", payload: updatedTask });

  return res.json({ status: "OK", task: updatedTask });
});


