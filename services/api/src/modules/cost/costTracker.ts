/**
 * CostTracker — tính chi phí THẬT (USD) từ token usage, cộng dồn vào
 * Agent.monthlyCostUsd, và enforce BUDGET GUARDRAIL: tự động SUSPEND agent
 * (hoặc toàn công ty) ngay khi chạm trần chi tiêu, để 1 lỗi logic (agent loop
 * gọi model liên tục) không đốt hết ngân sách qua đêm.
 *
 * 2 tầng trần, kiểm tra sau MỖI lần cộng chi phí:
 *   1. Agent.budgetCapUsd — trần riêng 1 agent, chỉ suspend đúng agent đó.
 *   2. CompanySettings.monthlyBudgetCapUsd — trần tổng công ty, suspend TẤT CẢ.
 *
 * Dùng `suspendedReason` để phân biệt "Founder tự bấm /stop" (suspendedReason
 * = null) với "tự động do vượt ngân sách" (suspendedReason có giá trị) — nhờ
 * vậy reset ngân sách sẽ tự mở lại ĐÚNG agent bị khoá vì tiền, không đụng tới
 * agent mà Founder cố tình dừng bằng /stop.
 */
import { db } from "../../db/client";
import { env } from "../../config/env";
import { logAudit } from "../audit/auditLogger";
import { broadcastCompanyEvent } from "../../ws/gateway";
import { notifyFounder } from "../notifications/notifier";
import type { TokenUsage } from "../../lib/llm";

export const BUDGET_REASON_AGENT = "BUDGET_CAP_EXCEEDED";
export const BUDGET_REASON_COMPANY = "COMPANY_BUDGET_CAP_EXCEEDED";

export function estimateCostUsd(usage: TokenUsage): number {
  const inputCost = (usage.inputTokens / 1_000_000) * env.costInputPerMTok;
  const outputCost = (usage.outputTokens / 1_000_000) * env.costOutputPerMTok;
  return inputCost + outputCost;
}

async function getCompanyBudgetCap(): Promise<number | null> {
  const settings = await db.companySettings.findUnique({ where: { id: "singleton" } });
  return settings?.monthlyBudgetCapUsd ?? null;
}

/** Chặn mọi task chưa chạy xong của agent, đánh dấu BLOCKED kèm lý do rõ ràng. */
async function blockPendingTasksForAgent(agentId: string): Promise<void> {
  const pending = await db.task.findMany({
    where: { assignedTo: agentId, status: { in: ["NEW", "TRIAGED", "PLANNED", "ASSIGNED"] } },
  });
  for (const t of pending) {
    const updated = await db.task.update({ where: { id: t.id }, data: { status: "BLOCKED" } });
    broadcastCompanyEvent({ type: "TASK_UPDATED", payload: updated });
  }
}

async function suspendAgentForBudget(agentId: string, capUsd: number, spentUsd: number): Promise<void> {
  const agent = await db.agent.update({
    where: { id: agentId },
    data: { status: "SUSPENDED", suspendedReason: BUDGET_REASON_AGENT },
  });
  const summary =
    `Agent vượt trần ngân sách riêng ($${spentUsd.toFixed(2)} / $${capUsd.toFixed(2)}) — ` +
    "tự động SUSPENDED. Founder vào trang chi tiết Agent để tăng trần hoặc reset chi phí.";
  await logAudit({
    agentId,
    action: "BUDGET_CAP_EXCEEDED",
    resultSummary: summary,
  });
  broadcastCompanyEvent({ type: "AGENT_STATUS", payload: agent });
  await blockPendingTasksForAgent(agentId);

  void notifyFounder({
    category: "BUDGET_CAP",
    severity: "warning",
    title: "BUDGET CAP EXCEEDED",
    message: `Agent "${agent.name}" (${agent.id}) vượt trần ngân sách riêng ($${spentUsd.toFixed(2)} / $${capUsd.toFixed(2)}) — tự động SUSPENDED.\n\nFounder vào trang chi tiết Agent để tăng trần hoặc reset chi phí.`,
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[CostTracker] Gửi thông báo vượt ngân sách agent lỗi:", err);
  });
}

async function suspendAllAgentsForCompanyBudget(capUsd: number, spentUsd: number): Promise<void> {
  const agents = await db.agent.findMany({ where: { status: { not: "SUSPENDED" } } });
  for (const a of agents) {
    const updated = await db.agent.update({
      where: { id: a.id },
      data: { status: "SUSPENDED", suspendedReason: BUDGET_REASON_COMPANY },
    });
    broadcastCompanyEvent({ type: "AGENT_STATUS", payload: updated });
    await blockPendingTasksForAgent(a.id);
  }
  const summary =
    `Tổng chi phí AI công ty vượt trần ($${spentUsd.toFixed(2)} / $${capUsd.toFixed(2)}) — ` +
    "TOÀN BỘ Agent đã SUSPENDED. Vào trang Cài đặt để tăng trần hoặc reset chi phí công ty.";
  await logAudit({
    action: "COMPANY_BUDGET_CAP_EXCEEDED",
    resultSummary: summary,
  });

  void notifyFounder({
    category: "BUDGET_CAP",
    severity: "critical",
    title: "COMPANY BUDGET CAP EXCEEDED",
    message: `Tổng chi phí AI toàn công ty vượt trần ($${spentUsd.toFixed(2)} / $${capUsd.toFixed(2)}) — TOÀN BỘ Agent đã SUSPENDED.\n\nFounder vào trang Cài đặt để tăng trần hoặc reset chi phí công ty.`,
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[CostTracker] Gửi thông báo vượt ngân sách công ty lỗi:", err);
  });
}

/**
 * Kiểm tra 2 tầng trần ngay sau khi cộng chi phí cho 1 agent. Không throw —
 * lỗi ở guardrail không được phép làm crash luồng cost tracking chính.
 */
async function enforceBudgetGuardrail(agentId: string): Promise<void> {
  try {
    const agent = await db.agent.findUnique({ where: { id: agentId } });
    if (!agent) return;

    if (
      agent.budgetCapUsd != null &&
      agent.status !== "SUSPENDED" &&
      Number(agent.monthlyCostUsd) >= agent.budgetCapUsd
    ) {
      await suspendAgentForBudget(agentId, agent.budgetCapUsd, Number(agent.monthlyCostUsd));
    }

    const companyCap = await getCompanyBudgetCap();
    if (companyCap != null) {
      const totalSpent = await db.agent.aggregate({ _sum: { monthlyCostUsd: true } });
      const total = Number(totalSpent._sum.monthlyCostUsd ?? 0);
      if (total >= companyCap) {
        await suspendAllAgentsForCompanyBudget(companyCap, total);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[CostTracker] Lỗi khi kiểm tra Budget Guardrail:", err);
  }
}

/**
 * Cộng dồn chi phí 1 lần gọi model vào đúng Agent (Orchestrator dùng agentId
 * "ai_coo"), rồi kiểm tra Budget Guardrail ngay sau đó.
 */
export async function recordModelCost(
  agentId: string,
  usage: TokenUsage,
  context: string
): Promise<number> {
  const costUsd = estimateCostUsd(usage);

  const agent = await db.agent.update({
    where: { id: agentId },
    data: { monthlyCostUsd: { increment: costUsd } },
  });

  await logAudit({
    agentId,
    action: "MODEL_CALL_COST",
    resultSummary: `${context} — ${usage.inputTokens} input + ${usage.outputTokens} output token ≈ $${costUsd.toFixed(4)}`,
  });

  broadcastCompanyEvent({ type: "AGENT_STATUS", payload: agent });

  await enforceBudgetGuardrail(agentId);

  return costUsd;
}
