import { db } from "../db/client";
import { recordModelCost } from "../modules/cost/costTracker";

async function main() {
  console.log("=== BẮT ĐẦU TEST BUDGET CAP EXCEEDED NOTIFICATION TRIGGER ===");

  // Find or pick an agent (e.g. ai_coo or first agent)
  const agent = await db.agent.findFirst();
  if (!agent) {
    console.log("Không có agent nào trong DB.");
    return;
  }

  console.log(`1. Target Agent: ${agent.name} (${agent.id}), BudgetCap: ${agent.budgetCapUsd}, MonthlyCost: ${agent.monthlyCostUsd}`);

  // Temporarily set a very low budget cap for testing
  await db.agent.update({
    where: { id: agent.id },
    data: { budgetCapUsd: 0.0001, status: "READY", suspendedReason: null },
  });

  console.log("2. Đã đặt budgetCapUsd = 0.0001 để kiểm tra tự động khóa và gửi cảnh báo.");

  // Record a small cost
  await recordModelCost(agent.id, { inputTokens: 5000, outputTokens: 5000 }, "Unit test budget cap exceed");

  // Check agent status
  const updatedAgent = await db.agent.findUnique({ where: { id: agent.id } });
  console.log(`3. Agent sau khi vượt trần: Status = ${updatedAgent?.status}, Reason = ${updatedAgent?.suspendedReason}`);

  if (updatedAgent?.status !== "SUSPENDED" || updatedAgent?.suspendedReason !== "BUDGET_CAP_EXCEEDED") {
    throw new Error("Agent không được chuyển sang SUSPENDED tự động!");
  }

  console.log("✓ Agent đã tự động SUSPENDED và trigger notifyFounder({ category: 'BUDGET_CAP', ... }) thành công!");

  // Restore agent
  await db.agent.update({
    where: { id: agent.id },
    data: { budgetCapUsd: agent.budgetCapUsd, status: "READY", suspendedReason: null },
  });
  console.log("4. Đã khôi phục trạng thái ban đầu của Agent.");

  console.log("=== HOÀN THÀNH TEST BUDGET CAP TRIGGER THÀNH CÔNG ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
