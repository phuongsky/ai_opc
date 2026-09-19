import fs from "fs";
import path from "path";
import { logAudit } from "../audit/auditLogger";
import { sendTelegramMessage, isTelegramConfigured } from "./telegram";
import { sendEmail, isEmailConfigured } from "./email";
import { sendZaloMessage, isZaloConfigured } from "./zalo";
import type { NotificationCategory, NotificationPreferences } from "@ai-opc/shared";

export type NotificationSeverity = "info" | "warning" | "critical";

export interface NotificationPayload {
  title: string;
  message: string;
  severity: NotificationSeverity;
  category?: NotificationCategory;
}

const SEVERITY_EMOJI: Record<NotificationSeverity, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};

const PREFERENCES_FILE = path.join(process.cwd(), "data", "notification_preferences.json");

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  sendToTelegram: true,
  sendToEmail: true,
  sendToZalo: true,
  notifyBudgetCapExceeded: true,
  notifyDecisionRequired: true,
  notifyBlockedTasks: true,
  notifyWeeklyReport: true,
  notifyEmergencyStop: true,
  customTelegramChatId: null,
  customEmailRecipient: null,
  customZaloPhone: null,
  customZaloGroupId: null,
};

let cachedPreferences: NotificationPreferences | null = null;

export function getNotificationPreferences(): NotificationPreferences {
  if (cachedPreferences) return { ...cachedPreferences };

  try {
    if (fs.existsSync(PREFERENCES_FILE)) {
      const raw = fs.readFileSync(PREFERENCES_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
      cachedPreferences = {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...parsed,
      } as NotificationPreferences;
      return { ...cachedPreferences };
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[Notifier] Lỗi đọc notification_preferences.json, sử dụng mặc định:", err);
  }

  cachedPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  return { ...cachedPreferences };
}

export function updateNotificationPreferences(
  partial: Partial<NotificationPreferences>
): NotificationPreferences {
  const current = getNotificationPreferences();
  const updated: NotificationPreferences = {
    ...current,
    ...partial,
    updatedAt: new Date().toISOString(),
  };

  try {
    const dir = path.dirname(PREFERENCES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(updated, null, 2), "utf-8");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[Notifier] Lỗi ghi notification_preferences.json:", err);
  }

  cachedPreferences = updated;
  return updated;
}

export interface NotifyFounderResult {
  success: boolean;
  deliveredChannel?: string;
  summary: string;
  logs: string[];
}

/**
 * Tiện ích bọc Promise với timeout tối đa (mặc định 10s)
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs = 10000, label = "Thao tác"): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} quá 10s không phản hồi (timeout)`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

export interface ChannelHealth {
  consecutiveFailures: number;
  lastFailedAt: number | null;
  lastSuccessAt: number | null;
  cooldownUntil: number | null;
}

const channelHealthMap: Record<"telegram" | "zalo" | "email", ChannelHealth> = {
  telegram: { consecutiveFailures: 0, lastFailedAt: null, lastSuccessAt: null, cooldownUntil: null },
  zalo: { consecutiveFailures: 0, lastFailedAt: null, lastSuccessAt: null, cooldownUntil: null },
  email: { consecutiveFailures: 0, lastFailedAt: null, lastSuccessAt: null, cooldownUntil: null },
};

export function recordChannelSuccess(channelId: "telegram" | "zalo" | "email") {
  const h = channelHealthMap[channelId];
  h.consecutiveFailures = 0;
  h.lastSuccessAt = Date.now();
  h.cooldownUntil = null;
}

export function recordChannelFailure(channelId: "telegram" | "zalo" | "email") {
  const h = channelHealthMap[channelId];
  h.consecutiveFailures += 1;
  h.lastFailedAt = Date.now();
  // Cooldown 2 phút nếu liên tục thất bại/quá thời gian chờ mạng
  h.cooldownUntil = Date.now() + 120000;
}

export function isChannelInCooldown(channelId: "telegram" | "zalo" | "email"): boolean {
  const h = channelHealthMap[channelId];
  return Boolean(h.cooldownUntil && Date.now() < h.cooldownUntil);
}

export function getNotificationChannelsHealth() {
  return {
    telegram: {
      inCooldown: isChannelInCooldown("telegram"),
      failures: channelHealthMap.telegram.consecutiveFailures,
      lastSuccess: channelHealthMap.telegram.lastSuccessAt,
    },
    zalo: {
      inCooldown: isChannelInCooldown("zalo"),
      failures: channelHealthMap.zalo.consecutiveFailures,
      lastSuccess: channelHealthMap.zalo.lastSuccessAt,
    },
    email: {
      inCooldown: isChannelInCooldown("email"),
      failures: channelHealthMap.email.consecutiveFailures,
      lastSuccess: channelHealthMap.email.lastSuccessAt,
    },
  };
}

export function isAnyChannelConfigured(): boolean {
  return isTelegramConfigured() || isEmailConfigured() || isZaloConfigured();
}

/**
 * Gửi thông báo đến Founder với cơ chế tuần tự và Failover thông minh:
 * - Thử lần lượt các kênh được bật và cấu hình (Telegram -> Zalo Auth -> Email)
 * - Mỗi kênh có timeout riêng (Telegram 5s, Zalo 8s, Email 10s).
 * - Nếu một kênh lỗi hoặc timeout, Circuit Breaker sẽ tạm hạ ưu tiên kênh đó
 *   để các lần gửi tiếp theo chuyển ngay sang kênh lành mạnh (Zalo/Email) mà không bị chờ lâu.
 */
export async function notifyFounder(payload: NotificationPayload): Promise<NotifyFounderResult> {
  if (!isAnyChannelConfigured()) {
    return {
      success: false,
      summary: "Chưa cấu hình kênh thông báo nào (Telegram, Zalo Auth, Email) trong hệ thống.",
      logs: ["Chưa cấu hình kênh nào trong .env hoặc phiên Zalo."],
    };
  }

  const prefs = getNotificationPreferences();

  // Kiểm tra bộ lọc sự kiện theo cấu hình Founder
  if (payload.category) {
    if (payload.category === "BUDGET_CAP" && !prefs.notifyBudgetCapExceeded) {
      return { success: true, summary: "Bỏ qua do bộ lọc sự kiện BUDGET_CAP đang tắt", logs: [] };
    }
    if (payload.category === "DECISION" && !prefs.notifyDecisionRequired) {
      return { success: true, summary: "Bỏ qua do bộ lọc sự kiện DECISION đang tắt", logs: [] };
    }
    if (payload.category === "BLOCKED_TASK" && !prefs.notifyBlockedTasks) {
      return { success: true, summary: "Bỏ qua do bộ lọc sự kiện BLOCKED_TASK đang tắt", logs: [] };
    }
    if (payload.category === "WEEKLY_REPORT" && !prefs.notifyWeeklyReport) {
      return { success: true, summary: "Bỏ qua do bộ lọc sự kiện WEEKLY_REPORT đang tắt", logs: [] };
    }
    if (payload.category === "EMERGENCY_STOP" && !prefs.notifyEmergencyStop) {
      return { success: true, summary: "Bỏ qua do bộ lọc sự kiện EMERGENCY_STOP đang tắt", logs: [] };
    }
  }

  const text = `${SEVERITY_EMOJI[payload.severity]} *${payload.title}*\n\n${payload.message}`;

  // Danh sách ứng viên kênh thông báo
  const candidates: Array<{
    id: "telegram" | "zalo" | "email";
    name: string;
    isConfigured: boolean;
    isEnabled: boolean;
    timeoutMs: number;
    send: () => Promise<string>;
  }> = [
    {
      id: "telegram",
      name: "Telegram Bot",
      isConfigured: isTelegramConfigured(),
      isEnabled: prefs.sendToTelegram,
      timeoutMs: 5000, // Timeout 5s: nếu mạng ISP chặn hoặc lag quá 5s thì failover ngay
      send: async () => {
        await sendTelegramMessage(text, prefs.customTelegramChatId);
        return "Telegram Bot";
      },
    },
    {
      id: "zalo",
      name: "Zalo Auth",
      isConfigured: isZaloConfigured(prefs.customZaloPhone, prefs.customZaloGroupId),
      isEnabled: prefs.sendToZalo,
      timeoutMs: 8000,
      send: async () => {
        const res = await sendZaloMessage(text, {
          phone: prefs.customZaloPhone,
          groupId: prefs.customZaloGroupId,
        });
        return `Zalo Auth (${res.threadId})`;
      },
    },
    {
      id: "email",
      name: "Email (SMTP)",
      isConfigured: isEmailConfigured(),
      isEnabled: prefs.sendToEmail,
      timeoutMs: 10000,
      send: async () => {
        await sendEmail(payload.title, payload.message, prefs.customEmailRecipient);
        return "Email (SMTP)";
      },
    },
  ];

  // Lọc các kênh được bật trong cài đặt Founder và đã cấu hình trong hệ thống
  const activeCandidates = candidates.filter((c) => c.isEnabled && c.isConfigured);

  if (activeCandidates.length === 0) {
    const summary = "Không có kênh thông báo nào đang được BẬT và CẤU HÌNH hợp lệ.";
    return {
      success: false,
      summary,
      logs: [summary],
    };
  }

  // SẮP XẾP THÔNG MINH (Circuit Breaker & Health-Aware Priority):
  // 1. Kênh đang bị Cooldown (vừa timeout/lỗi do mạng) bị đẩy xuống cuối hàng để không làm chậm Founder.
  // 2. Kênh Zalo Auth có phiên hoạt động tốt được ưu tiên hàng đầu nếu Telegram đang chập chờn.
  activeCandidates.sort((a, b) => {
    const aCooldown = isChannelInCooldown(a.id);
    const bCooldown = isChannelInCooldown(b.id);
    if (aCooldown && !bCooldown) return 1;
    if (!aCooldown && bCooldown) return -1;
    return 0;
  });

  let delivered = false;
  let deliveredChannel = "";
  const dispatchLogs: string[] = [];

  // Gửi tuần tự theo thứ tự kênh thông minh với cơ chế Failover tức thì
  for (const candidate of activeCandidates) {
    const t0 = Date.now();
    try {
      const targetDetail = await withTimeout(candidate.send(), candidate.timeoutMs, `Kênh ${candidate.name}`);
      const durationMs = Date.now() - t0;
      dispatchLogs.push(`${candidate.name}: OK (${durationMs}ms, ${targetDetail})`);
      delivered = true;
      deliveredChannel = candidate.name;
      recordChannelSuccess(candidate.id);
      // Đã chuyển phát thành công, kết thúc chuỗi failover
      break;
    } catch (err: any) {
      const durationMs = Date.now() - t0;
      const isTimeout = err.message?.includes("không phản hồi") || err.message?.includes("quá");
      const errDetail = isTimeout ? `Quá ${candidate.timeoutMs / 1000}s không phản hồi (timeout)` : (err.message || String(err));
      recordChannelFailure(candidate.id);
      dispatchLogs.push(`${candidate.name}: Thất bại (${errDetail}, sau ${durationMs}ms) -> Tự động chuyển dịch vụ`);
      console.warn(`[Notifier] ${candidate.name} thất bại (${errDetail}), kích hoạt Circuit Breaker và tự động chuyển kênh tiếp theo...`);
    }
  }

  const summary = delivered
    ? `Đã gửi thông báo thành công qua ${deliveredChannel}! [${dispatchLogs.join("; ")}]`
    : `Tất cả các kênh tiếp nhận đều thất bại hoặc quá 10s không phản hồi: [${dispatchLogs.join("; ")}]`;

  await logAudit({
    action: "NOTIFICATION_SENT",
    resultSummary: `[${payload.category ?? "SYSTEM"}/${payload.severity}] ${payload.title} — ${summary}`,
  });

  return {
    success: delivered,
    deliveredChannel: delivered ? deliveredChannel : undefined,
    summary,
    logs: dispatchLogs,
  };
}

export interface DeliverableNotificationResult {
  success: boolean;
  message: string;
  channels: {
    telegram: { configured: boolean; sent: boolean; error?: string };
    email: { configured: boolean; sent: boolean; error?: string };
    zalo: { configured: boolean; sent: boolean; error?: string };
  };
}

import { cleanDeliverableText } from "@ai-opc/shared";

export async function notifyTaskDeliverable(task: {
  id: string;
  title: string;
  objective: string;
  assignedTo?: string | null;
  createdBy?: string | null;
  result: string;
}): Promise<DeliverableNotificationResult> {
  const prefs = getNotificationPreferences();
  const telegramConfigured = isTelegramConfigured();
  const emailConfigured = isEmailConfigured();
  const zaloConfigured = isZaloConfigured(prefs.customZaloPhone, prefs.customZaloGroupId);
  const cleanResult = cleanDeliverableText(task.result);

  if (!telegramConfigured && !emailConfigured && !zaloConfigured) {
    return {
      success: false,
      message: "Chưa cấu hình kênh Telegram, Email hoặc Zalo Auth trong hệ thống.",
      channels: {
        telegram: { configured: false, sent: false, error: "Chưa cấu hình TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID" },
        email: { configured: false, sent: false, error: "Chưa cấu hình SMTP_HOST/SMTP_USER/SMTP_PASS" },
        zalo: { configured: false, sent: false, error: "Chưa có phiên Zalo Auth hoặc chưa cấu hình SĐT/Nhóm Zalo" },
      },
    };
  }

  const result: DeliverableNotificationResult = {
    success: true,
    message: "",
    channels: {
      telegram: { configured: telegramConfigured, sent: false },
      email: { configured: emailConfigured, sent: false },
      zalo: { configured: zaloConfigured, sent: false },
    },
  };

  const telegramContent = `📋 *KẾT QUẢ BÀN GIAO TASK*\n` +
    `*Task:* #${task.id.slice(0, 8)} - ${task.title}\n` +
    `*Phụ trách:* ${task.assignedTo || "AI Agent"}\n\n` +
    `📥 *Mục tiêu:*\n${task.objective}\n\n` +
    `📤 *Văn bản bàn giao / SOP:*\n${cleanResult}`;

  const emailSubject = `[AI-OPC Deliverable] #${task.id.slice(0, 8)} - ${task.title}`;
  const emailContent = `KẾT QUẢ BÀN GIAO CÔNG VIỆC / TÀI LIỆU SOP\n` +
    `==========================================\n\n` +
    `Task ID: #${task.id}\n` +
    `Tiêu đề: ${task.title}\n` +
    `Phụ trách: ${task.assignedTo || "AI Agent"}\n` +
    `Người giao: ${task.createdBy || "Founder"}\n\n` +
    `MỤC TIÊU CÔNG VIỆC (OBJECTIVE):\n` +
    `------------------------------------------\n` +
    `${task.objective}\n\n` +
    `KẾT QUẢ THỰC HIỆN / VĂN BẢN BÀN GIAO (AGENT OUTPUT):\n` +
    `------------------------------------------\n` +
    `${cleanResult}\n\n` +
    `---\n` +
    `Hệ thống AI-OPC Company OS`;


  const resultsSummary: string[] = [];

  // Gửi Telegram
  if (telegramConfigured && prefs.sendToTelegram) {
    try {
      await withTimeout(sendTelegramMessage(telegramContent, prefs.customTelegramChatId), 10000, "Telegram");
      result.channels.telegram.sent = true;
      resultsSummary.push("Telegram: OK");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.channels.telegram.error = errMsg;
      resultsSummary.push(`Telegram: lỗi (${errMsg})`);
    }
  } else if (!telegramConfigured) {
    result.channels.telegram.error = "Chưa cấu hình Telegram";
  } else {
    result.channels.telegram.error = "Đã tắt trong cài đặt Founder";
  }

  // Gửi Email
  if (emailConfigured && prefs.sendToEmail) {
    try {
      await withTimeout(sendEmail(emailSubject, emailContent, prefs.customEmailRecipient), 10000, "Email");
      result.channels.email.sent = true;
      resultsSummary.push("Email: OK");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.channels.email.error = errMsg;
      resultsSummary.push(`Email: lỗi (${errMsg})`);
    }
  } else if (!emailConfigured) {
    result.channels.email.error = "Chưa cấu hình Email";
  } else {
    result.channels.email.error = "Đã tắt trong cài đặt Founder";
  }

  // Gửi Zalo nếu được bật
  if (zaloConfigured && prefs.sendToZalo) {
    try {
      const zaloRes = await withTimeout(
        sendZaloMessage(telegramContent, {
          phone: prefs.customZaloPhone,
          groupId: prefs.customZaloGroupId,
        }),
        10000,
        "Zalo"
      );
      result.channels.zalo.sent = true;
      resultsSummary.push(`Zalo: OK (${zaloRes.threadId})`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.channels.zalo.error = errMsg;
      resultsSummary.push(`Zalo: lỗi (${errMsg})`);
    }
  } else if (!zaloConfigured) {
    result.channels.zalo.error = "Chưa cấu hình hoặc chưa có phiên Zalo Auth";
  } else {
    result.channels.zalo.error = "Đã tắt trong cài đặt Founder";
  }

  const anySent = result.channels.telegram.sent || result.channels.email.sent || result.channels.zalo.sent;
  result.success = anySent;
  result.message = anySent
    ? `Đã gửi thông báo kết quả bàn giao qua ${resultsSummary.join(", ")}`
    : `Không thể gửi thông báo: ${resultsSummary.join(", ")}`;

  await logAudit({
    taskId: task.id,
    action: "TASK_DELIVERABLE_NOTIFIED",
    resultSummary: `Gửi thông báo bàn giao task #${task.id.slice(0, 8)} (${task.title}): ${resultsSummary.join(", ")}`,
  });

  return result;
}

