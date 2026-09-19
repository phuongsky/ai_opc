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
 */
import { env } from "../../config/env";

export function isTelegramConfigured(): boolean {
  return Boolean(env.telegramBotToken && env.telegramChatId);
}

async function postTelegramMessage(chatId: string, text: string, parseMode: "Markdown" | undefined = "Markdown"): Promise<void> {
  const url = `https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };
  if (parseMode) {
    body.parse_mode = parseMode;
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
    if (parseMode === "Markdown" && (errText.includes("can't parse entities") || errText.includes("parse error") || res.status === 400)) {
      return postTelegramMessage(chatId, text, undefined);
    }
    throw new Error(`Telegram API lỗi (${res.status}): ${errText}`);
  }
}

export async function sendTelegramMessage(text: string, customChatId?: string | null): Promise<void> {
  const chatId = customChatId || env.telegramChatId;
  if (!env.telegramBotToken || !chatId) {
    throw new Error("Chưa cấu hình TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID trong .env");
  }

  const MAX_CHUNK_LENGTH = 3800;
  if (text.length <= MAX_CHUNK_LENGTH) {
    await postTelegramMessage(chatId, text);
    return;
  }

  // Chia nhỏ tin nhắn nếu vượt quá giới hạn độ dài của Telegram
  for (let i = 0; i < text.length; i += MAX_CHUNK_LENGTH) {
    const chunk = text.slice(i, i + MAX_CHUNK_LENGTH);
    const chunkHeader = text.length > MAX_CHUNK_LENGTH ? `[Phần ${Math.floor(i / MAX_CHUNK_LENGTH) + 1}/${Math.ceil(text.length / MAX_CHUNK_LENGTH)}]\n` : "";
    await postTelegramMessage(chatId, chunkHeader + chunk);
  }
}
