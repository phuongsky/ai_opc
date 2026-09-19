import { db } from "../db/client";

async function main() {
  const tasks = await db.task.findMany({
    select: { id: true, title: true, result: true },
  });
  console.log("=== TASKS ===");
  for (const t of tasks) {
    console.log(`Task ${t.id}:`);
    console.log(`Result:`, JSON.stringify(t.result));
  }

  const logs = await db.auditLog.findMany({
    where: {
      action: { in: ["COMPLETED_NO_TOOL", "COMPLETED_MULTI_STEP", "COMPLETED_MAX_STEPS", "SUCCESS"] },
    },
    select: { taskId: true, action: true, resultSummary: true },
    take: 5,
  });
  console.log("=== LOGS ===");
  for (const l of logs) {
    console.log(`Log for Task ${l.taskId} (${l.action}):`);
    console.log("resultSummary:", JSON.stringify(l.resultSummary));
  }
}

main().catch(console.error).finally(() => db.$disconnect());
