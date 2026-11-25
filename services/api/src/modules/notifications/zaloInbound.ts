/**
 * Zalo Inbound — Tiếp nhận và xử lý lệnh điều hành từ xa qua Zalo (2-way Controller).
 *
 * Tính năng thông minh nâng cao trải nghiệm người dùng:
 *   1. Bóc tách Quote chuẩn zca-js: Nhận diện nội dung trích dẫn qua quote.msg, quote.content, quote.text.
 *   2. Nhận diện ngữ cảnh tự động (Context-Aware Auto-Detect):
 *      - Nếu Founder chỉ gõ "OK", "Duyệt", "Đồng ý" (dù KHÔNG Quote):
 *        + Nếu có 1 quyết định PENDING: Tự động duyệt ngay lập tức!
 *        + Nếu có nhiều quyết định PENDING: Liệt kê danh sách đánh số (1, 2, 3...) để Founder gõ "1" hoặc "Duyệt 1".
 *   3. Nhận diện ngôn ngữ tự nhiên tiếng Việt phong phú: ok, okie, duyệt, đồng ý, được, yes, no, từ chối, hủy...
 *   4. Bảo mật 2FA mượt mà cho Risk cao (R3/R4): Hướng dẫn nhập OTP 6 số và tự động thực thi khi nhập đúng.
 *   5. Lệnh điều hành trực tiếp: /duyet <id>, /status, /stop, /report, /goal, /do @agent.
 */

import { db } from "../../db/client";
import { env } from "../../config/env";
import { getSavedZaloSession } from "../auth/zaloAuthService";
import {
  getAuthenticatedZaloApi,
  resolveAllConfiguredZaloIdentities,
  getKnownIdentityByUid,
} from "./zalo";
import { parseFounderCommand, dispatchFounderCommand } from "../commands/commandParser";
import {
  approveDecision,
  rejectDecision,
  decisionNeedsTotp,
  verifyFounderTotp,
} from "../decisions/decisionService";
import { getNotificationPreferences } from "./notifier";

interface PendingTotp {
  decisionId: string;
  expiresAt: number;
}

const TOTP_WAIT_MS = 5 * 60 * 1000;
const pendingTotpByThread = new Map<string, PendingTotp>();

let isListenerActive = false;
let activeListenerApi: any = null;
let reconnectTimer: NodeJS.Timeout | null = null;

// Tập hợp từ khóa phê duyệt tiếng Việt & tiếng Anh
const APPROVE_KEYWORDS = new Set([
  "ok", "oke", "okie", "duyet", "duyệt", "đồng ý", "dong y",
  "approve", "y", "yes", "được", "duoc", "thực hiện", "thuc hien", "chấp nhận", "chap nhan",
  "like", "👍", "❤️", "👌", "✅"
]);

// Tập hợp từ khóa từ chối
const REJECT_KEYWORDS = new Set([
  "no", "tuchoi", "từ chối", "tu choi", "reject", "n", "huy", "hủy",
  "không", "khong", "cancel", "bỏ qua", "bo qua", "ko",
  "dislike", "👎", "❌", "🚫"
]);

async function isAuthorizedSender(senderId: string, threadId?: string, apiInstance?: any): Promise<boolean> {
  const cleanSender = String(senderId).trim();
  const cleanThread = threadId ? String(threadId).trim() : "";

  // Phân giải toàn bộ danh tính SĐT & Nhóm Zalo hợp lệ từ .env và Preferences
  const { allowedUids, allowedGroupIds } = await resolveAllConfiguredZaloIdentities(apiInstance);

  const isUidMatch = allowedUids.has(cleanSender) || (cleanThread ? allowedUids.has(cleanThread) : false);
  const isGroupMatch = cleanThread ? allowedGroupIds.has(cleanThread) : false;

  if (isUidMatch || isGroupMatch) {
    const known = getKnownIdentityByUid(cleanSender) || (cleanThread ? getKnownIdentityByUid(cleanThread) : undefined);
    if (known) {
      console.log(`[zaloInbound] ✅ Xác thực Founder/Admin thành công: senderId="${cleanSender}" (SĐT: ${known.phone}, Tên: ${known.displayName || "Zalo User"})`);
    } else {
      console.log(`[zaloInbound] ✅ Xác thực Founder/Admin thành công qua ID: ${cleanSender}${cleanThread ? ` (Thread: ${cleanThread})` : ""}`);
    }
    return true;
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
    const agentLines = r.agents.map((a) => `• ${a.name}: ${a.status}`).join("\n");
    return `📊 [TÌNH HÌNH DOANH NGHIỆP]\n${agentLines}\n\nQuyết định chờ duyệt: ${r.pendingDecisions} | Tasks đang chạy: ${r.runningTasks}`;
  }
  if (type === "/stop") return "🛑 Toàn bộ Agent và tiến trình đang chạy đã được chuyển sang SUSPENDED.";
  if (type === "/goal")
    return "✅ AI-COO đã tiếp nhận goal và đang phân rã — theo dõi tiến độ trên Web app hoặc chờ thông báo tiếp theo.";
  if (type === "/do" && result && typeof result === "object" && "message" in result) {
    return (result as { message: string }).message;
  }
  return "✅ Đã xử lý lệnh thành công.";
}

async function resolveDecisionId(rawId: string): Promise<string | null> {
  const cleanId = rawId.trim();
  const found = await db.decisionPackage.findFirst({
    where: {
      OR: [
        { id: cleanId },
        { id: cleanId.replace(/^DECISION-/i, "") },
        { id: `dp_${cleanId.replace(/^DECISION-/i, "")}` },
      ],
    },
  });
  return found?.id ?? null;
}

/**
 * Thực hiện hành động Duyệt hoặc Từ chối với kiểm tra 2FA
 */
async function handleDecisionAction(
  decisionId: string,
  action: "APPROVE" | "REJECT",
  senderId: string,
  reply: (text: string) => void
): Promise<void> {
  const targetDecision = await db.decisionPackage.findUnique({
    where: { id: decisionId },
    include: { task: true },
  });

  if (!targetDecision) {
    reply(`❌ Không tìm thấy quyết định tương ứng với mã "${decisionId}".`);
    return;
  }

  if (targetDecision.status !== "PENDING") {
    reply(
      `ℹ️ Quyết định #${targetDecision.id.slice(0, 8)} đã được xử lý trước đó (trạng thái: ${targetDecision.status}).`
    );
    return;
  }

  if (action === "APPROVE") {
    const needsTotp = await decisionNeedsTotp(targetDecision.id).catch(() => false);
    if (needsTotp) {
      pendingTotpByThread.set(senderId, {
        decisionId: targetDecision.id,
        expiresAt: Date.now() + TOTP_WAIT_MS,
      });
      reply(
        `🔒 Quyết định "${targetDecision.decisionTitle}" có mức độ rủi ro ${targetDecision.riskLevel} (Cần Founder 2FA).\n👉 Vui lòng gửi mã OTP 6 số từ Google Authenticator để xác nhận duyệt (hết hạn sau 5 phút).`
      );
      return;
    }

    reply(`⏳ Đang duyệt quyết định "${targetDecision.decisionTitle}" (#${targetDecision.id.slice(0, 8)})...`);
    const result = await approveDecision(targetDecision.id);
    reply(
      `✅ Đã phê duyệt thành công quyết định "${targetDecision.decisionTitle}"!\nKết quả thực thi: ${result.execution.status}`
    );
    return;
  }

  if (action === "REJECT") {
    reply(`⏳ Đang từ chối quyết định "${targetDecision.decisionTitle}" (#${targetDecision.id.slice(0, 8)})...`);
    await rejectDecision(targetDecision.id);
    reply(`❌ Đã từ chối quyết định "${targetDecision.decisionTitle}".`);
    return;
  }
}

export function setupZaloMessageListener(api: any): void {
  if (!api || !api.listener) return;

  api.listener.on("message", async (message: any) => {
    const isPlainText = typeof message?.data?.content === "string";
    if (message.isSelf || !isPlainText) return;

    const senderId = String(message.data.senderId || message.threadId);
    const content = String(message.data.content).trim();

    console.log(`[zaloInbound] Nhận tin nhắn từ senderId="${senderId}", threadId="${message.threadId}": "${content}"`);

    // 1. Kiểm tra quyền truy cập Founder/Admin
    const authorized = await isAuthorizedSender(senderId, message.threadId, api);
    if (!authorized) {
      console.warn(
        `[zaloInbound] Cảnh báo: Người lạ (ID: ${senderId}, Thread: ${message.threadId}) gửi tin: "${content}". Bỏ qua.`
      );
      return;
    }

    const reply = (text: string) => {
      if (typeof api.sendMessage === "function") {
        api.sendMessage(
          { msg: text, quote: message.data },
          message.threadId,
          message.type
        ).catch((err: any) => {
          console.error("[zaloInbound] Lỗi gửi tin nhắn phản hồi:", err);
        });
      }
    };

    try {
      // -------------------------------------------------------------
      // XỬ LÝ 2FA CHO QUYẾT ĐỊNH RỦI RO CAO (R3/R4)
      // -------------------------------------------------------------
      const pending = pendingTotpByThread.get(senderId);
      if (pending) {
        if (Date.now() > pending.expiresAt) {
          pendingTotpByThread.delete(senderId);
          reply("⏰ Đã hết hạn chờ mã 2FA (5 phút). Vui lòng gửi lại lệnh duyệt hoặc vào Web app.");
          return;
        }
        if (!/^\d{6}$/.test(content)) {
          reply("Vui lòng gửi đúng mã 6 số từ app Authenticator (hoặc bỏ qua để làm việc khác).");
          return;
        }
        pendingTotpByThread.delete(senderId);
        const valid = await verifyFounderTotp(content);
        if (!valid) {
          reply("❌ Mã 2FA không đúng. Vào Web app để duyệt nếu cần.");
          return;
        }
        const result = await approveDecision(pending.decisionId);
        reply(
          `✅ Đã xác thực 2FA và phê duyệt thành công #${pending.decisionId.slice(0, 8)}!\nKết quả thực thi: ${result.execution.status}`
        );
        return;
      }

      // -------------------------------------------------------------
      // BÓC TÁCH QUOTE (TRÍCH DẪN) CHUẨN ZCA-JS
      // Trong zca-js TQuote, nội dung nằm ở quote.msg (hoặc quote.content / quote.text)
      // -------------------------------------------------------------
      const quote = message.data?.quote;
      const quoteText = quote ? String(quote.msg || quote.content || quote.text || "") : "";

      if (quoteText) {
        console.log(`[zaloInbound] Phát hiện nội dung trích dẫn (Quote): "${quoteText.slice(0, 100)}..."`);
        const match = quoteText.match(/\[(?:DECISION-)?([a-zA-Z0-9_-]+)\]/i);

        if (match) {
          const rawId = match[1];
          const resolvedId = await resolveDecisionId(rawId);

          if (resolvedId) {
            const lowerCmd = content.toLowerCase();
            if (APPROVE_KEYWORDS.has(lowerCmd)) {
              await handleDecisionAction(resolvedId, "APPROVE", senderId, reply);
              return;
            }
            if (REJECT_KEYWORDS.has(lowerCmd)) {
              await handleDecisionAction(resolvedId, "REJECT", senderId, reply);
              return;
            }
          }
        }
      }

      // -------------------------------------------------------------
      // NHẬN DIỆN NGỮ CẢNH TỰ ĐỘNG (CONTEXT-AWARE AUTO-DETECT)
      // Người dùng gõ "OK" / "Duyệt" / "1" / "Duyệt 1" mà KHÔNG cần Quote
      // -------------------------------------------------------------
      const lowerContent = content.toLowerCase();
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
          reply("ℹ️ Hiện tại không có quyết định nào đang chờ phê duyệt.");
          return;
        }

        // Trường hợp 1: Chỉ có DUY NHẤT 1 quyết định chờ duyệt -> Tự động duyệt ngay!
        if (pendingDecisions.length === 1 && (isDirectApprove || isDirectReject)) {
          const action = isDirectApprove ? "APPROVE" : "REJECT";
          console.log(`[zaloInbound] Tự động khớp quyết định duy nhất: ${pendingDecisions[0].id}`);
          await handleDecisionAction(pendingDecisions[0].id, action, senderId, reply);
          return;
        }

        // Trường hợp 2: Người dùng chọn theo số thứ tự (ví dụ: '1', 'Duyệt 1', 'Từ chối 2')
        const indexStr = indexedApproveMatch?.[1] || indexedRejectMatch?.[1] || numberOnlyMatch?.[1];
        if (indexStr) {
          const idx = parseInt(indexStr, 10);
          if (idx >= 1 && idx <= pendingDecisions.length) {
            const selected = pendingDecisions[idx - 1];
            const action = indexedRejectMatch ? "REJECT" : "APPROVE";
            console.log(`[zaloInbound] Khớp quyết định số ${idx}: ${selected.id}`);
            await handleDecisionAction(selected.id, action, senderId, reply);
            return;
          } else {
            reply(`❌ Số thứ tự không hợp lệ. Vui lòng chọn từ 1 đến ${pendingDecisions.length}.`);
            return;
          }
        }

        // Trường hợp 3: Có nhiều quyết định chờ duyệt và người dùng gõ chung chung "OK" / "NO"
        // Liệt kê danh sách đánh số để Founder chọn nhanh
        const listLines = pendingDecisions
          .map((d: any, i: number) => {
            const taskInfo = d.task ? `\n   📋 Task: ${d.task.title}` : "";
            return `${i + 1}. [${d.id.slice(0, 8)}] ${d.decisionTitle} (Risk ${d.riskLevel})${taskInfo}`;
          })
          .join("\n\n");

        reply(
          `📋 Đang có ${pendingDecisions.length} quyết định chờ duyệt:\n\n${listLines}\n\n👉 Trả lời 'Duyệt 1' hoặc gõ '1' để duyệt quyết định 1 (hoặc 'Từ chối 1').`
        );
        return;
      }

      // -------------------------------------------------------------
      // DUYỆT QUA CÚ PHÁP TRỰC TIẾP (/duyet <id>, /tuchoi <id>)
      // -------------------------------------------------------------
      if (/^\/(approve|duyet)\s+/i.test(content)) {
        const parts = content.split(/\s+/);
        const rawId = parts[1];
        const targetDecisionId = await resolveDecisionId(rawId);

        if (!targetDecisionId) {
          reply(`❌ Không tìm thấy quyết định tương ứng với mã "${rawId}".`);
          return;
        }

        await handleDecisionAction(targetDecisionId, "APPROVE", senderId, reply);
        return;
      }

      if (/^\/(reject|tuchoi)\s+/i.test(content)) {
        const parts = content.split(/\s+/);
        const rawId = parts[1];
        const targetDecisionId = await resolveDecisionId(rawId);

        if (!targetDecisionId) {
          reply(`❌ Không tìm thấy quyết định tương ứng với mã "${rawId}".`);
          return;
        }

        await handleDecisionAction(targetDecisionId, "REJECT", senderId, reply);
        return;
      }

      // -------------------------------------------------------------
      // LỆNH DỪNG KHẨN CẤP /stop (RULE 12)
      // -------------------------------------------------------------
      if (content.toLowerCase() === "/stop" || content.toLowerCase() === "stop all") {
        reply("🚨 [EMERGENCY STOP] Đang gửi tín hiệu ngắt toàn bộ workflow...");
        const parsed = parseFounderCommand("/stop");
        await dispatchFounderCommand(parsed);
        reply("🛑 Toàn bộ Agent và tiến trình đang chạy đã được chuyển sang SUSPENDED.");
        return;
      }

      // -------------------------------------------------------------
      // LỆNH TRUY VẤN TIẾN ĐỘ /status HOẶC /report
      // -------------------------------------------------------------
      if (content.toLowerCase() === "/status") {
        reply("⏳ Đang tổng hợp trạng thái hoạt động...");
        const parsed = parseFounderCommand("/status");
        const result = await dispatchFounderCommand(parsed);
        reply(formatCommandResult("/status", result));
        return;
      }

      if (content.startsWith("/report")) {
        reply("⏳ Đang tổng hợp báo cáo...");
        const parsed = parseFounderCommand(content);
        const result = await dispatchFounderCommand(parsed);
        reply(formatCommandResult("/report", result));
        return;
      }

      // -------------------------------------------------------------
      // RA LỆNH CHIẾN LƯỢC /goal HOẶC GIAO NHIỆM VỤ /do
      // -------------------------------------------------------------
      if (
        content.startsWith("/goal") ||
        content.startsWith("/do") ||
        content.startsWith("/plan") ||
        content.startsWith("/analyze")
      ) {
        reply(`🧠 AI-COO đã tiếp nhận lệnh: "${content}". Đang xử lý...`);
        const parsed = parseFounderCommand(content);
        const result = await dispatchFounderCommand(parsed, {
          origin: "ZALO",
          originId: String(message.threadId || senderId),
        });
        reply(formatCommandResult(parsed.type, result));
        return;
      }

      // Hướng dẫn trợ giúp nếu lệnh không khớp
      reply(
        "💡 Các lệnh hỗ trợ qua Zalo:\n" +
        "• Trả lời (Quote) tin nhắn thông báo: gõ OK (duyệt) hoặc NO (từ chối)\n" +
        "• Gõ 'OK' hoặc 'Duyệt' để duyệt ngay task đang chờ\n" +
        "• /duyet <MÃ_QUYẾT_ĐỊNH>\n" +
        "• /status (Xem tình hình công ty)\n" +
        "• /stop (Dừng khẩn cấp mọi Agent)\n" +
        "• /goal <mục tiêu> (Giao việc cho AI-COO)\n" +
        "• /do @agent <task> (Giao việc trực tiếp cho Agent)"
      );
    } catch (error: any) {
      console.error("[zaloInbound] Lỗi thực thi lệnh:", error);
      reply(`⚠️ Có lỗi xảy ra khi thực thi lệnh: ${error.message || String(error)}`);
    }
  });
}

let _reconnectAttempts = 0;
const MAX_RECONNECT_DELAY_MS = 30000;

function getReconnectDelayMs(): number {
  // Exponential backoff: 5s, 10s, 20s, tối đa 30s
  return Math.min(MAX_RECONNECT_DELAY_MS, 5000 * Math.pow(2, Math.min(_reconnectAttempts, 3)));
}

/**
 * Khởi động Zalo Inbound Listener nếu đã có phiên Zalo Auth.
 * Tự động kết nối lại khi kết nối WS bị ngắt (ECONNRESET, code 1006, v.v.)
 * với cơ chế exponential backoff (5s → 10s → 20s → 30s).
 */
export async function startZaloInboundListener(): Promise<void> {
  const session = getSavedZaloSession();
  if (!session) {
    console.log("[zaloInbound] Chưa có phiên Zalo Auth, bỏ qua khởi động listener.");
    return;
  }

  if (isListenerActive) {
    console.log("[zaloInbound] Zalo listener đã đang hoạt động.");
    return;
  }

  try {
    const api = await getAuthenticatedZaloApi(session);
    if (!api || !api.listener) {
      console.warn("[zaloInbound] Instance Zalo không hỗ trợ listener.");
      return;
    }

    console.log("[zaloInbound] Đang khởi động Zalo listener nhận lệnh điều hành 2 chiều...");
    setupZaloMessageListener(api);
    void resolveAllConfiguredZaloIdentities(api).catch((err) => {
      console.warn("[zaloInbound] Pre-warming danh tính Zalo thất bại:", err?.message || err);
    });

    // ----------------------------------------------------------------
    // Bắt lỗi WebSocket (ECONNRESET, TLS error, v.v.)
    // Nếu KHÔNG gắn handler này, Node sẽ ném unhandled 'error' event
    // và crash toàn bộ tiến trình (ERR_UNHANDLED_ERROR).
    // ----------------------------------------------------------------
    if (typeof api.listener.on === "function") {
      api.listener.on("error", (err: any) => {
        const code = err?.code || err?.message || String(err);
        // ECONNRESET (code 1006) là trường hợp bình thường — server Zalo ngắt kết nối
        // định kỳ do rotation hoặc keepalive timeout. Chỉ log ngắn gọn, không panic.
        if (code === "ECONNRESET" || code === "-4077" || String(code).includes("ECONNRESET")) {
          console.warn("[zaloInbound] Kết nối Zalo WS bị ngắt (ECONNRESET) — sẽ tự kết nối lại.");
        } else {
          console.error("[zaloInbound] Lỗi WebSocket:", err?.message || code);
        }
        // isListenerActive sẽ được reset bởi handler 'close' bên dưới
      });

      api.listener.on("close", (code: number, reason: string) => {
        if (isListenerActive) {
          isListenerActive = false;
          activeListenerApi = null;
          _reconnectAttempts++;
          const delayMs = getReconnectDelayMs();
          console.warn(
            `[zaloInbound] Kết nối WS đóng (code: ${code}${reason ? `, lý do: ${reason}` : ""}). ` +
            `Thử kết nối lại sau ${Math.round(delayMs / 1000)}s (lần thứ ${_reconnectAttempts})...`
          );
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            void startZaloInboundListener();
          }, delayMs);
        }
      });
    }

    api.listener.start();
    activeListenerApi = api;
    isListenerActive = true;
    _reconnectAttempts = 0; // Reset backoff sau khi kết nối thành công
    console.log("[zaloInbound] Zalo listener đã sẵn sàng lắng nghe tin nhắn!");
  } catch (err: any) {
    isListenerActive = false;
    activeListenerApi = null;
    _reconnectAttempts++;
    const delayMs = getReconnectDelayMs();
    console.error(
      `[zaloInbound] Không thể khởi động Zalo listener: ${err?.message || err}. ` +
      `Thử lại sau ${Math.round(delayMs / 1000)}s...`
    );
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      void startZaloInboundListener();
    }, delayMs);
  }
}

/**
 * Dừng hoàn toàn Zalo Inbound Listener và hủy các bộ đếm reconnect
 */
export function stopZaloInboundListener(): void {
  isListenerActive = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (activeListenerApi?.listener && typeof activeListenerApi.listener.stop === "function") {
    try {
      activeListenerApi.listener.stop();
    } catch {}
  }
  activeListenerApi = null;
  _reconnectAttempts = 0;
  console.log("[zaloInbound] Đã dừng Zalo inbound listener.");
}
