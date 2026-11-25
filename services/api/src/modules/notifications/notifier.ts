import fs from "fs";
import path from "path";
import { logAudit } from "../audit/auditLogger";
import { sendTelegramMessage, isTelegramConfigured, cleanTelegramToken, cleanTelegramChatId } from "./telegram";
import { sendEmail, isEmailConfigured } from "./email";
import { sendZaloMessage, isZaloConfigured } from "./zalo";
import { sendZaloBotMessage, isZaloBotConfigured } from "./zaloBot";
import { registerDecisionShortCode } from "./zaloBotInbound";
import type { NotificationCategory, NotificationPreferences } from "@ai-opc/shared";

export type NotificationSeverity = "info" | "warning" | "critical";

export interface NotificationPayload {
  title: string;
  message: string;
  severity: NotificationSeverity;
  category?: NotificationCategory;
  /** Nếu có, Telegram sẽ gửi kèm nút "✅ Duyệt"/"❌ Từ chối" gắn với decision này. */
  decisionId?: string;
}

const SEVERITY_EMOJI: Record<NotificationSeverity, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};

import { resolveDataDir } from "../../config/env";

export function getPreferencesFilePath(): string {
  const dataDir = resolveDataDir();
  const targetFile = path.join(dataDir, "notification_preferences.json");

  // Tự động khởi tạo từ file mẫu nếu chưa có trong dataDir
  if (!fs.existsSync(targetFile)) {
    const candidates = [
      path.resolve(process.cwd(), "data", "notification_preferences.json"),
      path.resolve(path.dirname(process.execPath), "data", "notification_preferences.json"),
      path.resolve(path.dirname(process.execPath), "resources", "data", "notification_preferences.json"),
      path.resolve(path.dirname(process.execPath), "resources", "binaries", "data", "notification_preferences.json"),
      path.resolve(__dirname, "../../../data", "notification_preferences.json"),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.statSync(cand).size > 0) {
        try {
          fs.copyFileSync(cand, targetFile);
          break;
        } catch {}
      }
    }
  }
  return targetFile;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  sendToTelegram: true,
  sendToEmail: true,
  sendToZalo: true,
  sendToZaloBot: true,
  notifyBudgetCapExceeded: true,
  notifyDecisionRequired: true,
  notifyBlockedTasks: true,
  notifyWeeklyReport: true,
  notifyEmergencyStop: true,
  customTelegramChatId: null,
  customTelegramRecipients: [],
  customTelegramToken: null,
  customEmailRecipient: null,
  customSmtpHost: null,
  customSmtpPort: null,
  customSmtpUser: null,
  customSmtpPass: null,
  customSmtpFrom: null,
  customZaloPhone: null,
  customZaloGroupId: null,
  customZaloRecipients: [],
  customZaloBotChatId: null,
  customZaloBotRecipients: [],
  customZaloBotToken: null,
};

let cachedPreferences: NotificationPreferences | null = null;

function sanitizePreferences(prefs: NotificationPreferences): NotificationPreferences {
  const customTelegramToken = prefs.customTelegramToken ? cleanTelegramToken(prefs.customTelegramToken) : null;
  const customTelegramChatId = prefs.customTelegramChatId ? cleanTelegramChatId(prefs.customTelegramChatId) : null;
  const customTelegramRecipients = Array.isArray(prefs.customTelegramRecipients)
    ? prefs.customTelegramRecipients.map((r) => ({
        ...r,
        chatId: cleanTelegramChatId(r.chatId),
      }))
    : [];

  const customSmtpHost = prefs.customSmtpHost ? prefs.customSmtpHost.trim() : null;
  const customSmtpPort =
    prefs.customSmtpPort !== undefined && prefs.customSmtpPort !== null && String(prefs.customSmtpPort).trim() !== ""
      ? isNaN(Number(prefs.customSmtpPort))
        ? null
        : Number(prefs.customSmtpPort)
      : null;
  const customSmtpUser = prefs.customSmtpUser ? prefs.customSmtpUser.trim() : null;
  const customSmtpPass = prefs.customSmtpPass ? prefs.customSmtpPass.trim() : null;
  const customSmtpFrom = prefs.customSmtpFrom ? prefs.customSmtpFrom.trim() : null;
  const customEmailRecipient = prefs.customEmailRecipient ? prefs.customEmailRecipient.trim() : null;

  return {
    ...prefs,
    customTelegramToken: customTelegramToken || null,
    customTelegramChatId: customTelegramChatId || null,
    customTelegramRecipients,
    customSmtpHost: customSmtpHost || null,
    customSmtpPort: customSmtpPort || null,
    customSmtpUser: customSmtpUser || null,
    customSmtpPass: customSmtpPass || null,
    customSmtpFrom: customSmtpFrom || null,
    customEmailRecipient: customEmailRecipient || null,
  };
}

export function getNotificationPreferences(): NotificationPreferences {
  if (cachedPreferences) return { ...cachedPreferences };

  try {
    const filePath = getPreferencesFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
      cachedPreferences = sanitizePreferences({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...parsed,
      } as NotificationPreferences);
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
  const updated: NotificationPreferences = sanitizePreferences({
    ...current,
    ...partial,
    updatedAt: new Date().toISOString(),
  });

  try {
    const filePath = getPreferencesFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf-8");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[Notifier] Lỗi ghi notification_preferences.json:", err);
  }

  cachedPreferences = updated;
  return updated;
}

/**
 * Đặt lại toàn bộ cấu hình thông báo về mặc định ban đầu:
 * - Xóa sạch token, chat ID, recipient lists tùy biến
 * - Bật lại các sự kiện theo mặc định
 */
export function resetNotificationPreferences(): NotificationPreferences {
  const reset: NotificationPreferences = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    updatedAt: new Date().toISOString(),
  };

  try {
    const filePath = getPreferencesFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(reset, null, 2), "utf-8");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[Notifier] Lỗi ghi đè reset notification_preferences.json:", err);
  }

  cachedPreferences = reset;
  return reset;
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

const channelHealthMap: Record<"telegram" | "zalo" | "zaloBot" | "email", ChannelHealth> = {
  telegram: { consecutiveFailures: 0, lastFailedAt: null, lastSuccessAt: null, cooldownUntil: null },
  zalo: { consecutiveFailures: 0, lastFailedAt: null, lastSuccessAt: null, cooldownUntil: null },
  zaloBot: { consecutiveFailures: 0, lastFailedAt: null, lastSuccessAt: null, cooldownUntil: null },
  email: { consecutiveFailures: 0, lastFailedAt: null, lastSuccessAt: null, cooldownUntil: null },
};

export function recordChannelSuccess(channelId: "telegram" | "zalo" | "zaloBot" | "email") {
  const h = channelHealthMap[channelId];
  h.consecutiveFailures = 0;
  h.lastSuccessAt = Date.now();
  h.cooldownUntil = null;
}

export function recordChannelFailure(channelId: "telegram" | "zalo" | "zaloBot" | "email") {
  const h = channelHealthMap[channelId];
  h.consecutiveFailures += 1;
  h.lastFailedAt = Date.now();
  // Cooldown 2 phút nếu liên tục thất bại/quá thời gian chờ mạng
  h.cooldownUntil = Date.now() + 120000;
}

export function isChannelInCooldown(channelId: "telegram" | "zalo" | "zaloBot" | "email"): boolean {
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
    zaloBot: {
      inCooldown: isChannelInCooldown("zaloBot"),
      failures: channelHealthMap.zaloBot.consecutiveFailures,
      lastSuccess: channelHealthMap.zaloBot.lastSuccessAt,
    },
    email: {
      inCooldown: isChannelInCooldown("email"),
      failures: channelHealthMap.email.consecutiveFailures,
      lastSuccess: channelHealthMap.email.lastSuccessAt,
    },
  };
}

export function isAnyChannelConfigured(): boolean {
  const prefs = getNotificationPreferences();
  return (
    isTelegramConfigured(prefs.customTelegramChatId, prefs.customTelegramRecipients, prefs.customTelegramToken) ||
    isEmailConfigured(prefs) ||
    isZaloConfigured(prefs.customZaloPhone, prefs.customZaloGroupId, prefs.customZaloRecipients) ||
    isZaloBotConfigured(prefs.customZaloBotChatId, prefs.customZaloBotRecipients, prefs.customZaloBotToken)
  );
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
    id: "telegram" | "zalo" | "zaloBot" | "email";
    name: string;
    isConfigured: boolean;
    isEnabled: boolean;
    timeoutMs: number;
    send: () => Promise<string>;
  }> = [
    {
      id: "telegram",
      name: "Telegram Bot",
      isConfigured: isTelegramConfigured(
        prefs.customTelegramChatId,
        prefs.customTelegramRecipients,
        prefs.customTelegramToken
      ),
      isEnabled: prefs.sendToTelegram,
      timeoutMs: 5000, // Timeout 5s: nếu mạng ISP chặn hoặc lag quá 5s thì failover ngay
      send: async () => {
        await sendTelegramMessage(text, {
          customChatId: prefs.customTelegramChatId,
          recipients: prefs.customTelegramRecipients,
          customToken: prefs.customTelegramToken,
          decisionId: payload.decisionId,
        });
        return "Telegram Bot";
      },
    },
    {
      id: "zalo",
      name: "Zalo Auth",
      isConfigured: isZaloConfigured(prefs.customZaloPhone, prefs.customZaloGroupId, prefs.customZaloRecipients),
      isEnabled: prefs.sendToZalo,
      timeoutMs: 8000,
      send: async () => {
        let zaloText = text;
        if (payload.decisionId) {
          zaloText = `🔔 CẦN DUYỆT [DECISION-${payload.decisionId}]\n\n${payload.message}\n----------------------------------------\n👉 Bấm 'Trả lời' tin nhắn này và gõ 'OK' để duyệt, hoặc 'NO' để từ chối.`;
        }
        const res = await sendZaloMessage(zaloText, {
          phone: prefs.customZaloPhone,
          groupId: prefs.customZaloGroupId,
          recipients: prefs.customZaloRecipients,
        });
        return `Zalo Auth (${res.threadId})`;
      },
    },
    {
      id: "zaloBot",
      name: "Zalo Bot",
      isConfigured: isZaloBotConfigured(prefs.customZaloBotChatId, prefs.customZaloBotRecipients, prefs.customZaloBotToken),
      isEnabled: prefs.sendToZaloBot ?? false,
      timeoutMs: 8000,
      send: async () => {
        let zaloBotText = text;
        if (payload.decisionId) {
          const code = registerDecisionShortCode(payload.decisionId);
          zaloBotText = `🔔 **CẦN DUYỆT [DECISION-${payload.decisionId}]**\n\n${payload.message}\n----------------------------------------\n👉 Gõ **OK** hoặc gửi **👍** để duyệt ngay (hoặc **NO** / **👎** để từ chối)\n👉 Hoặc gõ: \`duyệt ${code}\``;
        }
        const res = await sendZaloBotMessage(zaloBotText, {
          customChatId: prefs.customZaloBotChatId,
          recipients: prefs.customZaloBotRecipients,
          customToken: prefs.customZaloBotToken,
        });
        const countInfo = res.deliveredCount && res.deliveredCount > 1 ? ` (${res.deliveredCount} đích nhận)` : "";
        return `Zalo Bot${countInfo}`;
      },
    },
    {
      id: "email",
      name: "Email (SMTP)",
      isConfigured: isEmailConfigured(prefs),
      isEnabled: prefs.sendToEmail,
      timeoutMs: 10000,
      send: async () => {
        await sendEmail(payload.title, payload.message, prefs);
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

  // Với sự kiện CẦN DUYỆT (DECISION / decisionId):
  // Phát đa kênh đồng thời (Broadcast) tới TẤT CẢ kênh được bật (Telegram + Zalo)
  // để Founder nhận được ngay lập tức trên mọi kênh mà không bị chặn bởi kênh khác.
  const isDecisionNotification = payload.category === "DECISION" || Boolean(payload.decisionId);

  if (isDecisionNotification) {
    const results = await Promise.allSettled(
      activeCandidates.map(async (candidate) => {
        const t0 = Date.now();
        try {
          const targetDetail = await withTimeout(
            candidate.send(),
            candidate.timeoutMs,
            `Kênh ${candidate.name}`
          );
          const durationMs = Date.now() - t0;
          recordChannelSuccess(candidate.id);
          return { success: true, name: candidate.name, durationMs, targetDetail };
        } catch (err: any) {
          const durationMs = Date.now() - t0;
          const isTimeout =
            err.message?.includes("không phản hồi") || err.message?.includes("quá");
          const errDetail = isTimeout
            ? `Quá ${candidate.timeoutMs / 1000}s không phản hồi (timeout)`
            : err.message || String(err);
          recordChannelFailure(candidate.id);
          return { success: false, name: candidate.name, durationMs, error: errDetail };
        }
      })
    );

    const successfulChannels: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.success) {
          dispatchLogs.push(`${r.value.name}: OK (${r.value.durationMs}ms, ${r.value.targetDetail})`);
          successfulChannels.push(r.value.name);
          delivered = true;
        } else {
          dispatchLogs.push(`${r.value.name}: Thất bại (${r.value.error}, sau ${r.value.durationMs}ms)`);
        }
      }
    }
    deliveredChannel = successfulChannels.join(", ");
  } else {
    // Với các sự kiện thông thường: Giữ cơ chế Failover tuần tự
    for (const candidate of activeCandidates) {
      const t0 = Date.now();
      try {
        const targetDetail = await withTimeout(
          candidate.send(),
          candidate.timeoutMs,
          `Kênh ${candidate.name}`
        );
        const durationMs = Date.now() - t0;
        dispatchLogs.push(`${candidate.name}: OK (${durationMs}ms, ${targetDetail})`);
        delivered = true;
        deliveredChannel = candidate.name;
        recordChannelSuccess(candidate.id);
        break;
      } catch (err: any) {
        const durationMs = Date.now() - t0;
        const isTimeout =
          err.message?.includes("không phản hồi") || err.message?.includes("quá");
        const errDetail = isTimeout
          ? `Quá ${candidate.timeoutMs / 1000}s không phản hồi (timeout)`
          : err.message || String(err);
        recordChannelFailure(candidate.id);
        dispatchLogs.push(
          `${candidate.name}: Thất bại (${errDetail}, sau ${durationMs}ms) -> Tự động chuyển dịch vụ`
        );
      }
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
    zaloBot: { configured: boolean; sent: boolean; error?: string };
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
  const emailConfigured = isEmailConfigured(prefs);
  const zaloConfigured = isZaloConfigured(prefs.customZaloPhone, prefs.customZaloGroupId, prefs.customZaloRecipients);
  const zaloBotConfigured = isZaloBotConfigured(prefs.customZaloBotChatId, prefs.customZaloBotRecipients, prefs.customZaloBotToken);
  const cleanResult = cleanDeliverableText(task.result);

  if (!telegramConfigured && !emailConfigured && !zaloConfigured && !zaloBotConfigured) {
    return {
      success: false,
      message: "Chưa cấu hình kênh Telegram, Email, Zalo Auth hoặc Zalo Bot trong hệ thống.",
      channels: {
        telegram: { configured: false, sent: false, error: "Chưa cấu hình TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID" },
        email: { configured: false, sent: false, error: "Chưa cấu hình SMTP_HOST/SMTP_USER/SMTP_PASS" },
        zalo: { configured: false, sent: false, error: "Chưa có phiên Zalo Auth hoặc chưa cấu hình SĐT/Nhóm Zalo" },
        zaloBot: { configured: false, sent: false, error: "Chưa cấu hình ZALO_BOT_TOKEN/ZALO_CHAT_ID" },
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
      zaloBot: { configured: zaloBotConfigured, sent: false },
    },
  };

  const telegramContent = `📋 *KẾT QUẢ BÀN GIAO TASK #${task.id.slice(0, 8)}*\n\n` +
    `📥 *Mục tiêu:*\n${task.objective}\n\n` +
    `📤 *Văn bản bàn giao / SOP:*\n${cleanResult}`;

  const emailSubject = `[AI-OPC Deliverable] #${task.id.slice(0, 8)} - ${task.title}`;
  const emailContent = `KẾT QUẢ BÀN GIAO CÔNG VIỆC / TÀI LIỆU SOP\n` +
    `==========================================\n\n` +
    `Task ID: #${task.id}\n` +
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
      await withTimeout(sendEmail(emailSubject, emailContent, prefs), 10000, "Email");
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
          recipients: prefs.customZaloRecipients,
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

  // Gửi Zalo Bot nếu được bật
  if (zaloBotConfigured && prefs.sendToZaloBot) {
    try {
      const zaloBotRes = await withTimeout(
        sendZaloBotMessage(telegramContent, {
          customChatId: prefs.customZaloBotChatId,
          recipients: prefs.customZaloBotRecipients,
          customToken: prefs.customZaloBotToken,
        }),
        10000,
        "ZaloBot"
      );
      result.channels.zaloBot.sent = true;
      resultsSummary.push(`Zalo Bot: OK (${zaloBotRes.deliveredCount || 1} đích)`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.channels.zaloBot.error = errMsg;
      resultsSummary.push(`Zalo Bot: lỗi (${errMsg})`);
    }
  } else if (!zaloBotConfigured) {
    result.channels.zaloBot.error = "Chưa cấu hình Zalo Bot";
  } else {
    result.channels.zaloBot.error = "Đã tắt trong cài đặt Founder";
  }

  const anySent =
    result.channels.telegram.sent ||
    result.channels.email.sent ||
    result.channels.zalo.sent ||
    result.channels.zaloBot.sent;
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

/**
 * Gửi một tin nhắn tạm biệt tới đúng kênh khi Admin bấm tắt kênh đó trong
 * Settings UI. Hàm này gửi trực tiếp qua primitive của kênh (không qua
 * notifyFounder vì kênh đó sắp bị disabled ngay sau khi lưu).
 *
 * Nếu kênh chưa được cấu hình (.env), hàm bỏ qua im lặng (không có gì để gửi).
 */
export async function sendFarewellToChannel(
  channelId: "telegram" | "zalo" | "zaloBot" | "email",
  prefs: NotificationPreferences
): Promise<void> {
  const farewellText = "🔕 *Admin đã tắt kênh liên lạc này.* Bạn sẽ không nhận được thêm thông báo qua kênh này cho đến khi được bật lại.";

  try {
    if (
      channelId === "telegram" &&
      isTelegramConfigured(
        prefs.customTelegramChatId,
        prefs.customTelegramRecipients,
        prefs.customTelegramToken
      )
    ) {
      await sendTelegramMessage(farewellText, {
        customChatId: prefs.customTelegramChatId,
        recipients: prefs.customTelegramRecipients,
        customToken: prefs.customTelegramToken,
      });
    } else if (channelId === "zaloBot" && isZaloBotConfigured(prefs.customZaloBotChatId, prefs.customZaloBotRecipients, prefs.customZaloBotToken)) {
      await sendZaloBotMessage(farewellText, {
        customChatId: prefs.customZaloBotChatId,
        recipients: prefs.customZaloBotRecipients,
        customToken: prefs.customZaloBotToken,
      });
    } else if (channelId === "zalo" && isZaloConfigured(prefs.customZaloPhone, prefs.customZaloGroupId, prefs.customZaloRecipients)) {
      await sendZaloMessage(farewellText, {
        phone: prefs.customZaloPhone,
        groupId: prefs.customZaloGroupId,
        recipients: prefs.customZaloRecipients,
      });
    } else if (channelId === "email" && isEmailConfigured(prefs)) {
      await sendEmail(
        "Kênh thông báo Email đã bị tắt",
        "Admin đã tắt kênh liên lạc Email. Bạn sẽ không nhận được thêm thông báo qua địa chỉ email này cho đến khi được bật lại.",
        prefs
      );
    }
  } catch (err) {
    // Lỗi gửi tạm biệt không được phép block luồng lưu cấu hình
    console.warn(`[Notifier] Không gửi được tin tạm biệt tới kênh ${channelId}:`, err);
  }
}
