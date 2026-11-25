import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { logAudit } from "../modules/audit/auditLogger";
import { broadcastCompanyEvent } from "../ws/gateway";
import { notifyTaskDeliverable } from "../modules/notifications/notifier";
import { rbacService } from "../modules/rbac/rbacService";
import type { AuthedRequest } from "../middleware/requireAuth";
import type { RiskLevel } from "@ai-opc/shared";

export const tasksRouter = Router();

const internalReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  comment: z.string().trim().optional(),
});

// GET /api/tasks — Danh sách tasks
tasksRouter.get("/", async (req: AuthedRequest, res) => {
  const status = (req.query.status as string) || undefined;
  const assignedTo = (req.query.assignedTo as string) || undefined;
  const includeTrash = req.query.includeTrash === "true";

  let statusFilter: any = undefined;
  if (status) {
    statusFilter = status;
  } else if (!includeTrash) {
    statusFilter = { not: "TRASH" };
  }

  const role = await rbacService.getUserRole(req);
  let assignedToFilter: any = assignedTo ? assignedTo : undefined;

  // Lọc thông minh theo ma trận RBAC: Nếu không phải Founder, chỉ lấy các Task gán cho Agent được cấp quyền
  if (role !== "founder") {
    const allowedAgentIds = await rbacService.getAllowedAgentIdsForRole(role);
    if (assignedTo) {
      if (!allowedAgentIds.includes(assignedTo)) {
        return res.json([]);
      }
    } else {
      assignedToFilter = { in: allowedAgentIds };
    }
  }

  const tasks = await db.task.findMany({
    where: {
      status: statusFilter,
      assignedTo: assignedToFilter,
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

// GET /api/tasks/trash/list — Danh sách các task trong thùng rác
tasksRouter.get("/trash/list", async (req: AuthedRequest, res) => {
  const role = await rbacService.getUserRole(req);
  const where: any = { status: "TRASH" };

  if (role !== "founder") {
    const allowedAgentIds = await rbacService.getAllowedAgentIdsForRole(role);
    where.assignedTo = { in: allowedAgentIds };
  }

  const tasks = await db.task.findMany({
    where,
    include: {
      agent: true,
      decisions: { orderBy: { id: "desc" } },
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json(tasks);
});

// GET /api/tasks/trash/count — Số lượng task trong thùng rác
tasksRouter.get("/trash/count", async (req: AuthedRequest, res) => {
  const role = await rbacService.getUserRole(req);
  const where: any = { status: "TRASH" };

  if (role !== "founder") {
    const allowedAgentIds = await rbacService.getAllowedAgentIdsForRole(role);
    where.assignedTo = { in: allowedAgentIds };
  }

  const count = await db.task.count({ where });
  res.json({ count });
});

// POST /api/tasks/trash/empty — Dọn sạch toàn bộ thùng rác ngay lập tức
tasksRouter.post("/trash/empty", async (_req, res) => {
  const trashTasks = await db.task.findMany({
    where: { status: "TRASH" },
    select: { id: true },
  });
  const taskIds = trashTasks.map((t: any) => t.id);

  if (taskIds.length > 0) {
    await db.decisionPackage.deleteMany({
      where: { taskId: { in: taskIds } },
    });
    await db.auditLog.deleteMany({
      where: { taskId: { in: taskIds } },
    });
    await db.task.deleteMany({
      where: { id: { in: taskIds } },
    });
  }

  broadcastCompanyEvent({ type: "TASK_UPDATED", payload: { action: "TRASH_EMPTIED", count: taskIds.length } });
  res.json({ status: "OK", deletedCount: taskIds.length });
});

// POST /api/tasks/trash/all — Chuyển toàn bộ task hiện có vào thùng rác
tasksRouter.post("/trash/all", async (req: AuthedRequest, res) => {
  try {
    const role = await rbacService.getUserRole(req);
    const where: any = { status: { not: "TRASH" } };

    if (role !== "founder") {
      const allowedAgentIds = await rbacService.getAllowedAgentIdsForRole(role);
      where.assignedTo = { in: allowedAgentIds };
    }

    const activeTasks = await db.task.findMany({
      where,
      select: { id: true, assignedTo: true, riskLevel: true },
    });

    if (activeTasks.length === 0) {
      return res.json({ status: "OK", count: 0, message: "Không có tác vụ nào để chuyển vào thùng rác." });
    }

    const taskIds = activeTasks.map((t: any) => t.id);

    const updated = await db.task.updateMany({
      where: { id: { in: taskIds } },
      data: {
        status: "TRASH",
        updatedAt: new Date(),
      },
    });

    await logAudit({
      action: "ALL_TASKS_MOVED_TO_TRASH",
      resultSummary: `Đã chuyển toàn bộ ${updated.count} tác vụ vào Thùng rác (Tự động xóa sau 30 ngày)`,
      riskLevel: "R2",
    });

    broadcastCompanyEvent({
      type: "TASK_UPDATED",
      payload: { action: "ALL_TASKS_MOVED_TO_TRASH", count: updated.count },
    });

    res.json({ status: "OK", count: updated.count });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi chuyển toàn bộ task vào thùng rác" });
  }
});

// GET /api/tasks/:id — Chi tiết 1 task
tasksRouter.get("/:id", async (req: AuthedRequest, res) => {
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

  const role = await rbacService.getUserRole(req);
  if (role !== "founder" && task.assignedTo) {
    const canView = await rbacService.canRoleViewAgent(role, task.assignedTo);
    if (!canView) {
      return res.status(403).json({ error: "Bạn không có quyền truy cập tác vụ của AI Agent này theo cấu hình RBAC." });
    }
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
tasksRouter.post("/:id/internal-review", async (req: AuthedRequest, res) => {
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

  const role = await rbacService.getUserRole(req);
  if (role !== "founder" && task.assignedTo) {
    const canControl = await rbacService.canRoleControlAgent(role, task.assignedTo);
    if (!canControl) {
      return res.status(403).json({ error: "Bạn không có quyền đánh giá nội bộ tác vụ của AI Agent này theo cấu hình RBAC." });
    }
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
tasksRouter.post("/:id/requeue", async (req: AuthedRequest, res) => {
  const task = await db.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: "Task không tồn tại" });

  const role = await rbacService.getUserRole(req);
  if (role !== "founder" && task.assignedTo) {
    const canControl = await rbacService.canRoleControlAgent(role, task.assignedTo);
    if (!canControl) {
      return res.status(403).json({ error: "Bạn không có quyền requeue tác vụ của AI Agent này theo cấu hình RBAC." });
    }
  }

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
tasksRouter.post("/:id/notify", async (req: AuthedRequest, res) => {
  const { id } = req.params;
  const task = await db.task.findUnique({ where: { id } });

  if (!task) {
    return res.status(404).json({ error: "Task không tồn tại" });
  }

  const role = await rbacService.getUserRole(req);
  if (role !== "founder" && task.assignedTo) {
    const canView = await rbacService.canRoleViewAgent(role, task.assignedTo);
    if (!canView) {
      return res.status(403).json({ error: "Bạn không có quyền truy cập tác vụ của AI Agent này." });
    }
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
tasksRouter.patch("/:id/deliverable", async (req: AuthedRequest, res) => {
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

  const role = await rbacService.getUserRole(req);
  if (role !== "founder" && task.assignedTo) {
    const canControl = await rbacService.canRoleControlAgent(role, task.assignedTo);
    if (!canControl) {
      return res.status(403).json({ error: "Bạn không có quyền chỉnh sửa kết quả bàn giao của AI Agent này theo cấu hình RBAC." });
    }
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

/**
 * POST /api/tasks/:id/trash — Chuyển task vào thùng rác (Tự động xóa sau 30 ngày)
 */
tasksRouter.post("/:id/trash", async (req: AuthedRequest, res) => {
  const { id } = req.params;
  const task = await db.task.findUnique({ where: { id } });
  if (!task) {
    return res.status(404).json({ error: "Task không tồn tại." });
  }

  const role = await rbacService.getUserRole(req);
  if (role !== "founder" && task.assignedTo) {
    const canControl = await rbacService.canRoleControlAgent(role, task.assignedTo);
    if (!canControl) {
      return res.status(403).json({ error: "Bạn không có quyền chuyển tác vụ này vào thùng rác theo cấu hình RBAC." });
    }
  }

  const updatedTask = await db.task.update({
    where: { id },
    data: {
      status: "TRASH",
      updatedAt: new Date(),
    },
  });

  await logAudit({
    agentId: task.assignedTo,
    taskId: task.id,
    action: "TASK_MOVED_TO_TRASH",
    resultSummary: `Task #${task.id.slice(0, 8)} đã được chuyển vào Thùng rác (Tự động xóa sau 30 ngày)`,
    riskLevel: (task.riskLevel || "R1") as RiskLevel,
  });

  broadcastCompanyEvent({ type: "TASK_UPDATED", payload: updatedTask });
  res.json({ status: "OK", task: updatedTask });
});

/**
 * POST /api/tasks/:id/restore — Khôi phục task từ thùng rác về bảng Kanban
 */
tasksRouter.post("/:id/restore", async (req: AuthedRequest, res) => {
  const { id } = req.params;
  const task = await db.task.findUnique({ where: { id } });
  if (!task) {
    return res.status(404).json({ error: "Task không tồn tại." });
  }

  const role = await rbacService.getUserRole(req);
  if (role !== "founder" && task.assignedTo) {
    const canControl = await rbacService.canRoleControlAgent(role, task.assignedTo);
    if (!canControl) {
      return res.status(403).json({ error: "Bạn không có quyền khôi phục tác vụ này theo cấu hình RBAC." });
    }
  }

  const restoredStatus = task.completedAt ? "COMPLETED" : (task.assignedTo ? "ASSIGNED" : "NEW");

  const updatedTask = await db.task.update({
    where: { id },
    data: {
      status: restoredStatus,
      updatedAt: new Date(),
    },
  });

  await logAudit({
    agentId: task.assignedTo,
    taskId: task.id,
    action: "TASK_RESTORED_FROM_TRASH",
    resultSummary: `Khôi phục task #${task.id.slice(0, 8)} từ Thùng rác về trạng thái ${restoredStatus}`,
    riskLevel: (task.riskLevel || "R1") as RiskLevel,
  });

  broadcastCompanyEvent({ type: "TASK_UPDATED", payload: updatedTask });
  res.json({ status: "OK", task: updatedTask });
});

/**
 * DELETE /api/tasks/:id — Xóa vĩnh viễn task khỏi hệ thống
 */
tasksRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const { id } = req.params;
  const task = await db.task.findUnique({ where: { id } });
  if (!task) {
    return res.status(404).json({ error: "Task không tồn tại." });
  }

  const role = await rbacService.getUserRole(req);
  if (role !== "founder" && task.assignedTo) {
    const canControl = await rbacService.canRoleControlAgent(role, task.assignedTo);
    if (!canControl) {
      return res.status(403).json({ error: "Bạn không có quyền xóa vĩnh viễn tác vụ này theo cấu hình RBAC." });
    }
  }

  await db.decisionPackage.deleteMany({ where: { taskId: id } });
  await db.auditLog.deleteMany({ where: { taskId: id } });
  await db.task.delete({ where: { id } });

  broadcastCompanyEvent({ type: "TASK_UPDATED", payload: { id, deleted: true } });
  res.json({ status: "OK", message: `Đã xóa vĩnh viễn task #${id}` });
});


