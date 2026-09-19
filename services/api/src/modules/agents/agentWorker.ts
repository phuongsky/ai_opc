/**
 * AgentWorker — vòng lặp nền (poll) lấy các Task đang ở trạng thái `ASSIGNED`
 * để Agent tương ứng thực thi qua quy trình Multi-step Reasoning:
 *   1. Lặp qua các bước (tối đa MAX_STEPS = 5)
 *   2. Mỗi bước: AgentReasoner phân tích ngữ cảnh + lịch sử các bước trước
 *   3. Nếu CALL_TOOL: ToolGateway thực thi (enforce permission, risk, audit, approval)
 *   4. Nếu NONE: Hoàn thành task với kết quả tổng hợp
 *   5. Nếu AWAITING_APPROVAL: Chuyển task sang chờ Founder duyệt
 */
import { db } from "../../db/client";
import { env } from "../../config/env";
import { broadcastCompanyEvent } from "../../ws/gateway";
import { logAudit } from "../audit/auditLogger";
import { toolGateway } from "../governance/toolGateway";
import { decideAgentAction, type ToolStepRecord } from "./agentReasoner";
import type { RiskLevel } from "@ai-opc/shared";

const MAX_TASKS_PER_TICK = 5;
const MAX_STEPS_PER_TASK = 5;

let isProcessing = false;

async function broadcastTask(taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (task) broadcastCompanyEvent({ type: "TASK_UPDATED", payload: task });
}

async function broadcastAgent(agentId: string) {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (agent) broadcastCompanyEvent({ type: "AGENT_STATUS", payload: agent });
}

async function processOneTask(task: {
  id: string;
  title: string;
  objective: string;
  assignedTo: string | null;
  riskLevel: string;
  reviewNeededByRole: string;
  internalReviewNotes: string | null;
}): Promise<void> {
  if (!task.assignedTo) return;
  const agentId = task.assignedTo;

  console.log(`[agentWorker] Agent "${agentId}" bắt đầu xử lý task "${task.title}"`);

  // Kiểm tra Budget Guardrail / Founder /stop TRƯỚC khi làm gì cả — agent đang
  // SUSPENDED (do vượt ngân sách hoặc Founder dừng khẩn cấp) thì không được
  // gọi model hay chạy tool. Đánh dấu task BLOCKED để Founder thấy rõ lý do
  // thay vì task kẹt âm thầm mãi ở ASSIGNED.
  const agentBeforeRun = await db.agent.findUnique({ where: { id: agentId } });
  if (!agentBeforeRun || agentBeforeRun.status === "SUSPENDED") {
    await db.task.update({ where: { id: task.id }, data: { status: "BLOCKED" } });
    await broadcastTask(task.id);
    return;
  }

  await db.task.update({ where: { id: task.id }, data: { status: "RUNNING" } });
  await db.agent.update({ where: { id: agentId }, data: { status: "RUNNING" } });
  await broadcastTask(task.id);
  await broadcastAgent(agentId);

  const stepHistory: ToolStepRecord[] = [];
  let executedHighRiskTool = false;

  const concludeTask = async (note: string, actionType: string) => {
    const isHighRisk =
      executedHighRiskTool ||
      task.riskLevel === "R3" ||
      task.riskLevel === "R4" ||
      (task.reviewNeededByRole && task.reviewNeededByRole !== "none");

    if (isHighRisk) {
      const targetRole =
        task.reviewNeededByRole && task.reviewNeededByRole !== "none"
          ? task.reviewNeededByRole
          : "founder";

      console.log(
        `[agentWorker] Task "${task.title}" yêu cầu đánh giá nội bộ (${targetRole}) — chuyển sang AWAITING_INTERNAL_REVIEW.`
      );

      await db.task.update({
        where: { id: task.id },
        data: {
          status: "AWAITING_INTERNAL_REVIEW",
          reviewNeededByRole: targetRole,
          result: note,
        },
      });

      await logAudit({
        agentId,
        taskId: task.id,
        action: "AWAITING_INTERNAL_REVIEW",
        resultSummary: `Agent "${agentId}" hoàn tất các bước. Chuyển sang chờ ${targetRole} đánh giá nội bộ: ${note}`,
        riskLevel: (task.riskLevel as RiskLevel) || "R3",
      });
    } else {
      console.log(`[agentWorker] Task "${task.title}" hoàn thành.`);
      await db.task.update({
        where: { id: task.id },
        data: {
          status: "COMPLETED",
          reviewNeededByRole: "none",
          result: note,
          completedAt: new Date(),
        },
      });

      await logAudit({
        agentId,
        taskId: task.id,
        action: actionType,
        resultSummary: note,
        riskLevel: (task.riskLevel as RiskLevel) || "R1",
      });
    }

    const fresh = await db.agent.findUnique({ where: { id: agentId } });
    if (fresh && fresh.status !== "SUSPENDED") {
      await db.agent.update({ where: { id: agentId }, data: { status: "READY" } });
    }
  };

  try {
    for (let step = 1; step <= MAX_STEPS_PER_TASK; step++) {
      console.log(`[agentWorker] Agent "${agentId}" đang suy nghĩ bước ${step}/${MAX_STEPS_PER_TASK}...`);
      const decision = await decideAgentAction(agentId, task, stepHistory);

      if (decision.action === "NONE") {
        await concludeTask(
          decision.note,
          stepHistory.length > 0 ? "COMPLETED_MULTI_STEP" : "COMPLETED_NO_TOOL"
        );
        break;
      }

      if (decision.action === "NEED_INFO") {
        console.warn(`[agentWorker] Task "${task.title}" cần thêm thông tin: ${decision.note}`);
        await logAudit({ agentId, taskId: task.id, action: "NEED_INFO", resultSummary: decision.note });
        await db.task.update({ where: { id: task.id }, data: { status: "BLOCKED" } });
        const fresh = await db.agent.findUnique({ where: { id: agentId } });
        if (fresh && fresh.status !== "SUSPENDED") {
          await db.agent.update({ where: { id: agentId }, data: { status: "READY" } });
        }
        break;
      }

      // CALL_TOOL
      console.log(`[agentWorker] [Bước ${step}] Agent "${agentId}" gọi tool "${decision.toolId}"`);
      const toolRow = await db.tool.findUnique({ where: { id: decision.toolId } });
      if (toolRow && (toolRow.riskLevel === "R3" || toolRow.riskLevel === "R4")) {
        executedHighRiskTool = true;
      }

      const result = await toolGateway.execute(agentId, decision.toolId, task.id, decision.params);

      if (result.status === "AWAITING_APPROVAL") {
        console.log(
          `[agentWorker] Tool "${decision.toolId}" cần Founder duyệt — task AWAITING_APPROVAL.` +
            ` DecisionPackage: ${result.decisionPackageId}`
        );
        await db.task.update({ where: { id: task.id }, data: { status: "AWAITING_APPROVAL" } });
        broadcastCompanyEvent({
          type: "DECISION_REQUIRED",
          payload: { decisionPackageId: result.decisionPackageId, taskId: task.id, agentId },
        });
        break;
      }

      if (result.status === "SUCCESS") {
        const summary =
          typeof result.data === "string"
            ? result.data
            : JSON.stringify(result.data ?? {}).slice(0, 400);

        stepHistory.push({
          step,
          toolId: decision.toolId,
          params: decision.params,
          resultSummary: summary,
        });
        console.log(`[agentWorker] [Bước ${step}] Tool "${decision.toolId}" thành công. Tiếp tục vòng suy luận...`);
      } else {
        // FAILED / BLOCKED_NO_PERMISSION
        console.warn(`[agentWorker] [Bước ${step}] Tool "${decision.toolId}" thất bại — task BLOCKED.`);
        await db.task.update({ where: { id: task.id }, data: { status: "BLOCKED" } });
        const fresh = await db.agent.findUnique({ where: { id: agentId } });
        if (fresh && fresh.status !== "SUSPENDED") {
          await db.agent.update({ where: { id: agentId }, data: { status: "READY" } });
        }
        break;
      }

      // Nếu đã chạy đến bước tối đa mà chưa xong, tự động tổng kết
      if (step === MAX_STEPS_PER_TASK) {
        console.log(`[agentWorker] Đạt giới hạn ${MAX_STEPS_PER_TASK} bước — tự động tổng kết task.`);
        await concludeTask(
          `Đã hoàn thành sau ${MAX_STEPS_PER_TASK} bước tool: ${stepHistory.map((s) => s.toolId).join(" → ")}`,
          "COMPLETED_MAX_STEPS"
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agentWorker] Lỗi khi xử lý task "${task.title}":`, err);
    await logAudit({ agentId, taskId: task.id, action: "AGENT_ERROR", resultSummary: message });
    await db.task.update({ where: { id: task.id }, data: { status: "BLOCKED" } });
    const fresh = await db.agent.findUnique({ where: { id: agentId } });
    if (fresh && fresh.status !== "SUSPENDED") {
      await db.agent.update({ where: { id: agentId }, data: { status: "READY" } });
    }
  }

  await broadcastTask(task.id);
  await broadcastAgent(agentId);
}

/** Chạy 1 vòng: lấy tối đa MAX_TASKS_PER_TICK task ASSIGNED và xử lý tuần tự. */
async function processAssignedTasks(): Promise<void> {
  if (isProcessing) return; // tránh chạy chồng lấn giữa các tick
  isProcessing = true;
  try {
    const tasks = await db.task.findMany({
      where: { status: "ASSIGNED" },
      orderBy: { createdAt: "asc" },
      take: MAX_TASKS_PER_TICK,
    });

    // VQ-3(i) — Queue freeze: task ASSIGNED của agent đang SUSPENDED được
    // BỎ QUA ở vòng này — giữ task ở ASSIGNED (KHÔNG đánh BLOCKED), không gọi
    // model, không chạy tool, KHÔNG ghi audit; task tự chạy lại khi Founder
    // re-staff agent về READY. (Lớp phòng vệ thứ 2 nằm trong processOneTask
    // cho task đã bị pick trước lệnh /stop — 2 đường tồn tại song hành.)
    const agentStatusCache = new Map<string, string>();
    for (const task of tasks) {
      if (!task.assignedTo) continue;
      const assignedTo: string = task.assignedTo;
      let agentStatus = agentStatusCache.get(assignedTo);
      if (agentStatus === undefined) {
        const agent = await db.agent.findUnique({ where: { id: assignedTo } });
        const resolvedStatus: string = agent?.status ?? "NOT_FOUND";
        agentStatusCache.set(assignedTo, resolvedStatus);
        agentStatus = resolvedStatus;
      }
      if (agentStatus === "SUSPENDED") continue; // freeze — giữ nguyên ASSIGNED
      await processOneTask(task);
    }
  } catch (err) {
    console.error("[agentWorker] Lỗi vòng xử lý:", err);
  } finally {
    isProcessing = false;
  }
}

export function startAgentWorker(): void {
  const pollMs = env.agentWorkerPollMs;
  console.log(`[agentWorker] Bắt đầu poll task ASSIGNED mỗi ${pollMs}ms`);

  const interval = setInterval(() => {
    void processAssignedTasks();
  }, pollMs);

  // Graceful shutdown
  const stop = () => {
    clearInterval(interval);
    console.log("[agentWorker] Đã dừng.");
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
