/**
 * Telegram Inbound — nhận lệnh TỪ Telegram (Founder Command dạng text như
 * /goal, /do, /status, /stop, /report — hoặc tap nút Duyệt/Từ chối Decision
 * Package), xử lý bằng ĐÚNG cùng logic với Web app (dispatchFounderCommand,
 * approveDecision/rejectDecision) — KHÔNG có "đường tắt" governance riêng
 * cho kênh Telegram.
 *
 * Dùng LONG POLLING (getUpdates) — không cần domain public/HTTPS, chạy được
 * ngay trên localhost, cùng kiểu poll với agentWorker.ts/periodicJobs.ts.
 *
 * BẢO MẬT: chỉ xử lý message/callback từ ĐÚNG chat_id đã cấu hình
 * (TELEGRAM_CHAT_ID trong .env) — mọi chat khác bị bỏ qua im lặng, không phản
 * hồi (tránh lộ thông tin đây là bot điều khiển công ty cho người lạ).
 *
 * 2FA: Decision rủi ro cao (R3/R4) tap "✅ Duyệt" KHÔNG duyệt ngay — bot hỏi
 * lại mã 6 số, Founder gửi đúng mã mới thực sự approve. Không tạo lỗ hổng
 * bỏ qua 2FA qua kênh mới.
 */
import { env } from "../../config/env";
import { getEffectiveTelegramBotToken, isTelegramConfigured } from "./telegram";
import { getNotificationPreferences } from "./notifier";
import { parseFounderCommand, dispatchFounderCommand } from "../commands/commandParser";
import {
  approveDecision,
  rejectDecision,
  decisionNeedsTotp,
  verifyFounderTotp,
} from "../decisions/decisionService";

interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat: { id: number } };
  callback_query?: { id: string; data?: string; message?: { chat?: { id: number } } };
}

let offset = 0;
let isPolling = false;
let _pollingTimer: NodeJS.Timeout | null = null;
let _pollingIntervalMs = 2000;
let _tokenErrorCooldownUntil = 0;
let _lastLoggedErrorCode: number | null = null;

interface PendingTotp {
  decisionId: string;
  expiresAt: number;
}
const TOTP_WAIT_MS = 5 * 60 * 1000;
const pendingTotpByChat = new Map<number, PendingTotp>();

async function callTelegramApi<T = unknown>(
  method: string,
  body: Record<string, unknown>
): Promise<T> {
  const token = getEffectiveTelegramBotToken();
  if (!token) throw new Error("Chưa cấu hình Telegram Bot Token");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000), // Timeout 10s tránh treo kết nối vĩnh viễn
  });
  return res.json() as Promise<T>;
}

async function reply(chatId: number, text: string): Promise<void> {
  try {
    const res = await callTelegramApi<{ ok: boolean; description?: string }>("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    });
    if (!res.ok) {
      console.warn(
        `[telegramInbound] Gửi tin nhắn Markdown thất bại (${res.description}), thử lại dạng text thô...`
      );
      await callTelegramApi("sendMessage", { chat_id: chatId, text });
    }
  } catch (err) {
    console.error("[telegramInbound] Lỗi khi gửi phản hồi:", err);
    try {
      await callTelegramApi("sendMessage", { chat_id: chatId, text });
    } catch {
      // bỏ qua lỗi fallback cuối
    }
  }
}

async function answerCallback(callbackQueryId: string, text?: string): Promise<void> {
  await callTelegramApi("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

function isAuthorizedChat(chatId: number): boolean {
  const strId = String(chatId).trim();
  if (env.telegramChatId && strId === env.telegramChatId.trim()) return true;

  try {
    const prefs = getNotificationPreferences();
    if (prefs.customTelegramChatId && strId === prefs.customTelegramChatId.trim()) {
      return true;
    }
    if (prefs.customTelegramRecipients && Array.isArray(prefs.customTelegramRecipients)) {
      const match = prefs.customTelegramRecipients.some(
        (r) => r.chatId && r.chatId.trim() === strId
      );
      if (match) return true;
    }
  } catch {
    // ignore
  }

  return false;
}

function formatCommandResult(type: string, result: unknown): string {
  if (type === "/report" && result && typeof result === "object" && "report" in result) {
    const rep = (result as { report: any }).report;
    if (typeof rep === "string") return rep;
    if (rep && typeof rep === "object" && "markdown" in rep) return rep.markdown;
  }
  if (type === "/status" && result && typeof result === "object" && "agents" in result) {
    const r = result as {
      agents: { name: string; status: string }[];
      pendingDecisions: number;
      runningTasks: number;
    };
    const agentLines = r.agents.map((a) => `  • ${a.name}: ${a.status}`).join("\n");
    return `📊 *Trạng thái công ty*\n${agentLines}\n\nChờ duyệt: ${r.pendingDecisions} | Đang chạy: ${r.runningTasks}`;
  }
  if (type === "/stop") return "🛑 Đã dừng khẩn cấp toàn bộ Agent.";
  if (type === "/goal")
    return "✅ Đã nhận goal, AI-COO đang phân rã — theo dõi kết quả trong Web app hoặc chờ thông báo tiếp theo.";
  if (type === "/do" && result && typeof result === "object" && "message" in result) {
    return (result as { message: string }).message;
  }
  return "✅ Đã xử lý lệnh.";
}

async function handleTextMessage(chatId: number, text: string): Promise<void> {
  const trimmed = text.trim();

  // Đang chờ mã 2FA cho 1 decision rủi ro cao?
  const pending = pendingTotpByChat.get(chatId);
  if (pending) {
    if (Date.now() > pending.expiresAt) {
      pendingTotpByChat.delete(chatId);
      await reply(chatId, "⏰ Đã hết hạn chờ mã 2FA (5 phút). Bấm lại nút Duyệt hoặc vào Web app.");
      return;
    }
    if (!/^\d{6}$/.test(trimmed)) {
      await reply(
        chatId,
        "Vui lòng gửi đúng mã 6 số từ app Authenticator (hoặc bỏ qua để làm việc khác)."
      );
      return; // giữ nguyên pending, cho thử lại
    }
    pendingTotpByChat.delete(chatId);
    const valid = await verifyFounderTotp(trimmed);
    if (!valid) {
      await reply(chatId, "❌ Mã 2FA không đúng. Vào Web app để duyệt nếu cần.");
      return;
    }
    const result = await approveDecision(pending.decisionId);
    await reply(chatId, `✅ Đã duyệt và thực thi — kết quả: *${result.execution.status}*`);
    return;
  }

  // Founder Command bình thường
  try {
    console.log(`[telegramInbound] Đang xử lý lệnh "${trimmed}" từ chat ${chatId}...`);
    const parsed = parseFounderCommand(trimmed);
    const result = await dispatchFounderCommand(parsed, {
      origin: "TELEGRAM",
      originId: String(chatId),
    });
    await reply(chatId, formatCommandResult(parsed.type, result));
    console.log(`[telegramInbound] Đã gửi phản hồi thành công tới chat ${chatId}`);
  } catch (err) {
    console.warn(`[telegramInbound] Lỗi xử lý lệnh "${trimmed}":`, err);
    await reply(
      chatId,
      `❓ ${err instanceof Error ? err.message : "Lệnh không hợp lệ"}\n\nLệnh hỗ trợ: /goal, /do @agent <task>, /status, /stop, /report weekly`
    );
  }
}

async function handleCallbackQuery(
  callbackQueryId: string,
  chatId: number,
  data: string
): Promise<void> {
  const [action, decisionId] = data.split(":");
  if (!decisionId) return;

  if (action === "reject") {
    await rejectDecision(decisionId);
    await answerCallback(callbackQueryId, "Đã từ chối");
    await reply(chatId, "❌ Đã từ chối decision.");
    return;
  }

  if (action === "approve") {
    const needsTotp = await decisionNeedsTotp(decisionId).catch(() => false);
    if (needsTotp) {
      pendingTotpByChat.set(chatId, { decisionId, expiresAt: Date.now() + TOTP_WAIT_MS });
      await answerCallback(callbackQueryId, "Cần mã 2FA");
      await reply(
        chatId,
        "🔒 Decision rủi ro cao — gửi mã 6 số từ app Authenticator để xác nhận duyệt (hết hạn sau 5 phút)."
      );
      return;
    }
    const result = await approveDecision(decisionId);
    await answerCallback(callbackQueryId, "Đã duyệt");
    await reply(chatId, `✅ Đã duyệt và thực thi — kết quả: *${result.execution.status}*`);
  }
}

export async function pollTelegramUpdates(): Promise<void> {
  if (isPolling) return; // Chống chồng chéo request gây 409 Conflict

  // Đang trong thời gian cooldown sau khi gặp lỗi token/auth?
  if (Date.now() < _tokenErrorCooldownUntil) return;

  const token = getEffectiveTelegramBotToken();
  const prefs = getNotificationPreferences();
  const isConfigured = isTelegramConfigured(
    prefs.customTelegramChatId,
    prefs.customTelegramRecipients,
    prefs.customTelegramToken
  );
  if (!token || !isConfigured) return;

  isPolling = true;
  try {
    const data = await callTelegramApi<{
      ok: boolean;
      error_code?: number;
      description?: string;
      result?: TelegramUpdate[];
    }>("getUpdates", {
      offset: offset + 1,
      timeout: 0,
    });

    if (!data.ok) {
      if (data.error_code === 404 || data.error_code === 401) {
        // Token không hợp lệ hoặc sai bot — giãn cách polling 60s và chỉ cảnh báo 1 lần
        _tokenErrorCooldownUntil = Date.now() + 60000;
        if (_lastLoggedErrorCode !== data.error_code) {
          _lastLoggedErrorCode = data.error_code;
          console.warn(
            `[telegramInbound] ⚠️ Token bot Telegram không hợp lệ (${data.error_code}: ${data.description}). Tạm dừng polling 60s để tránh spam. Vui lòng kiểm tra lại token tại Cài đặt.`
          );
        }
      } else if (data.error_code !== 409) {
        console.warn(`[telegramInbound] getUpdates lỗi (${data.error_code}): ${data.description}`);
      }
      return;
    }

    // Khi thành công, reset trạng thái lỗi cooldown
    _tokenErrorCooldownUntil = 0;
    _lastLoggedErrorCode = null;

    if (!Array.isArray(data.result) || data.result.length === 0) return;

    for (const update of data.result) {
      offset = Math.max(offset, update.update_id);

      if (update.message?.text) {
        const chatId = update.message.chat.id;
        console.log(`[telegramInbound] Nhận tin nhắn từ chat ${chatId}: "${update.message.text}"`);
        if (!isAuthorizedChat(chatId)) {
          console.warn(
            `[telegramInbound] Bỏ qua message từ chat không xác định: ${chatId} (TELEGRAM_CHAT_ID: ${env.telegramChatId})`
          );
          continue;
        }
        await handleTextMessage(chatId, update.message.text);
      }

      if (update.callback_query) {
        const chatId = update.callback_query.message?.chat?.id;
        if (!chatId) continue;
        console.log(`[telegramInbound] Nhận callback query từ chat ${chatId}: "${update.callback_query.data}"`);
        if (!isAuthorizedChat(chatId)) {
          console.warn(
            `[telegramInbound] Bỏ qua callback từ chat không xác định: ${chatId} (TELEGRAM_CHAT_ID: ${env.telegramChatId})`
          );
          continue;
        }
        await handleCallbackQuery(
          update.callback_query.id,
          chatId,
          update.callback_query.data || ""
        );
      }
    }
  } catch (err) {
    console.error("[telegramInbound] Lỗi poll:", err);
  } finally {
    isPolling = false;
  }
}

export function startTelegramInboundPolling(intervalMs: number): NodeJS.Timeout {
  _pollingIntervalMs = intervalMs;
  console.log(`[telegramInbound] Bắt đầu long-poll Telegram mỗi ${intervalMs}ms`);
  _pollingTimer = setInterval(() => {
    void pollTelegramUpdates();
  }, intervalMs);
  return _pollingTimer;
}

export function stopTelegramInboundPolling(): void {
  if (_pollingTimer) {
    clearInterval(_pollingTimer);
    _pollingTimer = null;
    console.log("[telegramInbound] Đã dừng polling theo yêu cầu Admin.");
  }
}

export function restartTelegramInboundPolling(): void {
  _tokenErrorCooldownUntil = 0;
  _lastLoggedErrorCode = null;
  stopTelegramInboundPolling();
  startTelegramInboundPolling(_pollingIntervalMs);
  console.log("[telegramInbound] Đã khởi động lại polling.");
}
