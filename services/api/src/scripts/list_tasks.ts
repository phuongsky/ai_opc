import { db } from "../db/client";

async function main() {
  const tasks = await db.task.findMany({
    orderBy: { createdAt: "desc" },
  });
  console.log(`Total tasks: ${tasks.length}`);
  for (const t of tasks) {
    console.log(`[${t.status}] ID: ${t.id} | Title: "${t.title}" | Parent: ${t.parentTaskId} | CreatedAt: ${t.createdAt.toISOString()}`);
  }
}

main().catch(console.error).finally(() => db.$disconnect());
