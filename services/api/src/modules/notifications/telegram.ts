/**
 * Client gửi thông báo qua Telegram Bot API — kênh "dễ làm nhất" vì chỉ cần
 * gọi HTTP thẳng, không cần thêm thư viện.
 *
 * Setup (1 lần):
 *   1. Mở Telegram, chat với @BotFather -> /newbot -> lấy TELEGRAM_BOT_TOKEN.
 *   2. Chat bất kỳ với bot vừa tạo (bấm Start).
 *   3. Mở https://api.telegram.org/bot<TOKEN>/getUpdates sau khi đã chat,
 *      tìm "chat":{"id": ...} -> đó là TELEGRAM_CHAT_ID.
 *   4. Điền cả 2 vào .env.
 *
 * QUAN TRỌNG: hệ thống dùng LONG POLLING (getUpdates) để nhận lệnh ngược lại
 * từ Telegram — KHÔNG được set Webhook cho bot này. Nếu trước đây từng gọi
 * setWebhook, chạy 1 lần: https://api.telegram.org/bot<TOKEN>/deleteWebhook
 */
import { env } from "../../config/env";
import type { TelegramRecipient } from "@ai-opc/shared";

/**
 * Chuẩn hóa thông minh Telegram Bot Token:
 * - Bỏ tiền tố TELEGRAM_BOT_TOKEN=, BOT_TOKEN=, token= nếu người dùng copy cả dòng từ .env
 * - Bóc tách token từ URL nếu người dùng dán link dạng https://api.telegram.org/bot<TOKEN>/...
 * - Bỏ tiền tố "bot" nếu dán dạng "bot123456:..."
 * - Loại bỏ dấu ngoặc kép/đơn bao quanh, khoảng trắng và ký tự xuống dòng
 */
export function cleanTelegramToken(raw?: string | null): string {
  if (!raw) return "";
  let token = raw.trim();

  // 1. Gỡ dấu nháy bao quanh
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'")) ||
    (token.startsWith("`") && token.endsWith("`"))
  ) {
    token = token.slice(1, -1).trim();
  }

  // 2. Bỏ tiền tố biến môi trường
  const prefixMatch = token.match(/^(?:TELEGRAM_BOT_TOKEN|TELEGRAM_TOKEN|BOT_TOKEN|TOKEN)\s*=\s*(.*)$/i);
  if (prefixMatch) {
    token = prefixMatch[1].trim();
  }

  // 3. Nếu người dùng dán cả URL: https://api.telegram.org/bot<TOKEN>/...
  const urlMatch = token.match(/api\.telegram\.org\/bot([^/?#\s]+)/i);
  if (urlMatch) {
    token = urlMatch[1].trim();
  }

  // 4. Gỡ dấu nháy lại nếu có sau khi cắt tiền tố
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'")) ||
    (token.startsWith("`") && token.endsWith("`"))
  ) {
    token = token.slice(1, -1).trim();
  }

  // 5. Nếu dán thừa "bot" ngay trước <id>:<hash> (ví dụ bot832848...:...)
  if (/^bot\d+:[A-Za-z0-9_-]+$/i.test(token)) {
    token = token.slice(3).trim();
  }

  return token.trim();
}

/**
 * Chuẩn hóa thông minh Telegram Chat ID:
 * - Bỏ tiền tố TELEGRAM_CHAT_ID= hoặc CHAT_ID=
 * - Bỏ dấu ngoặc kép, khoảng trắng
 */
export function cleanTelegramChatId(raw?: string | null): string {
  if (!raw) return "";
  let id = raw.trim();

  if (
    (id.startsWith('"') && id.endsWith('"')) ||
    (id.startsWith("'") && id.endsWith("'"))
  ) {
    id = id.slice(1, -1).trim();
  }

  const prefixMatch = id.match(/^(?:TELEGRAM_CHAT_ID|CHAT_ID)\s*=\s*(.*)$/i);
  if (prefixMatch) {
    id = prefixMatch[1].trim();
  }

  if (
    (id.startsWith('"') && id.endsWith('"')) ||
    (id.startsWith("'") && id.endsWith("'"))
  ) {
    id = id.slice(1, -1).trim();
  }

  return id.trim();
}

export function getEffectiveTelegramBotToken(customToken?: string | null): string {
  if (customToken) {
    const cleaned = cleanTelegramToken(customToken);
    if (cleaned) return cleaned;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getNotificationPreferences } = require("./notifier");
    const prefs = getNotificationPreferences();
    if (prefs.customTelegramToken) {
      const cleaned = cleanTelegramToken(prefs.customTelegramToken);
      if (cleaned) return cleaned;
    }
  } catch {
    // ignore
  }
  return cleanTelegramToken(env.telegramBotToken);
}

export function isTelegramConfigured(
  customChatId?: string | null,
  recipients?: TelegramRecipient[],
  customToken?: string | null
): boolean {
  const token = getEffectiveTelegramBotToken(customToken);
  if (!token) return false;

  const cleanChat = cleanTelegramChatId(customChatId);
  if (cleanChat) return true;

  const envChat = cleanTelegramChatId(env.telegramChatId);
  if (envChat) return true;

  if (recipients && Array.isArray(recipients)) {
    const hasValid = recipients.some((r) => Boolean(cleanTelegramChatId(r.chatId)));
    if (hasValid) return true;
  }

  // Tự động kiểm tra trong Cấu hình thông báo (Notification Preferences) lưu trên giao diện Settings
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getNotificationPreferences } = require("./notifier");
    const prefs = getNotificationPreferences();
    if (cleanTelegramChatId(prefs.customTelegramChatId)) return true;
    if (prefs.customTelegramRecipients && Array.isArray(prefs.customTelegramRecipients)) {
      const hasValid = prefs.customTelegramRecipients.some((r: any) =>
        Boolean(cleanTelegramChatId(r.chatId))
      );
      if (hasValid) return true;
    }
  } catch {
    // ignore
  }

  return false;
}

export interface TelegramSendOptions {
  customChatId?: string | null;
  recipients?: TelegramRecipient[];
  customToken?: string | null;
  /** Nếu có, gửi kèm 2 nút "✅ Duyệt" / "❌ Từ chối" gắn với decisionId này. */
  decisionId?: string;
}

export function extractTelegramTargets(options?: TelegramSendOptions): string[] {
  const targets = new Set<string>();

  if (options?.recipients && Array.isArray(options.recipients)) {
    for (const r of options.recipients) {
      const clean = cleanTelegramChatId(r.chatId);
      if (clean) targets.add(clean);
    }
  }

  if (options?.customChatId) {
    const clean = cleanTelegramChatId(options.customChatId);
    if (clean) targets.add(clean);
  }

  if (targets.size === 0) {
    if (env.telegramChatId) {
      const clean = cleanTelegramChatId(env.telegramChatId);
      if (clean) targets.add(clean);
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getNotificationPreferences } = require("./notifier");
      const prefs = getNotificationPreferences();
      if (prefs.customTelegramChatId) {
        const clean = cleanTelegramChatId(prefs.customTelegramChatId);
        if (clean) targets.add(clean);
      }
      if (prefs.customTelegramRecipients && Array.isArray(prefs.customTelegramRecipients)) {
        for (const r of prefs.customTelegramRecipients) {
          const clean = cleanTelegramChatId(r.chatId);
          if (clean) targets.add(clean);
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(targets);
}

async function postTelegramMessage(
  chatId: string,
  text: string,
  options?: TelegramSendOptions,
  parseMode: "Markdown" | undefined = "Markdown",
  tokenOverride?: string
): Promise<void> {
  const token = tokenOverride || getEffectiveTelegramBotToken(options?.customToken);
  if (!token) {
    throw new Error("Chưa cấu hình TELEGRAM_BOT_TOKEN trong Cài đặt hoặc .env");
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };
  if (parseMode) {
    body.parse_mode = parseMode;
  }

  if (options?.decisionId) {
    body.reply_markup = {
      inline_keyboard: [
        [
          { text: "✅ Duyệt", callback_data: `approve:${options.decisionId}` },
          { text: "❌ Từ chối", callback_data: `reject:${options.decisionId}` },
        ],
      ],
    };
  }

  // Tối ưu: Timeout 4s phản hồi nhanh (nếu mạng ISP bóp nghẹt Telegram thì failover ngay, không chờ 10s)
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "connection": "close",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });

  if (!res.ok) {
    const errText = await res.text();
    // Chỉ thử lại không Markdown nếu lỗi liên quan trực tiếp đến cú pháp format Markdown của Telegram
    if (
      parseMode === "Markdown" &&
      (errText.includes("can't parse entities") ||
        errText.includes("parse error") ||
        res.status === 400)
    ) {
      return postTelegramMessage(chatId, text, options, undefined, token);
    }
    throw new Error(`Telegram API lỗi (${res.status}): ${errText}`);
  }
}

export async function sendTelegramMessage(
  text: string,
  optionsOrChatId?: string | null | TelegramSendOptions
): Promise<void> {
  const options: TelegramSendOptions =
    typeof optionsOrChatId === "string" || optionsOrChatId === null || optionsOrChatId === undefined
      ? { customChatId: optionsOrChatId }
      : optionsOrChatId;

  const token = getEffectiveTelegramBotToken(options.customToken);
  const targets = extractTelegramTargets(options);

  if (!token || targets.length === 0) {
    throw new Error("Chưa cấu hình TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong Cài đặt hoặc .env");
  }

  const MAX_CHUNK_LENGTH = 3800;
  const chunks: string[] = [];
  if (text.length <= MAX_CHUNK_LENGTH) {
    chunks.push(text);
  } else {
    for (let i = 0; i < text.length; i += MAX_CHUNK_LENGTH) {
      chunks.push(text.slice(i, i + MAX_CHUNK_LENGTH));
    }
  }

  const sendPromises = targets.map(async (chatId) => {
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const chunkHeader = chunks.length > 1 ? `[Phần ${i + 1}/${chunks.length}]\n` : "";
      const chunkOptions = isLast ? options : { ...options, decisionId: undefined };
      await postTelegramMessage(chatId, chunkHeader + chunks[i], chunkOptions, "Markdown", token);
    }
  });

  await Promise.all(sendPromises);
}
