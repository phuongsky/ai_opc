/**
 * Zalo Bot Inbound — Nhận lệnh từ Zalo Bot Platform (Founder Command dạng text: /goal,
 * /status, /stop, /report — hoặc gõ "duyệt <mã>"/"từ chối <mã>" cho Decision Package),
 * xử lý bằng ĐÚNG cùng logic với Web app/Telegram Inbound
 * (dispatchFounderCommand, approveDecision/rejectDecision).
 *
 * Tính năng thông minh nâng cao trải nghiệm người dùng:
 *   1. Nhận diện ngữ cảnh tự động (Context-Aware Auto-Detect):
 *      - Khi Founder chỉ gõ "OK", "Duyệt", "Đồng ý", "Được", "Yes" (hoặc "NO", "Từ chối", "Hủy"):
 *        + Nếu có 1 quyết định PENDING: Tự động duyệt / từ chối ngay lập tức mà KHÔNG cần Quote hay gõ mã!
 *        + Nếu có nhiều quyết định PENDING: Liệt kê danh sách đánh số (1, 2, 3...) để Founder gõ "1" hoặc "Duyệt 1".
 *   2. Bóc tách Quote (Trả lời trích dẫn) tin nhắn thông báo cũ.
 *   3. Nhận diện ngôn ngữ tự nhiên tiếng Việt phong phú: ok, duyệt, đồng ý, được, yes, no, từ chối, hủy...
 *   4. Bảo mật 2FA mượt mà cho Risk cao (R3/R4): Hướng dẫn nhập OTP 6 số và tự động thực thi khi nhập đúng.
 *   5. Lệnh điều hành trực tiếp: /status, /stop, /goal, /do @agent, /duyet <id>, /tuchoi <id>.
 */
import { randomBytes } from "crypto";
import { db } from "../../db/client";
import { env } from "../../config/env";
import { parseFounderCommand, dispatchFounderCommand } from "../commands/commandParser";
import {
  approveDecision,
  rejectDecision,
  decisionNeedsTotp,
  verifyFounderTotp,
} from "../decisions/decisionService";
import { ZALO_BOT_API_PRIMARY, ZALO_BOT_API_FALLBACK, getEffectiveZaloBotToken } from "./zaloBot";

interface ZaloApiResponse<T = unknown> {
  ok?: boolean;
  error_code?: number;
  description?: string;
  result?: T;
}

const processedMessageIds = new Set<string>();
const MAX_TRACKED_IDS = 500;

let isPolling = false;
let consecutiveFailures = 0;
let nextPollAllowedAt = 0;
let _pollingTimer: NodeJS.Timeout | null = null;
let _pollingIntervalMs = 3000;

// Bộ từ khóa tiếng Việt & Emoji nhận diện phê duyệt / từ chối tự nhiên
// Lưu ý: Zalo client gửi emoticon dạng chuỗi thô (/-strong, /-heart...)
// thay vì Unicode emoji thật — cần thêm cả 2 dạng để nhận diện đúng.
const APPROVE_KEYWORDS = new Set([
  "ok",
  "oke",
  "okie",
  "duyet",
  "duyệt",
  "approve",
  "y",
  "yes",
  "dong y",
  "đồng ý",
  "được",
  "duoc",
  "thực hiện",
  "thuc hien",
  "chấp nhận",
  "chap nhan",
  "like",
  // Unicode emoji (hiển thị trực tiếp)
  "👍",
  "❤️",
  "👌",
  "✅",
  // Zalo raw emoticon strings — Zalo client tự mã hoá emoji thành chuỗi này
  "/-strong",   // 👍
  "/-heart",    // ❤️
  "/-ok",       // 👌
  "/-yes",      // ✅
  "/-like",     // like
]);

const REJECT_KEYWORDS = new Set([
  "no",
  "tuchoi",
  "từ chối",
  "reject",
  "n",
  "huy",
  "hủy",
  "không",
  "khong",
  "hủy bỏ",
  "huy bo",
  "dislike",
  // Unicode emoji (hiển thị trực tiếp)
  "👎",
  "❌",
  "🚫",
  // Zalo raw emoticon strings
  "/-weak",     // 👎
  "/-no",       // ❌ / 🚫
]);

// Mã ngắn tra cứu decisionId thật — Founder gõ tay mã này (ví dụ A1B2C3)
interface ShortCodeEntry {
  decisionId: string;
  expiresAt: number;
}
const SHORT_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const shortCodes = new Map<string, ShortCodeEntry>();

export function registerDecisionShortCode(decisionId: string): string {
  const code = randomBytes(3).toString("hex").toUpperCase(); // vd "A1B2C3"
  shortCodes.set(code, { decisionId, expiresAt: Date.now() + SHORT_CODE_TTL_MS });
  return code;
}

export function resolveShortCode(code: string): string | null {
  const entry = shortCodes.get(code.toUpperCase().trim());
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.decisionId;
}

interface PendingTotp {
  decisionId: string;
  expiresAt: number;
}
const TOTP_WAIT_MS = 5 * 60 * 1000;
const pendingTotpByChat = new Map<string, PendingTotp>();

async function callZaloBotApi<T = unknown>(
  method: string,
  body: Record<string, unknown>,
  timeoutMs = 20000
): Promise<ZaloApiResponse<T>> {
  const token = getEffectiveZaloBotToken();
  if (!token) throw new Error("Chưa cấu hình ZALO_BOT_TOKEN trong Cài đặt hoặc .env");

  const endpoints = [ZALO_BOT_API_PRIMARY, ZALO_BOT_API_FALLBACK];
  let lastError: Error | null = null;

  for (const base of endpoints) {
    try {
      const res = await fetch(`${base}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const data = (await res.json().catch(() => ({}))) as ZaloApiResponse<T>;
      return data;
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Thử endpoint tiếp theo nếu domain chính lỗi hoặc timeout
      continue;
    }
  }

  throw lastError || new Error("Không thể kết nối đến Zalo Bot API");
}

async function reply(chatId: string | number, text: string): Promise<void> {
  await callZaloBotApi(
    "sendMessage",
    {
      chat_id: String(chatId),
      text,
      parse_mode: "markdown",
    },
    10000
  );
}

function isAuthorizedChat(chatId: string | number): boolean {
  const target = String(chatId).trim();
  if (!target) return false;

  if (env.zaloChatId && target === env.zaloChatId.trim()) return true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getNotificationPreferences } = require("./notifier");
    const prefs = getNotificationPreferences();
    if (prefs.customZaloBotChatId && target === prefs.customZaloBotChatId.trim()) return true;

    if (prefs.customZaloBotRecipients && Array.isArray(prefs.customZaloBotRecipients)) {
      for (const r of prefs.customZaloBotRecipients) {
        if (r.chatId && target === r.chatId.trim()) return true;
        if (r.groupId && target === r.groupId.trim()) return true;
      }
    }
  } catch (err) {
    // ignore
  }

  return false;
}

async function resolveDecisionId(rawId: string): Promise<string | null> {
  const clean = rawId.trim();

  // 1. Tra cứu theo mã ngắn (ví dụ A1B2C3)
  const fromShortCode = resolveShortCode(clean);
  if (fromShortCode) return fromShortCode;

  // 2. Tra cứu trực tiếp theo UUID / Decision ID
  const exact = await db.decisionPackage.findUnique({
    where: { id: clean },
  });
  if (exact) return exact.id;

  // 3. Tra cứu bỏ tiền tố DECISION- nếu có
  const stripped = clean.replace(/^DECISION-/i, "");
  const exactStripped = await db.decisionPackage.findUnique({
    where: { id: stripped },
  });
  if (exactStripped) return exactStripped.id;

  // 4. Tra cứu theo tiền tố (ví dụ dp_bd01)
  const byPrefix = await db.decisionPackage.findFirst({
    where: {
      id: {
        startsWith: stripped,
      },
    },
  });
  if (byPrefix) return byPrefix.id;

  return null;
}

async function handleDecisionAction(
  decisionId: string,
  action: "APPROVE" | "REJECT",
  chatId: string | number,
  replyFn: (text: string) => Promise<void>
): Promise<void> {
  const targetDecision = await db.decisionPackage.findUnique({
    where: { id: decisionId },
    include: { task: true },
  });

  if (!targetDecision) {
    await replyFn(`❌ Không tìm thấy quyết định [${decisionId}].`);
    return;
  }

  if (targetDecision.status !== "PENDING") {
    await replyFn(
      `ℹ️ Quyết định "${targetDecision.decisionTitle}" đã được xử lý trước đó (trạng thái: **${targetDecision.status}**).`
    );
    return;
  }

  if (action === "APPROVE") {
    const needsTotp = await decisionNeedsTotp(targetDecision.id).catch(() => false);
    if (needsTotp) {
      pendingTotpByChat.set(String(chatId), {
        decisionId: targetDecision.id,
        expiresAt: Date.now() + TOTP_WAIT_MS,
      });
      await replyFn(
        `⚠️ **Quyết định rủi ro cao (${targetDecision.riskLevel})** — "${targetDecision.decisionTitle}".\n` +
          `Vui lòng gửi mã 6 số từ app Authenticator để xác nhận duyệt (hết hạn sau 5 phút).`
      );
      return;
    }

    await replyFn(`⏳ Đang phê duyệt quyết định "${targetDecision.decisionTitle}" (#${targetDecision.id.slice(0, 8)})...`);
    const result = await approveDecision(targetDecision.id);
    await replyFn(
      `✅ **Đã phê duyệt thành công** #${targetDecision.id.slice(0, 8)}!\nKết quả thực thi: *${result.execution.status}*`
    );
    return;
  }

  if (action === "REJECT") {
    await replyFn(`⏳ Đang từ chối quyết định "${targetDecision.decisionTitle}" (#${targetDecision.id.slice(0, 8)})...`);
    await rejectDecision(targetDecision.id);
    await replyFn(`❌ **Đã từ chối quyết định** "${targetDecision.decisionTitle}".`);
    return;
  }
}

function formatCommandResult(type: string, result: unknown): string {
  if (type === "/report" && result && typeof result === "object" && "report" in result) {
    return (result as { report: string }).report;
  }
  if (type === "/status" && result && typeof result === "object" && "agents" in result) {
    const r = result as {
      agents: { name: string; status: string }[];
      pendingDecisions: number;
      runningTasks: number;
    };
    const agentLines = r.agents.map((a) => `  • **${a.name}**: ${a.status}`).join("\n");
    return `📊 **Trạng thái công ty**:\n${agentLines}\n\nChờ duyệt: **${r.pendingDecisions}** | Đang chạy: **${r.runningTasks}**`;
  }
  if (type === "/stop") return "🛑 **Đã dừng khẩn cấp toàn bộ Agent.**";
  if (type === "/goal") {
    return "🧠 **Đã nhận mục tiêu**, AI-COO đang phân rã — theo dõi trong Web app hoặc chờ thông báo tiếp theo.";
  }
  return "✅ Đã xử lý lệnh thành công.";
}

async function handleTextMessage(
  chatId: string | number,
  text: string,
  quoteText?: string
): Promise<void> {
  const trimmed = text.trim();
  const chatKey = String(chatId);
  const replyFn = (msg: string) => reply(chatId, msg);

  // 1. Kiểm tra nếu đang chờ 2FA TOTP
  const pending = pendingTotpByChat.get(chatKey);
  if (pending) {
    if (Date.now() > pending.expiresAt) {
      pendingTotpByChat.delete(chatKey);
      await replyFn("⏱️ Đã hết hạn chờ mã 2FA (5 phút). Vui lòng gửi lại lệnh duyệt.");
      return;
    }
    if (!/^\d{6}$/.test(trimmed)) {
      await replyFn("⚠️ Vui lòng gửi đúng 6 chữ số từ app Authenticator.");
      return;
    }
    pendingTotpByChat.delete(chatKey);
    const valid = await verifyFounderTotp(trimmed);
    if (!valid) {
      await replyFn("❌ Mã 2FA không chính xác. Vui lòng thử lại hoặc duyệt trên Web app.");
      return;
    }
    const result = await approveDecision(pending.decisionId);
    await replyFn(
      `✅ Xác thực 2FA thành công! Đã duyệt [#${pending.decisionId.slice(0, 8)}] — Kết quả: *${result.execution.status}*`
    );
    return;
  }

  // 2. Bóc tách Quote (Trả lời trích dẫn) tin nhắn thông báo cũ
  if (quoteText) {
    const match = quoteText.match(/\[(?:DECISION-)?([a-zA-Z0-9_-]+)\]/i);
    if (match) {
      const rawId = match[1];
      const resolvedId = await resolveDecisionId(rawId);
      if (resolvedId) {
        const lowerCmd = trimmed.toLowerCase();
        if (APPROVE_KEYWORDS.has(lowerCmd)) {
          await handleDecisionAction(resolvedId, "APPROVE", chatId, replyFn);
          return;
        }
        if (REJECT_KEYWORDS.has(lowerCmd)) {
          await handleDecisionAction(resolvedId, "REJECT", chatId, replyFn);
          return;
        }
      }
    }
  }

  // 3. Nhận diện ngữ cảnh tự động (Context-Aware Auto-Detect)
  // Founder gõ "OK", "Duyệt", "1", "Duyệt 1", "NO", "Từ chối" mà KHÔNG cần Quote
  const lowerContent = trimmed.toLowerCase();
  const isDirectApprove = APPROVE_KEYWORDS.has(lowerContent);
  const isDirectReject = REJECT_KEYWORDS.has(lowerContent);

  const indexedApproveMatch = lowerContent.match(/^(?:duyệt|duyet|ok|approve|dong y|đồng ý)\s*(\d+)$/i);
  const indexedRejectMatch = lowerContent.match(/^(?:từ chối|tu choi|no|reject|hủy|huy)\s*(\d+)$/i);
  const numberOnlyMatch = lowerContent.match(/^(\d+)$/);

  if (isDirectApprove || isDirectReject || indexedApproveMatch || indexedRejectMatch || numberOnlyMatch) {
    const pendingDecisions = await db.decisionPackage.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: { task: true },
    });

    if (pendingDecisions.length === 0) {
      await replyFn("ℹ️ Hiện tại không có quyết định nào đang chờ phê duyệt.");
      return;
    }

    // Trường hợp 1: Chỉ có DUY NHẤT 1 quyết định chờ duyệt -> Tự động duyệt / từ chối ngay!
    if (pendingDecisions.length === 1 && (isDirectApprove || isDirectReject)) {
      const action = isDirectApprove ? "APPROVE" : "REJECT";
      console.log(`[zaloBotInbound] Context-Aware: Tự động khớp quyết định duy nhất: ${pendingDecisions[0].id}`);
      await handleDecisionAction(pendingDecisions[0].id, action, chatId, replyFn);
      return;
    }

    // Trường hợp 2: Người dùng chọn theo số thứ tự (ví dụ: '1', 'Duyệt 1', 'Từ chối 2')
    const indexStr = indexedApproveMatch?.[1] || indexedRejectMatch?.[1] || numberOnlyMatch?.[1];
    if (indexStr) {
      const idx = parseInt(indexStr, 10);
      if (idx >= 1 && idx <= pendingDecisions.length) {
        const selected = pendingDecisions[idx - 1];
        const action = indexedRejectMatch ? "REJECT" : "APPROVE";
        console.log(`[zaloBotInbound] Khớp quyết định số ${idx}: ${selected.id}`);
        await handleDecisionAction(selected.id, action, chatId, replyFn);
        return;
      } else {
        await replyFn(`❌ Số thứ tự không hợp lệ. Vui lòng chọn từ 1 đến ${pendingDecisions.length}.`);
        return;
      }
    }

    // Trường hợp 3: Có nhiều quyết định chờ duyệt và người dùng gõ chung chung "OK" / "NO"
    const listLines = pendingDecisions
      .map((d: any, i: number) => {
        const taskInfo = d.task ? `\n   📋 Task: ${d.task.title}` : "";
        return `${i + 1}. [${d.id.slice(0, 8)}] **${d.decisionTitle}** (Risk ${d.riskLevel})${taskInfo}`;
      })
      .join("\n\n");

    await replyFn(
      `📋 **Đang có ${pendingDecisions.length} quyết định chờ duyệt**:\n\n${listLines}\n\n` +
        `👉 Gõ '**1**' hoặc '**Duyệt 1**' để duyệt quyết định 1 (hoặc '**Từ chối 1**').`
    );
    return;
  }

  // 4. Nhận diện cú pháp duyệt / từ chối mã ngắn hoặc ID (duyệt <MÃ>, từ chối <MÃ>, /duyet <ID>)
  const directApproveMatch = trimmed.match(/^(?:\/duyet|\/approve|duyệt|duyet)\s+([a-zA-Z0-9_-]+)/i);
  const directRejectMatch = trimmed.match(/^(?:\/tuchoi|\/reject|từ chối|tu choi)\s+([a-zA-Z0-9_-]+)/i);

  if (directApproveMatch) {
    const rawId = directApproveMatch[1];
    const resolvedId = await resolveDecisionId(rawId);
    if (!resolvedId) {
      await replyFn(`⚠️ Không tìm thấy quyết định tương ứng với mã "${rawId}".`);
      return;
    }
    await handleDecisionAction(resolvedId, "APPROVE", chatId, replyFn);
    return;
  }

  if (directRejectMatch) {
    const rawId = directRejectMatch[1];
    const resolvedId = await resolveDecisionId(rawId);
    if (!resolvedId) {
      await replyFn(`⚠️ Không tìm thấy quyết định tương ứng với mã "${rawId}".`);
      return;
    }
    await handleDecisionAction(resolvedId, "REJECT", chatId, replyFn);
    return;
  }

  // 5. Xử lý các lệnh Founder Command (/status, /stop, /goal, /do, /report)
  try {
    const parsed = parseFounderCommand(trimmed);
    const result = await dispatchFounderCommand(parsed, {
      origin: "ZALOBOT",
      originId: String(chatId),
    });
    await replyFn(formatCommandResult(parsed.type, result));
  } catch (err) {
    await replyFn(
      `${err instanceof Error ? err.message : "Lệnh không hợp lệ"}\n\n` +
        `💡 **Các lệnh hỗ trợ**:\n` +
        `• Gõ '**OK**' hoặc '**Duyệt**' (tự động duyệt quyết định đang chờ)\n` +
        `• Gõ '**NO**' hoặc '**Từ chối**' (từ chối quyết định)\n` +
        `• /status (Xem tình hình công ty)\n` +
        `• /stop (Dừng khẩn cấp mọi Agent)\n` +
        `• /goal <mục tiêu> (Giao việc cho AI-COO)\n` +
        `• /do @agent <task> (Giao việc trực tiếp)`
    );
  }
}

export async function pollZaloBotUpdates(): Promise<void> {
  // Chống chồng chéo request & kiểm tra cấu hình
  if (isPolling) return;
  const token = getEffectiveZaloBotToken();
  if (!token) return;

  // Nếu đang trong thời gian backoff sau lỗi mạng thực sự, tạm thời bỏ qua
  if (Date.now() < nextPollAllowedAt) return;

  isPolling = true;
  try {
    // Theo docs Zalo: timeout là string số giây server Zalo giữ kết nối (mặc định 30s)
    // Ta truyền timeout = "15" (15s) và client fetch timeout = 20s (20000ms) để không bao giờ bị ngắt ngang
    const data = await callZaloBotApi<unknown>(
      "getUpdates",
      { timeout: "15" },
      20000
    );

    // Xử lý phản hồi từ Zalo server:
    // Nếu ok === false: kiểm tra xem có phải 408 Request timeout (hết 15s không có tin nhắn mới)
    if (data.ok === false) {
      if (data.error_code === 408 || data.description?.toLowerCase().includes("timeout")) {
        // Đây là trạng thái bình thường của Long Polling khi chưa có tin nhắn
        consecutiveFailures = 0;
        return;
      }
      // Lỗi khác (401 token sai, 404...): log cảnh báo ngắn
      console.warn(`[zaloBotInbound] getUpdates trả về (${data.error_code}): ${data.description}`);
      return;
    }

    // Trích xuất tin nhắn đa hình (Polymorphic): hỗ trợ cả mảng [...] hoặc đối tượng đơn {...}
    let rawList: any[] = [];
    if (Array.isArray(data.result)) {
      rawList = data.result;
    } else if (data.result && typeof data.result === "object") {
      rawList = [data.result];
    }

    if (rawList.length === 0) {
      consecutiveFailures = 0;
      return;
    }

    consecutiveFailures = 0;

    for (const item of rawList) {
      if (!item) continue;
      const msg = item.message || item;
      const text = typeof msg.text === "string" ? msg.text : undefined;
      const chatId = msg.chat?.id || msg.from?.id || msg.sender_id;
      const msgId = String(msg.message_id || msg.id || item.update_id || `${chatId}-${text}-${Date.now()}`);

      if (!text || !chatId) continue;

      if (processedMessageIds.has(msgId)) continue;
      processedMessageIds.add(msgId);
      if (processedMessageIds.size > MAX_TRACKED_IDS) {
        const oldest = processedMessageIds.values().next().value;
        if (oldest) processedMessageIds.delete(oldest);
      }

      if (!isAuthorizedChat(chatId)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[zaloBotInbound] Nhận tin từ chat/nhóm: ${chatId} ("${text}") ` +
            `— Bỏ qua vì Chat ID này chưa có trong danh sách Cài đặt Zalo Bot hoặc .env. ` +
            `(Hãy copy ID này vào Cài đặt Zalo Bot trên Web hoặc ZALO_CHAT_ID trong .env để cấp quyền)`
        );
        continue;
      }

      // Trích xuất thông tin Quote nếu có
      const quote = msg.quote || item.quote || msg.reply_to_message;
      const quoteText = quote ? String(quote.msg || quote.text || quote.content || "") : undefined;

      console.log(`[zaloBotInbound] Nhận lệnh từ Founder (${chatId}): "${text}"`);
      await handleTextMessage(chatId, text, quoteText);
    }
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const isTimeout = errMsg.toLowerCase().includes("timeout") || errMsg.toLowerCase().includes("aborted");

    if (isTimeout) {
      // Khi client hoặc server timeout trong quá trình Long Polling:
      // Đây là chu kỳ bình thường của kết nối idle, không tính là lỗi mạng
      consecutiveFailures = 0;
      return;
    }

    consecutiveFailures++;
    // Tự động giãn thời gian thử lại khi lỗi mạng thật sự (DNS lỗi, mất mạng): 5s, 10s, tối đa 30s
    const backoffMs = Math.min(30000, 2000 * Math.pow(2, Math.min(consecutiveFailures, 4)));
    nextPollAllowedAt = Date.now() + backoffMs;

    if (consecutiveFailures === 1 || consecutiveFailures % 5 === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[zaloBotInbound] Kết nối Zalo Bot Platform gián đoạn (${errMsg}), thử lại sau ${Math.round(
          backoffMs / 1000
        )}s...`
      );
    }
  } finally {
    isPolling = false;
  }
}

export function startZaloBotInboundPolling(intervalMs: number): NodeJS.Timeout {
  _pollingIntervalMs = intervalMs;
  // eslint-disable-next-line no-console
  console.log(`[zaloBotInbound] Bắt đầu long-poll Zalo Bot mỗi ${intervalMs}ms (timeout: 15s)`);
  _pollingTimer = setInterval(() => {
    void pollZaloBotUpdates();
  }, intervalMs);
  return _pollingTimer;
}

export function stopZaloBotInboundPolling(): void {
  if (_pollingTimer) {
    clearInterval(_pollingTimer);
    _pollingTimer = null;
    // eslint-disable-next-line no-console
    console.log("[zaloBotInbound] Đã dừng polling theo yêu cầu Admin.");
  }
}

export function restartZaloBotInboundPolling(): void {
  stopZaloBotInboundPolling();
  startZaloBotInboundPolling(_pollingIntervalMs);
  // eslint-disable-next-line no-console
  console.log("[zaloBotInbound] Đã khởi động lại polling.");
}
