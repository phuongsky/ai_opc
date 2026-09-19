/**
 * Executive Report Generator — tổng hợp toàn diện hoạt động của công ty:
 * - Tiến độ task (hoàn thành / đang chạy / blocked)
 * - Chi phí AI tích lũy theo từng Agent và toàn công ty
 * - Các nút thắt cổ chai (bottlenecks) & quyết định cần Founder duyệt
 */
import { db } from "../../db/client";

export interface ExecutiveReportData {
  title: string;
  generatedAt: string;
  period: "weekly" | "all";
  metrics: {
    totalTasks: number;
    completedTasks: number;
    runningTasks: number;
    blockedTasks: number;
    awaitingApprovalTasks: number;
    pendingDecisions: number;
    totalCostUsd: number;
    activeAgentsCount: number;
  };
  agentStats: Array<{
    id: string;
    name: string;
    title: string;
    status: string;
    monthlyCostUsd: number;
    completedCount: number;
    runningCount: number;
    blockedCount: number;
  }>;
  recentCompletedTasks: Array<{
    id: string;
    title: string;
    assignedTo: string | null;
    completedAt: Date | null;
  }>;
  blockedIssues: Array<{
    id: string;
    title: string;
    assignedTo: string | null;
    objective: string;
  }>;
  markdown: string;
}

export async function generateExecutiveReport(
  period: "weekly" | "all" = "weekly"
): Promise<ExecutiveReportData> {
  const [agents, tasks, decisions, auditLogs] = await Promise.all([
    db.agent.findMany({ include: { department: true } }),
    db.task.findMany({ orderBy: { createdAt: "desc" } }),
    db.decisionPackage.findMany({ where: { status: "PENDING" } }),
    db.auditLog.findMany({ take: 100, orderBy: { timestamp: "desc" } }),
  ]);

  // Phân loại task
  let completedTasks = 0;
  let runningTasks = 0;
  let blockedTasks = 0;
  let awaitingApprovalTasks = 0;

  const tasksByAgent: Record<
    string,
    { completed: number; running: number; blocked: number }
  > = {};

  for (const a of agents) {
    tasksByAgent[a.id] = { completed: 0, running: 0, blocked: 0 };
  }

  for (const t of tasks) {
    if (t.status === "COMPLETED") {
      completedTasks++;
      if (t.assignedTo && tasksByAgent[t.assignedTo]) {
        tasksByAgent[t.assignedTo].completed++;
      }
    } else if (t.status === "RUNNING" || t.status === "ASSIGNED") {
      runningTasks++;
      if (t.assignedTo && tasksByAgent[t.assignedTo]) {
        tasksByAgent[t.assignedTo].running++;
      }
    } else if (t.status === "BLOCKED" || t.status === "ESCALATED") {
      blockedTasks++;
      if (t.assignedTo && tasksByAgent[t.assignedTo]) {
        tasksByAgent[t.assignedTo].blocked++;
      }
    } else if (t.status === "AWAITING_APPROVAL") {
      awaitingApprovalTasks++;
    }
  }

  const totalCostUsd = agents.reduce((acc: number, a: { monthlyCostUsd: number }) => acc + (a.monthlyCostUsd || 0), 0);
  const activeAgentsCount = agents.filter((a: { status: string }) => a.status === "RUNNING" || a.status === "READY").length;

  const agentStats = agents.map((a: { id: string; name: string; title: string; status: string; monthlyCostUsd: number }) => ({
    id: a.id,
    name: a.name,
    title: a.title,
    status: a.status,
    monthlyCostUsd: a.monthlyCostUsd,
    completedCount: tasksByAgent[a.id]?.completed || 0,
    runningCount: tasksByAgent[a.id]?.running || 0,
    blockedCount: tasksByAgent[a.id]?.blocked || 0,
  }));

  const recentCompletedTasks = tasks
    .filter((t: { status: string }) => t.status === "COMPLETED")
    .slice(0, 5)
    .map((t: { id: string; title: string; assignedTo: string | null; completedAt: Date | null }) => ({
      id: t.id,
      title: t.title,
      assignedTo: t.assignedTo,
      completedAt: t.completedAt,
    }));

  const blockedIssues = tasks
    .filter((t: { status: string }) => t.status === "BLOCKED" || t.status === "ESCALATED")
    .slice(0, 5)
    .map((t: { id: string; title: string; assignedTo: string | null; objective: string }) => ({
      id: t.id,
      title: t.title,
      assignedTo: t.assignedTo,
      objective: t.objective,
    }));

  // Build Markdown report string
  const dateStr = new Date().toLocaleDateString("vi-VN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const agentRows = agentStats
    .map(
      (a: { name: string; title: string; status: string; completedCount: number; runningCount: number; monthlyCostUsd: number }) =>
        `| **${a.name}** (${a.title}) | \`${a.status}\` | ${a.completedCount} xong / ${a.runningCount} chạy | $${a.monthlyCostUsd.toFixed(4)} |`
    )
    .join("\n");

  const completedList =
    recentCompletedTasks.length > 0
      ? recentCompletedTasks
          .map((t: { title: string; assignedTo: string | null }) => `- ✅ **${t.title}** (${t.assignedTo || "Unassigned"})`)
          .join("\n")
      : "_Chưa có task nào hoàn thành trong kỳ._";

  const blockedList =
    blockedIssues.length > 0
      ? blockedIssues
          .map((t: { title: string; assignedTo: string | null; objective: string }) => `- ⚠️ **${t.title}** (${t.assignedTo || "Unassigned"}): ${t.objective}`)
          .join("\n")
      : "_Không có task nào bị nghẽn (Zero Blockers)._";

  const markdown = `# 📊 BÁO CÁO ĐIỀU HÀNH EXECUTIVE REPORT
*Thời điểm xuất:* ${dateStr} | *Phạm vi:* ${period === "weekly" ? "Tuần hiện tại" : "Toàn bộ"}

---

### 1. Tổng quan Chỉ số Hoạt động (Key Metrics)
- **Tổng số nhiệm vụ:** \`${tasks.length}\` tasks
- **Tỉ lệ hoàn thành:** \`${tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0}%\` (${completedTasks} hoàn tất)
- **Đang xử lý:** \`${runningTasks}\` tasks
- **Bị chặn / Cần can thiệp:** \`${blockedTasks}\` tasks
- **Quyết định chờ duyệt (Decisions):** \`${decisions.length}\` gói
- **Tổng chi phí AI:** \`$${totalCostUsd.toFixed(4)}\` USD

---

### 2. Hiệu suất & Chi phí theo Agent
| Agent & Chức vụ | Trạng thái | Nhiệm vụ | Chi phí tích luỹ |
| :--- | :--- | :--- | :--- |
${agentRows}

---

### 3. Nhiệm vụ Hoàn tất Gần nhất
${completedList}

---

### 4. Điểm nghẽn Cần Lưu ý (Blockers & Bottlenecks)
${blockedList}

---
*Báo cáo được tạo tự động bởi AI-OPC Core Engine theo Rulebook v1.1.*`;

  return {
    title: `Báo cáo Điều hành Tuần - ${dateStr}`,
    generatedAt: new Date().toISOString(),
    period,
    metrics: {
      totalTasks: tasks.length,
      completedTasks,
      runningTasks,
      blockedTasks,
      awaitingApprovalTasks,
      pendingDecisions: decisions.length,
      totalCostUsd,
      activeAgentsCount,
    },
    agentStats,
    recentCompletedTasks,
    blockedIssues,
    markdown,
  };
}
