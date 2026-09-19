/**
 * PeriodicJobs — vòng lặp nền (poll, giống agentWorker) chạy 4 việc:
 *   1. checkBlockedTasks() — báo Founder nếu 1 task bị BLOCKED quá lâu.
 *   2. checkWeeklyReportDue() — tự gửi Weekly Report vào sáng thứ 2 hàng tuần.
 *   3. checkStuckRunningTasks() — SLA: task RUNNING quá lâu (thường do server
 *      restart giữa chừng, hoặc 1 lần gọi model bị treo) -> tự ESCALATED,
 *      trả Agent về READY, báo Founder. Chỉ escalate 1 lần/task.
 *   4. checkStuckDecisions() — SLA: Decision Package PENDING quá lâu (Founder
 *      chưa duyệt) -> KHÔNG tự đổi status của Decision (không được tự động
 *      approve/reject hành động rủi ro — vi phạm nguyên tắc Founder Approval),
 *      mà nhắc lại Founder định kỳ + đánh dấu Task liên quan (nếu có) ESCALATED
 *      để hiện rõ trên Task Kanban.
 *
 * Cả 4 job đều dùng Audit Log làm "dấu" chống báo trùng lặp — không cần thêm
 * cột DB riêng để track trạng thái đã-báo-hay-chưa.
 */
import { db } from "../../db/client";
import { env } from "../../config/env";
import { notifyFounder } from "./notifier";
import { generateWeeklyReportText } from "../reports/weeklyReport";
import { logAudit } from "../audit/auditLogger";
import { broadcastCompanyEvent } from "../../ws/gateway";
import type { RiskLevel } from "@ai-opc/shared";

// ---- 1. Blocked task alert -------------------------------------------------

async function checkBlockedTasks(): Promise<void> {
  const cutoff = new Date(Date.now() - env.blockedTaskAlertMinutes * 60 * 1000);
  const blockedTasks = await db.task.findMany({
    where: { status: "BLOCKED", updatedAt: { lte: cutoff } },
  });

  for (const task of blockedTasks) {
    const alreadyNotified = await db.auditLog.findFirst({
      where: { taskId: task.id, action: "BLOCKED_TASK_ALERT" },
    });
    if (alreadyNotified) continue;

    await notifyFounder({
      category: "BLOCKED_TASK",
      title: `Task bị Blocked quá ${env.blockedTaskAlertMinutes} phút`,
      message: `"${task.title}"\n\n${task.objective}\n\nAgent phụ trách: ${task.assignedTo ?? "chưa gán"}`,
      severity: "warning",
    });
    await logAudit({
      taskId: task.id,
      action: "BLOCKED_TASK_ALERT",
      resultSummary: "Đã báo Founder — task bị Blocked quá lâu chưa xử lý",
    });
  }
}

// ---- 2. Weekly report tự động ----------------------------------------------

function getIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

async function checkWeeklyReportDue(): Promise<void> {
  const now = new Date();
  const isMonday = now.getDay() === 1;
  const isMorningWindow = now.getHours() >= 8 && now.getHours() < 10; // 8h-10h sáng thứ 2
  if (!isMonday || !isMorningWindow) return;

  const weekKey = getIsoWeekKey(now);
  const alreadySent = await db.auditLog.findFirst({
    where: { action: "WEEKLY_REPORT_AUTO_SENT", resultSummary: { contains: weekKey } },
  });
  if (alreadySent) return;

  const reportText = await generateWeeklyReportText();
  await notifyFounder({
    category: "WEEKLY_REPORT",
    title: "Weekly Report sẵn sàng",
    message: reportText,
    severity: "info",
  });
  await logAudit({ action: "WEEKLY_REPORT_AUTO_SENT", resultSummary: `Tuần ${weekKey}` });
}

// ---- 3. SLA: Task RUNNING treo quá lâu -------------------------------------

async function checkStuckRunningTasks(): Promise<void> {
  const cutoff = new Date(Date.now() - env.slaTaskRunningMinutes * 60 * 1000);
  const stuckTasks = await db.task.findMany({
    where: { status: "RUNNING", updatedAt: { lte: cutoff } },
  });

  for (const task of stuckTasks) {
    // Chỉ escalate 1 lần/task — dùng action riêng (khác BLOCKED_TASK_ALERT)
    // để 2 loại cảnh báo không lẫn vào nhau khi dò trùng lặp.
    const alreadyEscalated = await db.auditLog.findFirst({
      where: { taskId: task.id, action: "TASK_ESCALATED_STUCK" },
    });
    if (alreadyEscalated) continue;

    const updatedTask = await db.task.update({ where: { id: task.id }, data: { status: "ESCALATED" } });
    broadcastCompanyEvent({ type: "TASK_UPDATED", payload: updatedTask });

    // Trả Agent về READY nếu nó vẫn đang hiện RUNNING (không đụng nếu đã
    // SUSPENDED do Budget Guardrail — không được vô tình mở khoá agent đó).
    if (task.assignedTo) {
      const agent = await db.agent.findUnique({ where: { id: task.assignedTo } });
      if (agent?.status === "RUNNING") {
        const updatedAgent = await db.agent.update({ where: { id: task.assignedTo }, data: { status: "READY" } });
        broadcastCompanyEvent({ type: "AGENT_STATUS", payload: updatedAgent });
      }
    }

    await notifyFounder({
      category: "BLOCKED_TASK",
      title: `⏰ Task treo quá ${env.slaTaskRunningMinutes} phút`,
      message:
        `"${task.title}"\n\n${task.objective}\n\nAgent: ${task.assignedTo ?? "chưa gán"}\n\n` +
        'Có thể do server restart giữa chừng hoặc 1 lần gọi model bị treo. ' +
        'Vào trang chi tiết Agent xem log, hoặc bấm "Requeue" trên Task Kanban để chạy lại.',
      severity: "warning",
    });

    await logAudit({
      agentId: task.assignedTo,
      taskId: task.id,
      action: "TASK_ESCALATED_STUCK",
      resultSummary: `Task RUNNING quá ${env.slaTaskRunningMinutes} phút không hoàn thành — tự động ESCALATED`,
    });
  }
}

// ---- 4. SLA: Decision PENDING quá hạn --------------------------------------

async function checkStuckDecisions(): Promise<void> {
  const cutoff = new Date(Date.now() - env.slaDecisionPendingMinutes * 60 * 1000);
  const stuckDecisions = await db.decisionPackage.findMany({
    where: { status: "PENDING", createdAt: { lte: cutoff } },
  });

  for (const decision of stuckDecisions) {
    // Nhắc lại định kỳ (không chỉ 1 lần) — chỉ báo lại nếu lần escalate gần
    // nhất đã cách đây quá `slaDecisionPendingMinutes`, để không im lặng bỏ
    // quên 1 quyết định rủi ro cao chưa ai xử lý.
    const lastEscalation = await db.auditLog.findFirst({
      where: { action: "DECISION_ESCALATED", resultSummary: { contains: decision.id } },
      orderBy: { timestamp: "desc" },
    });
    if (lastEscalation && lastEscalation.timestamp > cutoff) continue;

    const ageMinutes = Math.round((Date.now() - decision.createdAt.getTime()) / 60000);

    await notifyFounder({
      category: "DECISION",
      title: `⏰ Decision chờ duyệt quá ${ageMinutes} phút`,
      message: `"${decision.decisionTitle}"\nRisk: ${decision.riskLevel}\n\n${decision.reason}\n\nVào Web app (cột "Chờ phê duyệt") để xử lý.`,
      severity: "critical",
    });

    await logAudit({
      taskId: decision.taskId,
      agentId: decision.agentId,
      action: "DECISION_ESCALATED",
      resultSummary: `Decision ${decision.id} chờ duyệt ${ageMinutes} phút, đã nhắc Founder`,
      riskLevel: decision.riskLevel as RiskLevel,
    });

    // KHÔNG tự đổi status của Decision Package — chỉ Founder mới được quyết
    // định approve/reject hành động rủi ro. Đánh dấu Task liên quan (nếu có)
    // ESCALATED để Founder thấy rõ trên Task Kanban có việc đang chờ gấp.
    if (decision.taskId) {
      const task = await db.task.findUnique({ where: { id: decision.taskId } });
      if (task && task.status !== "ESCALATED") {
        const updated = await db.task.update({ where: { id: decision.taskId }, data: { status: "ESCALATED" } });
        broadcastCompanyEvent({ type: "TASK_UPDATED", payload: updated });
      }
    }
  }
}

// ---- Orchestrate toàn bộ job ------------------------------------------------

export async function runPeriodicJobs(): Promise<void> {
  try {
    await checkBlockedTasks();
    await checkWeeklyReportDue();
    await checkStuckRunningTasks();
    await checkStuckDecisions();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[periodicJobs] Lỗi:", err);
  }
}

export function startPeriodicJobs(intervalMs: number): NodeJS.Timeout {
  // eslint-disable-next-line no-console
  console.log(`[periodicJobs] Bắt đầu kiểm tra Blocked/Stuck/Report mỗi ${intervalMs}ms`);
  return setInterval(() => {
    void runPeriodicJobs();
  }, intervalMs);
}
