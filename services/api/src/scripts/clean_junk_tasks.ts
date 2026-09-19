import { db } from "../db/client";

async function main() {
  const keepParentId = "task_d63d6114-2a2c-492e-b01c-696af9399d75";

  // Tìm tất cả task cần giữ lại: task gốc PLANNED và các subtask của nó
  const validTasks = await db.task.findMany({
    where: {
      OR: [
        { id: keepParentId },
        { parentTaskId: keepParentId },
      ],
    },
  });

  const validTaskIds = new Set(validTasks.map((t: { id: string }) => t.id));
  console.log(`Keeping ${validTaskIds.size} valid tasks:`, Array.from(validTaskIds));

  // Lấy danh sách task rác cần xoá
  const junkTasks = await db.task.findMany({
    where: {
      id: { notIn: Array.from(validTaskIds) },
    },
  });

  const junkTaskIds = junkTasks.map((t: { id: string }) => t.id);
  console.log(`Found ${junkTaskIds.length} junk tasks to delete.`);

  if (junkTaskIds.length > 0) {
    // Xoá decision packages liên quan tới task rác nếu có
    const deletedDecisions = await db.decisionPackage.deleteMany({
      where: { taskId: { in: junkTaskIds } },
    });
    console.log(`Deleted ${deletedDecisions.count} associated decision packages.`);

    // Xoá task rác
    const deletedTasks = await db.task.deleteMany({
      where: { id: { in: junkTaskIds } },
    });
    console.log(`Deleted ${deletedTasks.count} junk tasks successfully!`);
  }

  const remaining = await db.task.findMany({
    orderBy: { createdAt: "desc" },
  });
  console.log(`Remaining tasks in DB (${remaining.length}):`);
  for (const t of remaining) {
    console.log(`- [${t.status}] ID: ${t.id} | "${t.title}" | Parent: ${t.parentTaskId}`);
  }
}

main().catch(console.error).finally(() => db.$disconnect());
