/**
 * Client gửi tin nhắn qua Zalo Bot Platform (bot.zaloplatforms.com) — KHÁC
 * với Zalo Official Account (OA) API v3.0 cũ và KHÁC Zalo Auth (zca-js).
 * Tham khảo tài liệu chính thức: https://bot.zaloplatforms.com/docs/apis/sendMessage/
 */
import { env } from "../../config/env";
import type { ZaloBotRecipient } from "@ai-opc/shared";

export const ZALO_BOT_API_PRIMARY = "https://bot-api.zaloplatforms.com";
export const ZALO_BOT_API_FALLBACK = "https://bot-api.zapps.me";

export function getEffectiveZaloBotToken(customToken?: string | null): string {
  if (customToken?.trim()) return customToken.trim();
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getNotificationPreferences } = require("./notifier");
    const prefs = getNotificationPreferences();
    if (prefs.customZaloBotToken?.trim()) return prefs.customZaloBotToken.trim();
  } catch {
    // ignore
  }
  return env.zaloBotToken?.trim() || "";
}

export function isZaloBotConfigured(
  customChatId?: string | null,
  recipients?: ZaloBotRecipient[],
  customToken?: string | null
): boolean {
  const token = getEffectiveZaloBotToken(customToken);
  if (!token) return false;

  if (customChatId?.trim()) return true;
  if (env.zaloChatId?.trim()) return true;

  if (recipients && Array.isArray(recipients)) {
    const hasValid = recipients.some(
      (r) => Boolean(r.chatId?.trim()) || Boolean(r.groupId?.trim())
    );
    if (hasValid) return true;
  }

  return false;
}

export interface SendZaloBotOptions {
  customChatId?: string | null;
  recipients?: ZaloBotRecipient[];
  customToken?: string | null;
  parseMode?: "markdown" | "html";
}

export function extractZaloBotTargets(options?: SendZaloBotOptions): string[] {
  const targets = new Set<string>();

  if (options?.recipients && Array.isArray(options.recipients)) {
    for (const r of options.recipients) {
      if (r.chatId?.trim()) targets.add(r.chatId.trim());
      if (r.groupId?.trim()) targets.add(r.groupId.trim());
    }
  }

  if (options?.customChatId?.trim()) {
    targets.add(options.customChatId.trim());
  }

  if (targets.size === 0 && env.zaloChatId?.trim()) {
    targets.add(env.zaloChatId.trim());
  }

  return Array.from(targets);
}

/**
 * Chia văn bản dài thành các đoạn nhỏ sạch sẽ theo ngắt dòng/đoạn,
 * không bao giờ cắt vụn ở giữa từ hoặc làm rách thẻ Markdown.
 */
export function splitTextIntoCleanChunks(text: string, maxLen = 1900): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // 1. Ưu tiên ngắt tại đoạn văn \n\n
    let sliceIdx = remaining.lastIndexOf("\n\n", maxLen);
    // 2. Nếu không có, ngắt tại dòng mới \n
    if (sliceIdx === -1 || sliceIdx < maxLen * 0.4) {
      sliceIdx = remaining.lastIndexOf("\n", maxLen);
    }
    // 3. Nếu không có ngắt dòng, ngắt tại khoảng trắng
    if (sliceIdx === -1 || sliceIdx < maxLen * 0.4) {
      sliceIdx = remaining.lastIndexOf(" ", maxLen);
    }
    // 4. Fallback cuối cùng
    if (sliceIdx === -1 || sliceIdx < maxLen * 0.2) {
      sliceIdx = maxLen;
    }

    const chunk = remaining.slice(0, sliceIdx).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(sliceIdx).trim();
  }

  return chunks.length > 0 ? chunks : [text];
}

async function sendSingleZaloBotMessage(
  targetChatId: string,
  chunkText: string,
  parseMode: "markdown" | "html" = "markdown",
  customToken?: string | null
): Promise<{ messageId?: string | number }> {
  const token = getEffectiveZaloBotToken(customToken);
  if (!token) throw new Error("Chưa cấu hình ZALO_BOT_TOKEN trong Cài đặt hoặc .env");

  const endpoints = [ZALO_BOT_API_PRIMARY, ZALO_BOT_API_FALLBACK];
  let lastError: Error | null = null;

  for (const base of endpoints) {
    try {
      // 1. Thử gửi với parseMode (ví dụ: markdown)
      const res = await fetch(`${base}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: targetChatId,
          text: chunkText,
          parse_mode: parseMode,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Zalo Bot API HTTP lỗi (${res.status}): ${errText}`);
      }

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error_code?: number;
        description?: string;
        result?: { message_id?: string | number };
      };

      if (data.ok === true) {
        return { messageId: data.result?.message_id };
      }

      // 2. Nếu Zalo Bot từ chối (ví dụ: lỗi parse markdown 403), tự động fallback sang Plain Text
      console.warn(
        `[zaloBot] Zalo Bot API từ chối với parse_mode=${parseMode} (${data.error_code}: ${data.description}). Tự động fallback sang Plain Text...`
      );

      const fallbackRes = await fetch(`${base}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: targetChatId,
          text: chunkText,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (fallbackRes.ok) {
        const fbData = (await fallbackRes.json().catch(() => ({}))) as {
          ok?: boolean;
          error_code?: number;
          description?: string;
          result?: { message_id?: string | number };
        };
        if (fbData.ok === true) {
          console.log(`[zaloBot] Fallback Plain Text gửi thành công tới ${targetChatId}`);
          return { messageId: fbData.result?.message_id };
        }
      }

      throw new Error(`Zalo Bot API từ chối (${data.error_code}): ${data.description || "Internal server error"}`);
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }
  }

  throw lastError || new Error(`Không thể gửi tin nhắn Zalo Bot tới ${targetChatId}`);
}

export async function sendZaloBotMessage(
  text: string,
  options?: SendZaloBotOptions
): Promise<{ messageId?: string | number; deliveredCount?: number; targetIds?: string[] }> {
  const token = getEffectiveZaloBotToken(options?.customToken);
  const targets = extractZaloBotTargets(options);

  if (!token || targets.length === 0) {
    throw new Error("Chưa cấu hình ZALO_BOT_TOKEN hoặc Zalo Chat ID / ID nhóm trong Cài đặt hoặc .env");
  }

  const parseMode = options?.parseMode || "markdown";
  // Tách văn bản dài thành các đoạn an toàn theo ngắt dòng
  const chunks = splitTextIntoCleanChunks(text, 1900);

  let lastMessageId: string | number | undefined;
  const successfulTargets: string[] = [];

  for (const targetId of targets) {
    try {
      for (const chunk of chunks) {
        const res = await sendSingleZaloBotMessage(targetId, chunk, parseMode, options?.customToken);
        if (res.messageId) lastMessageId = res.messageId;
      }
      successfulTargets.push(targetId);
    } catch (err) {
      console.error(`[zaloBot] Lỗi gửi tới target ${targetId}:`, err);
    }
  }

  if (successfulTargets.length === 0) {
    throw new Error(`Gửi tin nhắn Zalo Bot thất bại tới tất cả đích`);
  }

  return {
    messageId: lastMessageId,
    deliveredCount: successfulTargets.length,
    targetIds: successfulTargets,
  };
}
