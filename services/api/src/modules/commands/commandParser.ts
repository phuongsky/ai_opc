/**
 * Founder Command Parser — nhận raw text từ Command Palette (Web/Desktop) hoặc
 * Voice Command đã được speech-to-text (Mobile), phân loại thành các lệnh chuẩn
 * (Rulebook mục 26-28) & navigation commands và điều phối tới Orchestrator (AI-COO) tương ứng.
 */
import { randomUUID } from "crypto";
import { db } from "../../db/client";
import { broadcastCompanyEvent } from "../../ws/gateway";
import { runOrchestratorForGoal } from "../orchestrator/orchestrator";
import { generateWeeklyReportText } from "../reports/weeklyReport";
import { generateExecutiveReport } from "../reports/reportGenerator";
import { handleDirectDoCommand } from "./taskAssigner";
import { notifyFounder } from "../notifications/notifier";
import type { FounderCommandType } from "@ai-opc/shared";

const COMMAND_PREFIXES: FounderCommandType[] = [
  "/goal",
  "/plan",
  "/analyze",
  "/do",
  "/status",
  "/stop",
  "/report",
  "/settings",
  "/knowledge",
  "/audit",
  "/security",
];

export interface ParsedCommand {
  type: FounderCommandType;
  argument: string; // phần text sau lệnh
  raw: string;
}

export function parseFounderCommand(raw: string): ParsedCommand {
  const trimmed = raw.trim();
  const prefix = COMMAND_PREFIXES.find((p) => trimmed.startsWith(p));
  if (!prefix) {
    throw new Error(
      `Không nhận diện được lệnh. Các lệnh hợp lệ: ${COMMAND_PREFIXES.join(", ")}`
    );
  }
  return { type: prefix, argument: trimmed.slice(prefix.length).trim(), raw: trimmed };
}

/**
 * Điều phối lệnh đã parse:
 * - /goal: Phân rã mục tiêu chiến lược qua AI-COO Orchestrator
 * - /do: Giao việc trực tiếp cho Agent đích, bỏ qua phân rã
 * - /report: Xuất Weekly Report / Executive Report và gửi qua Telegram/Email
 * - /status: Xem tổng quan hệ thống, agent & decisions
 * - /stop: Emergency Panic (Rule 12) tạm dừng toàn bộ agent
 * - /settings, /knowledge, /audit, /security: Điều hướng nhanh tới các trang quản trị
 */
export async function dispatchFounderCommand(cmd: ParsedCommand) {
  switch (cmd.type) {
    case "/goal": {
      const taskId = `task_${randomUUID()}`;
      const task = await db.task.create({
        data: {
          id: taskId,
          title: cmd.argument.slice(0, 255) || "(chưa đặt tên goal)",
          objective: cmd.argument,
          status: "NEW",
          riskLevel: "R1",
          createdBy: "FOUNDER",
        },
      });
      broadcastCompanyEvent({ type: "TASK_UPDATED", payload: task });

      void runOrchestratorForGoal(taskId, cmd.argument).catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[commandParser] Orchestrator lỗi ngoài dự kiến:", err);
      });

      return { status: "ACCEPTED", taskId, message: "AI-COO đang phân rã goal..." };
    }

    case "/do": {
      const assigned = await handleDirectDoCommand(cmd.argument);
      return {
        status: "ASSIGNED",
        type: "/do",
        taskId: assigned.taskId,
        assignedTo: assigned.agentName,
        title: assigned.title,
        message: `Đã giao trực tiếp nhiệm vụ "${assigned.title}" cho ${assigned.agentName}. Agent đang tiến hành xử lý.`,
      };
    }

    case "/report": {
      const period = cmd.argument.trim().toLowerCase();
      const reportPeriod = period === "all" ? "all" : "weekly";
      const executive = await generateExecutiveReport(reportPeriod);

      void notifyFounder({
        category: "WEEKLY_REPORT",
        title: `${executive.title} (theo yêu cầu Founder)`,
        message: executive.markdown,
        severity: "info",
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[commandParser] Gửi report qua notifier lỗi:", err);
      });

      return {
        status: "OK",
        type: "/report",
        message: `Đã xuất ${executive.title} (và gửi ra kênh Founder nếu đã cấu hình)`,
        report: executive,
      };
    }

    case "/stop": {
      await db.agent.updateMany({
        where: { status: { in: ["RUNNING", "WAITING", "AWAITING_APPROVAL"] } },
        data: { status: "SUSPENDED" },
      });
      broadcastCompanyEvent({ type: "AGENT_STATUS", payload: { all: "SUSPENDED" } });
      void notifyFounder({
        category: "EMERGENCY_STOP",
        title: "Emergency Stop đã kích hoạt",
        message: "Founder vừa gọi /stop — toàn bộ Agent đang hoạt động đã chuyển sang SUSPENDED.",
        severity: "critical",
      }).catch(() => {});
      return { status: "STOPPED", message: "Toàn bộ Agent đã chuyển sang SUSPENDED." };
    }

    case "/status": {
      const [agents, pendingDecisions, runningTasks, completedTasks] = await Promise.all([
        db.agent.findMany(),
        db.decisionPackage.count({ where: { status: "PENDING" } }),
        db.task.count({ where: { status: { in: ["RUNNING", "ASSIGNED"] } } }),
        db.task.count({ where: { status: "COMPLETED" } }),
      ]);
      const totalCost = agents.reduce((acc: number, a: { monthlyCostUsd: number | null }) => acc + (a.monthlyCostUsd || 0), 0);
      return {
        status: "OK",
        agents,
        pendingDecisions,
        runningTasks,
        completedTasks,
        totalCostUsd: totalCost,
        message: `Hệ thống có ${agents.length} Agent, ${runningTasks} task đang chạy, ${completedTasks} task hoàn tất, tổng chi phí $${totalCost.toFixed(4)}.`,
      };
    }

    case "/settings": {
      return {
        status: "NAVIGATE",
        type: "/settings",
        path: "/settings",
        message: "Điều hướng tới Cài đặt công ty, Budget Guardrail & Kênh báo Founder (/settings)",
      };
    }

    case "/knowledge": {
      return {
        status: "NAVIGATE",
        type: "/knowledge",
        path: "/knowledge",
        message: "Điều hướng tới Company Knowledge Base & Bộ nhớ AI (/knowledge)",
      };
    }

    case "/audit": {
      return {
        status: "NAVIGATE",
        type: "/audit",
        path: "/audit",
        message: "Điều hướng tới Audit Log kiểm toán hoạt động (/audit)",
      };
    }

    case "/security": {
      return {
        status: "NAVIGATE",
        type: "/security",
        path: "/security",
        message: "Điều hướng tới Cài đặt bảo mật & 2FA (/security)",
      };
    }

    case "/plan": {
      return {
        status: "ACCEPTED",
        type: "/plan",
        argument: cmd.argument,
        message: `Đã ghi nhận yêu cầu lập kế hoạch cho mục tiêu: "${cmd.argument}". Hãy dùng /goal để AI-COO phân rã và thực thi ngay.`,
      };
    }

    case "/analyze": {
      return {
        status: "ACCEPTED",
        type: "/analyze",
        argument: cmd.argument,
        message: `Đã kích hoạt phân tích dữ liệu cho: "${cmd.argument}".`,
      };
    }
  }
}
