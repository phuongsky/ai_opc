/**
 * Weekly Report — tổng hợp tình hình công ty 7 ngày qua, dùng chung cho:
 *   1. Lệnh Founder Command `/report weekly` (chủ động gọi, xem commandParser.ts)
 *   2. Tự động gửi mỗi sáng thứ 2 (xem modules/notifications/periodicJobs.ts)
 */
import { db } from "../../db/client";

export async function generateWeeklyReportText(): Promise<string> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [completedTasks, blockedTasksNow, pendingDecisions, approvedDecisions, rejectedDecisions, agents] =
    await Promise.all([
      db.task.count({ where: { status: "COMPLETED", completedAt: { gte: since } } }),
      db.task.count({ where: { status: "BLOCKED" } }),
      db.decisionPackage.count({ where: { status: "PENDING" } }),
      db.decisionPackage.count({ where: { status: "APPROVED", decidedAt: { gte: since } } }),
      db.decisionPackage.count({ where: { status: "REJECTED", decidedAt: { gte: since } } }),
      db.agent.findMany(),
    ]);

  const totalCost = agents.reduce((sum: number, a: { monthlyCostUsd: number | null }) => sum + Number(a.monthlyCostUsd || 0), 0);
  const suspendedAgents = agents.filter((a: { status: string }) => a.status === "SUSPENDED");

  const lines = [
    "📊 *Weekly Report — AI-OPC Company OS*",
    `${since.toLocaleDateString("vi-VN")} → ${new Date().toLocaleDateString("vi-VN")}`,
    "",
    `✅ Task hoàn thành (7 ngày qua): ${completedTasks}`,
    `🚫 Task đang Blocked (hiện tại): ${blockedTasksNow}`,
    `⏳ Decision chờ duyệt (hiện tại): ${pendingDecisions}`,
    `👍 Decision đã duyệt (7 ngày qua): ${approvedDecisions}`,
    `👎 Decision đã từ chối (7 ngày qua): ${rejectedDecisions}`,
    `💰 Tổng chi phí AI tích luỹ: $${totalCost.toFixed(2)}`,
  ];

  if (suspendedAgents.length > 0) {
    lines.push(
      "",
      `⚠️ ${suspendedAgents.length} Agent đang SUSPENDED: ${suspendedAgents.map((a: { name: string }) => a.name).join(", ")}`
    );
  }

  return lines.join("\n");
}
