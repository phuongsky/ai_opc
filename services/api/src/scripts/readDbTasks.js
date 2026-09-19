const fs = require("fs");
const path = require("path");

// Read directly from audit logs or tasks using sqlite3 if available or client
const { PrismaClient } = require("../../node_modules/.prisma/client-sqlite");
const prisma = new PrismaClient();

async function main() {
  const tasks = await prisma.task.findMany();
  console.log("Found", tasks.length, "tasks in DB:");
  for (const t of tasks) {
    console.log(`- Task #${t.id}: ${t.title} [Status: ${t.status}]`);
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      action: { in: ["COMPLETED_NO_TOOL", "COMPLETED_MULTI_STEP", "COMPLETED_MAX_STEPS", "SUCCESS", "AWAITING_INTERNAL_REVIEW"] },
    },
    take: 5,
  });
  console.log("\nFound", logs.length, "audit logs:");
  for (const l of logs) {
    console.log(`- Log for Task #${l.taskId} (${l.action}):`);
    console.log("Raw resultSummary:", l.resultSummary);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
