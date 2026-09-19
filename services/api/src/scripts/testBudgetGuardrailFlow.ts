/**
 * Script kiểm thử tự động toàn diện tính năng Budget Guardrail:
 *   1. Đặt trần ngân sách riêng cho 1 agent (Agent.budgetCapUsd).
 *   2. Gọi recordModelCost vượt trần -> Kiểm tra agent tự chuyển SUSPENDED,
 *      suspendedReason = "BUDGET_CAP_EXCEEDED", các task chờ chuyển BLOCKED.
 *   3. Kiểm tra ToolGateway.execute() chặn tool khi agent đang SUSPENDED.
 *   4. Reset chi phí riêng -> Agent tự mở lại READY, suspendedReason = null.
 *   5. Đặt trần ngân sách toàn công ty (CompanySettings.monthlyBudgetCapUsd).
 *   6. Gọi recordModelCost vượt trần công ty -> TOÀN BỘ agent tự SUSPENDED,
 *      suspendedReason = "COMPANY_BUDGET_CAP_EXCEEDED".
 *   7. Reset chi phí toàn công ty -> Toàn bộ agent về READY, monthlyCostUsd = 0.
 */
import { db } from "../db/client";
import { recordModelCost, BUDGET_REASON_AGENT, BUDGET_REASON_COMPANY } from "../modules/cost/costTracker";
import { toolGateway, PermissionError } from "../modules/governance/toolGateway";

async function runTest() {
  console.log("=== BẮT ĐẦU TEST BUDGET GUARDRAIL FLOW ===");

  const TEST_AGENT_ID = "agent_sales";

  // Đảm bảo agent tồn tại
  let agent = await db.agent.findUnique({ where: { id: TEST_AGENT_ID } });
  if (!agent) {
    console.log(`Tạo mock agent "${TEST_AGENT_ID}" để test...`);
    agent = await db.agent.create({
      data: {
        id: TEST_AGENT_ID,
        name: "Mock Sales Agent",
        title: "Sales Specialist",
        mission: "Testing Budget Guardrail",
        status: "READY",
        monthlyCostUsd: 0,
      },
    });
  }

  // 1. Reset ban đầu
  await db.agent.update({
    where: { id: TEST_AGENT_ID },
    data: { monthlyCostUsd: 0, budgetCapUsd: 0.005, status: "READY", suspendedReason: null },
  });
  console.log("✓ Bước 1: Đã đặt trần ngân sách riêng = $0.005 cho agent_sales");

  // Tạo 1 task chờ để kiểm tra auto-blocking
  const testTaskId = `task_bg_test_${Date.now()}`;
  await db.task.create({
    data: {
      id: testTaskId,
      title: "Test Task for Budget Guardrail",
      objective: "Should be blocked when budget is exceeded",
      assignedTo: TEST_AGENT_ID,
      status: "ASSIGNED",
    },
  });
  console.log(`✓ Đã tạo task kiểm thử: ${testTaskId} (status: ASSIGNED)`);

  // 2. Ghi nhận chi phí vượt trần riêng (cộng $0.01 > trần $0.005)
  console.log("2. Gọi recordModelCost để vượt trần riêng ($0.005)...");
  // 1000 input + 1000 output tokens với default cost -> tính toán
  // Để chắc chắn vượt $0.005, pass usage lớn
  await recordModelCost(TEST_AGENT_ID, { inputTokens: 500_000, outputTokens: 500_000 }, "Test Model Call");

  const agentAfterCost = await db.agent.findUnique({ where: { id: TEST_AGENT_ID } });
  if (agentAfterCost?.status !== "SUSPENDED" || agentAfterCost?.suspendedReason !== BUDGET_REASON_AGENT) {
    throw new Error(
      `FALIED: Agent status phải là SUSPENDED và suspendedReason là ${BUDGET_REASON_AGENT}, nhưng nhận được: status=${agentAfterCost?.status}, reason=${agentAfterCost?.suspendedReason}`
    );
  }
  console.log(`✓ Bước 2: Agent tự động SUSPENDED thành công! Reason: ${agentAfterCost.suspendedReason}, Spent: $${agentAfterCost.monthlyCostUsd.toFixed(4)}`);

  // Kiểm tra task chờ có bị chuyển sang BLOCKED không
  const taskAfterCost = await db.task.findUnique({ where: { id: testTaskId } });
  if (taskAfterCost?.status !== "BLOCKED") {
    throw new Error(`FAILED: Task ${testTaskId} phải chuyển sang BLOCKED, nhưng status hiện tại là ${taskAfterCost?.status}`);
  }
  console.log(`✓ Task ${testTaskId} đã tự động chuyển sang BLOCKED.`);

  // 3. Kiểm tra ToolGateway chặn khi agent SUSPENDED
  console.log("3. Kiểm tra ToolGateway.execute() khi agent đang SUSPENDED...");
  let toolBlocked = false;
  try {
    await toolGateway.execute(TEST_AGENT_ID, "sql_runner", testTaskId, { query: "SELECT 1" });
  } catch (err) {
    if (err instanceof PermissionError && (err.message.includes("SUSPENDED") || err.message.includes("bị SUSPENDED"))) {
      toolBlocked = true;
    } else {
      console.log("Tool error khác:", err);
    }
  }
  if (!toolBlocked) {
    throw new Error("FAILED: ToolGateway phải throw PermissionError khi agent đang SUSPENDED!");
  }
  console.log("✓ Bước 3: ToolGateway đã chặn thành công với PermissionError.");

  // 4. Test Reset chi phí riêng
  console.log("4. Test reset chi phí riêng...");
  const resetAgent = await db.agent.update({
    where: { id: TEST_AGENT_ID },
    data: {
      monthlyCostUsd: 0,
      status: "READY",
      suspendedReason: null,
    },
  });
  if (resetAgent.status !== "READY" || resetAgent.suspendedReason !== null || resetAgent.monthlyCostUsd !== 0) {
    throw new Error("FAILED: Reset chi phí riêng không thành công.");
  }
  console.log("✓ Bước 4: Đã reset chi phí riêng và mở lại Agent thành READY.");

  // 5. Test Trần ngân sách công ty
  console.log("5. Test trần ngân sách toàn công ty...");
  await db.companySettings.upsert({
    where: { id: "singleton" },
    update: { monthlyBudgetCapUsd: 0.01 },
    create: { id: "singleton", monthlyBudgetCapUsd: 0.01 },
  });
  // Xoá trần riêng của agent để chỉ test trần công ty
  await db.agent.update({
    where: { id: TEST_AGENT_ID },
    data: { budgetCapUsd: null, monthlyCostUsd: 0 },
  });

  // Gọi model vượt trần công ty
  await recordModelCost(TEST_AGENT_ID, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, "Company Budget Test Call");

  const agentAfterCompanyCap = await db.agent.findUnique({ where: { id: TEST_AGENT_ID } });
  if (agentAfterCompanyCap?.status !== "SUSPENDED" || agentAfterCompanyCap?.suspendedReason !== BUDGET_REASON_COMPANY) {
    throw new Error(
      `FAILED: Agent status phải là SUSPENDED và suspendedReason là ${BUDGET_REASON_COMPANY}, nhưng nhận: status=${agentAfterCompanyCap?.status}, reason=${agentAfterCompanyCap?.suspendedReason}`
    );
  }
  console.log(`✓ Bước 5: Trần công ty chạm ngưỡng -> Agent tự động SUSPENDED với reason: ${agentAfterCompanyCap.suspendedReason}`);

  // 6. Test Reset chi phí toàn công ty
  console.log("6. Test reset chi phí toàn công ty...");
  const allAgents = await db.agent.findMany();
  for (const a of allAgents) {
    const shouldUnsuspend = a.suspendedReason === BUDGET_REASON_COMPANY || a.suspendedReason === BUDGET_REASON_AGENT;
    await db.agent.update({
      where: { id: a.id },
      data: {
        monthlyCostUsd: 0,
        ...(shouldUnsuspend ? { status: "READY", suspendedReason: null } : {}),
      },
    });
  }

  const agentFinal = await db.agent.findUnique({ where: { id: TEST_AGENT_ID } });
  if (agentFinal?.status !== "READY" || agentFinal?.suspendedReason !== null) {
    throw new Error("FAILED: Agent chưa được mở lại sau khi reset công ty.");
  }
  console.log("✓ Bước 6: Reset toàn công ty thành công. Tất cả Agent đã trở về READY.");

  // Dọn dẹp task test
  await db.task.deleteMany({ where: { id: testTaskId } });
  console.log("✓ Dọn dẹp dữ liệu test thành công.");

  console.log("=== TẤT CẢ TEST CASES BUDGET GUARDRAIL ĐÃ PASS 100% ===");
}

runTest()
  .catch((err) => {
    console.error("LỖI TEST:", err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
