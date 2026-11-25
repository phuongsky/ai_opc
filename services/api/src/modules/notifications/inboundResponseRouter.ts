/**
 * Inbound Response Router — Định tuyến phản hồi kết quả Task trực tiếp về đúng kênh đã giao việc.
 *
 * Nguyên tắc hoạt động:
 * - Khi Founder giao việc từ Telegram, Zalo Auth, hoặc Zalo Bot, Task lưu kèm nguồn gốc trong `createdBy`
 *   (ví dụ: "TELEGRAM:5088200861", "ZALO:thread_123", "ZALOBOT:chat_456").
 * - Khi Task chuyển sang trạng thái COMPLETED, BLOCKED, hoặc AWAITING_INTERNAL_REVIEW:
 *   Router sẽ tự động gửi kết quả / báo cáo chi tiết về chính xác chat ID / thread ID của kênh đó.
 * - Không làm ảnh hưởng đến các cấu hình thông báo chung của Founder trong Settings.
 */
import { db } from "../../db/client";
import { sendTelegramMessage, isTelegramConfigured } from "./telegram";
import { sendZaloMessage, isZaloConfigured } from "./zalo";
import { sendZaloBotMessage, isZaloBotConfigured } from "./zaloBot";
import { cleanDeliverableText } from "@ai-opc/shared";

export interface TaskResultPayload {
  id: string;
  title: string;
  objective: string;
  assignedTo?: string | null;
  createdBy?: string | null;
  status: string;
  result?: string | null;
  parentTaskId?: string | null;
}

interface InboundOrigin {
  channel: "TELEGRAM" | "ZALO" | "ZALOBOT";
  targetId: string;
}

function parseInboundOrigin(createdBy?: string | null): InboundOrigin | null {
  if (!createdBy) return null;
  const parts = createdBy.split(":");
  if (parts.length < 2) return null;

  const prefix = parts[0].toUpperCase();
  const targetId = parts.slice(1).join(":");

  if (prefix === "TELEGRAM" || prefix === "INBOUND_TELEGRAM") {
    return { channel: "TELEGRAM", targetId };
  }
  if (prefix === "ZALO" || prefix === "INBOUND_ZALO") {
    return { channel: "ZALO", targetId };
  }
  if (prefix === "ZALOBOT" || prefix === "INBOUND_ZALOBOT") {
    return { channel: "ZALOBOT", targetId };
  }

  return null;
}

/**
 * Gửi thông báo kết quả Task trực tiếp tới kênh Inbound đã khởi tạo Task.
 */
export async function sendTaskResultToInboundChannel(task: TaskResultPayload): Promise<boolean> {
  // 1. Phân tích nguồn gốc từ chính Task hoặc từ Parent Task (nếu là subtask của Goal)
  let origin = parseInboundOrigin(task.createdBy);

  if (!origin && task.parentTaskId) {
    try {
      const parent = await db.task.findUnique({
        where: { id: task.parentTaskId },
        select: { createdBy: true },
      });
      if (parent) {
        origin = parseInboundOrigin(parent.createdBy);
      }
    } catch {
      // bỏ qua lỗi đọc parent
    }
  }

  // Nếu không phải task xuất phát từ kênh Inbound (ví dụ: tạo từ Web), không gửi ở đây
  if (!origin) {
    return false;
  }

  const rawResult = task.result || "";
  const cleanResult = cleanDeliverableText(rawResult);
  const agentLabel = task.assignedTo ? `Agent [${task.assignedTo}]` : "AI Agent";
  const shortId = task.id.slice(0, 8);

  console.log(
    `[inboundResponseRouter] Đang gửi kết quả task #${shortId} (${task.status}) về kênh ${origin.channel} (${origin.targetId})...`
  );

  try {
    if (origin.channel === "TELEGRAM") {
      if (!isTelegramConfigured(origin.targetId)) {
        console.warn(
          `[inboundResponseRouter] Không thể gửi kết quả về Telegram (${origin.targetId}): Bot chưa được cấu hình token hoặc chat ID hợp lệ.`
        );
        return false;
      }
      let text = "";
      if (task.status === "COMPLETED") {
        text =
          `✅ *[HOÀN THÀNH] Task #${shortId}*\n\n` +
          `📥 *Mục tiêu:* ${task.objective}\n\n` +
          `📤 *Kết quả bàn giao:*\n${cleanResult}`;
      } else if (task.status === "BLOCKED") {
        text =
          `⚠️ *[TẠM DỪNG / BLOCKED] Task #${shortId}*\n\n` +
          `❓ *Lý do:* ${cleanResult || "Cần thêm thông tin hoặc gặp lỗi trong quá trình thực thi."}`;
      } else if (task.status === "AWAITING_INTERNAL_REVIEW") {
        text =
          `📋 *[CHỜ ĐÁNH GIÁ NỘI BỘ] Task #${shortId}*\n\n` +
          `📝 *Báo cáo:* ${cleanResult}`;
      } else {
        text = `ℹ️ *[CẬP NHẬT] Task #${shortId}*: ${task.title} (Trạng thái: ${task.status})`;
      }

      await sendTelegramMessage(text, { customChatId: origin.targetId });
      console.log(`[inboundResponseRouter] Đã gửi kết quả Telegram thành công tới chat ${origin.targetId}`);
      return true;
    }

    if (origin.channel === "ZALO") {
      if (!isZaloConfigured(origin.targetId)) {
        console.warn(
          `[inboundResponseRouter] Không thể gửi kết quả về Zalo Auth (${origin.targetId}): Phiên Zalo chưa đăng nhập hoặc chưa cấu hình SĐT/nhóm.`
        );
        return false;
      }
      let text = "";
      if (task.status === "COMPLETED") {
        text =
          `✅ [HOÀN THÀNH] Task #${shortId}\n\n` +
          `📥 Mục tiêu: ${task.objective}\n\n` +
          `📤 Kết quả bàn giao:\n${cleanResult}`;
      } else if (task.status === "BLOCKED") {
        text =
          `⚠️ [TẠM DỪNG / BLOCKED] Task #${shortId}\n\n` +
          `❓ Lý do: ${cleanResult || "Cần thêm thông tin hoặc gặp lỗi khi xử lý."}`;
      } else if (task.status === "AWAITING_INTERNAL_REVIEW") {
        text =
          `📋 [CHỜ ĐÁNH GIÁ NỘI BỘ] Task #${shortId}\n\n` +
          `📝 Báo cáo: ${cleanResult}`;
      } else {
        text = `ℹ️ [CẬP NHẬT] Task #${shortId}: ${task.title} (Trạng thái: ${task.status})`;
      }

      await sendZaloMessage(text, {
        groupId: origin.targetId,
        phone: origin.targetId,
      });
      console.log(`[inboundResponseRouter] Đã gửi kết quả Zalo Auth thành công tới thread ${origin.targetId}`);
      return true;
    }

    if (origin.channel === "ZALOBOT") {
      if (!isZaloBotConfigured(origin.targetId)) {
        console.warn(
          `[inboundResponseRouter] Không thể gửi kết quả về Zalo Bot (${origin.targetId}): Zalo Bot chưa được cấu hình token hoặc chat ID hợp lệ.`
        );
        return false;
      }
      let text = "";
      if (task.status === "COMPLETED") {
        text =
          `✅ **[HOÀN THÀNH] Task #${shortId}**\n\n` +
          `📥 **Mục tiêu:** ${task.objective}\n\n` +
          `📤 **Kết quả bàn giao:**\n${cleanResult}`;
      } else if (task.status === "BLOCKED") {
        text =
          `⚠️ **[TẠM DỪNG / BLOCKED] Task #${shortId}**\n\n` +
          `❓ **Lý do:** ${cleanResult || "Cần thêm thông tin hoặc gặp lỗi khi xử lý."}`;
      } else if (task.status === "AWAITING_INTERNAL_REVIEW") {
        text =
          `📋 **[CHỜ ĐÁNH GIÁ NỘI BỘ] Task #${shortId}**\n\n` +
          `📝 **Báo cáo:** ${cleanResult}`;
      } else {
        text = `ℹ️ **[CẬP NHẬT] Task #${shortId}**: ${task.title} (Trạng thái: ${task.status})`;
      }

      await sendZaloBotMessage(text, { customChatId: origin.targetId });
      console.log(`[inboundResponseRouter] Đã gửi kết quả Zalo Bot thành công tới chat ${origin.targetId}`);
      return true;
    }
  } catch (err) {
    console.error(
      `[inboundResponseRouter] Lỗi khi gửi kết quả task #${shortId} về ${origin.channel} (${origin.targetId}):`,
      err
    );
  }

  return false;
}
