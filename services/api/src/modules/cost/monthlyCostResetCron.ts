/**
 * Monthly Cost Reset Cron — tự động kiểm tra và reset chi phí tích lũy
 * `monthlyCostUsd` của toàn bộ Agent về $0 vào đầu mỗi tháng mới:
 * 1. Ghi nhận snapshot chi phí tháng trước vào Audit Log
 * 2. Cập nhật monthlyCostUsd = 0 cho tất cả Agent
 * 3. Phát WebSocket event AGENT_STATUS để UI cập nhật ngay
 */
import { db } from "../../db/client";
import { broadcastCompanyEvent } from "../../ws/gateway";
import { logAudit } from "../audit/auditLogger";

let lastCheckedMonth = new Date().toISOString().slice(0, 7); // Format: "YYYY-MM"

export async function checkAndResetMonthlyCost(): Promise<boolean> {
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Nếu vẫn trong cùng một tháng -> không cần reset
  if (currentMonth === lastCheckedMonth) {
    return false;
  }

  console.log(`[MonthlyCron] Phát hiện tháng mới: ${currentMonth} (tháng trước: ${lastCheckedMonth}). Bắt đầu kết chuyển chi phí...`);

  const agents = await db.agent.findMany();
  const totalCostBeforeReset = agents.reduce((acc: number, a: { monthlyCostUsd: number }) => acc + (a.monthlyCostUsd || 0), 0);

  // 1. Ghi Audit Log lưu lại snapshot chi phí của tháng cũ
  await logAudit({
    action: "MONTHLY_COST_ROLLOVER",
    resultSummary: `Tự động kết chuyển chi phí tháng ${lastCheckedMonth} sang tháng ${currentMonth}: Tổng chi phí đã ghi nhận là $${totalCostBeforeReset.toFixed(4)} USD qua ${agents.length} Agent.`,
    riskLevel: "R1",
  });

  // 2. Reset monthlyCostUsd về 0 cho tất cả Agent
  await db.agent.updateMany({
    data: { monthlyCostUsd: 0 },
  });

  console.log(`[MonthlyCron] Đã reset monthlyCostUsd về $0 cho ${agents.length} Agent.`);

  // 3. Phát sự kiện WebSocket cho client
  const updatedAgents = await db.agent.findMany();
  for (const agent of updatedAgents) {
    broadcastCompanyEvent({
      type: "AGENT_STATUS",
      payload: agent,
    });
  }

  lastCheckedMonth = currentMonth;
  return true;
}

export function startMonthlyCostResetCron(intervalMs = 60000 * 30): void {
  console.log("[MonthlyCron] Khởi chạy dịch vụ tự động reset chi phí hàng tháng...");

  // Kiểm tra ngay khi server khởi động
  void checkAndResetMonthlyCost();

  // Kiểm tra định kỳ (mỗi 30 phút)
  const interval = setInterval(() => {
    void checkAndResetMonthlyCost();
  }, intervalMs);

  const stop = () => {
    clearInterval(interval);
    console.log("[MonthlyCron] Đã dừng cron reset chi phí.");
  };

  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
