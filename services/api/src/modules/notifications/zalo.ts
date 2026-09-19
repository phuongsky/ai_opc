/**
 * Zalo Notification Sender — Sử dụng phiên Zalo Auth đã lưu để gửi thông báo.
 *
 * Tham khảo: Zalo_guide.md (Mục 3: Ứng dụng đích sử dụng phiên này như thế nào sau đó)
 * - Khôi phục phiên làm việc từ context đã lưu (cookie, imei, userAgent)
 * - Gửi tin nhắn tự động đến SĐT cá nhân hoặc Nhóm Zalo
 */

import { Zalo } from "zca-js";
import { env } from "../../config/env";
import { getSavedZaloSession, type ZaloContext } from "../auth/zaloAuthService";
import { logAudit } from "../audit/auditLogger";

let cachedZaloApi: any = null;
let lastSessionUid: string | null = null;

/**
 * Kiểm tra xem kênh Zalo đã sẵn sàng gửi tin nhắn hay chưa:
 * 1. Phải có phiên Zalo Auth hợp lệ được lưu trong hệ thống (từ đăng nhập Zalo).
 * 2. Có ít nhất 1 đích nhận (Số điện thoại hoặc Nhóm Zalo).
 */
export function isZaloConfigured(customPhone?: string | null, customGroupId?: string | null): boolean {
  const session = getSavedZaloSession();
  if (!session) return false;

  const phone = (customPhone || env.zaloNotifyPhone)?.trim();
  const group = (customGroupId || env.zaloNotifyGroupId)?.trim();

  return Boolean(phone || group);
}

/**
 * Trả về trạng thái chi tiết của kênh Zalo
 */
export function getZaloChannelStatus(customPhone?: string | null, customGroupId?: string | null) {
  const session = getSavedZaloSession();
  const defaultPhone = env.zaloNotifyPhone || "";
  const defaultGroupId = env.zaloNotifyGroupId || "";
  const activePhone = customPhone || defaultPhone;
  const activeGroupId = customGroupId || defaultGroupId;

  return {
    sessionConnected: Boolean(session),
    uid: session?.uid || null,
    configured: Boolean(session && (activePhone || activeGroupId)),
    defaultPhone,
    defaultGroupId,
  };
}

/**
 * Tiện ích bọc Promise với timeout tối đa (mặc định 10s)
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs = 10000, label = "Thao tác"): Promise<T> {
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

/**
 * Khởi tạo hoặc tái sử dụng instance API Zalo từ phiên đã lưu
 */
async function getAuthenticatedZaloApi(session: ZaloContext) {
  if (cachedZaloApi && lastSessionUid === session.uid) {
    return cachedZaloApi;
  }

  const zalo = new Zalo({
    selfListen: false,
    checkUpdate: false,
  });

  let parsedCookie = typeof session.cookie === "string" ? JSON.parse(session.cookie) : session.cookie;
  if (parsedCookie && parsedCookie.cookies && Array.isArray(parsedCookie.cookies)) {
    parsedCookie = parsedCookie.cookies;
  }

  try {
    const api = await withTimeout(
      zalo.login({
        cookie: parsedCookie,
        imei: session.imei,
        userAgent: session.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
      }),
      8000,
      "Đăng nhập Zalo Auth"
    );

    cachedZaloApi = api;
    lastSessionUid = session.uid;
    return api;
  } catch (loginErr) {
    cachedZaloApi = null;
    lastSessionUid = null;
    throw loginErr;
  }
}

/**
 * Gửi tin nhắn thông báo qua Zalo bằng phiên Zalo Auth
 */
export async function sendZaloMessage(
  text: string,
  options?: { phone?: string | null; groupId?: string | null }
): Promise<{ success: boolean; threadId: string; note?: string }> {
  const session = getSavedZaloSession();
  if (!session) {
    throw new Error("Chưa có phiên Zalo Auth. Vui lòng vào trang Đăng nhập và chọn 'Đăng nhập qua Zalo' trước.");
  }

  const targetGroupId = (options?.groupId || env.zaloNotifyGroupId)?.trim();
  const targetPhone = (options?.phone || env.zaloNotifyPhone)?.trim();

  if (!targetGroupId && !targetPhone) {
    throw new Error("Chưa cấu hình Số điện thoại hoặc ID Nhóm Zalo nhận tin.");
  }

  let threadId = targetGroupId || targetPhone!;
  let targetType = targetGroupId ? "Nhóm Zalo" : "SĐT Cá nhân";

  try {
    const api = await getAuthenticatedZaloApi(session);

    // Nếu gửi tới số điện thoại và có hàm tìm kiếm user
    if (!targetGroupId && targetPhone && typeof api.findUser === "function") {
      try {
        const found: any = await withTimeout(api.findUser(targetPhone), 5000, "Tìm người dùng qua SĐT Zalo");
        if (found?.uid || found?.userId) {
          threadId = found.uid || found.userId;
        }
      } catch (findErr) {
        // Fallback dùng trực tiếp số điện thoại / ID
        console.warn(`[ZaloNotifier] Không thể resolve SĐT ${targetPhone} qua findUser, dùng trực tiếp threadId:`, findErr);
      }
    }

    // Gửi tin nhắn qua zca-js với timeout 10s
    if (typeof api.sendMessage === "function") {
      await withTimeout(api.sendMessage({ msg: text }, threadId), 10000, "Gửi tin nhắn Zalo");
    } else {
      throw new Error("Phiên Zalo không hỗ trợ phương thức sendMessage.");
    }

    await logAudit({
      action: "ZALO_MESSAGE_SENT",
      resultSummary: `Gửi thông báo Zalo thành công tới ${targetType}: ${threadId} (Người gửi: UID ${session.uid})`,
    });

    return {
      success: true,
      threadId,
      note: `Đã gửi tới ${targetType} (${threadId})`,
    };
  } catch (err: any) {
    // Nếu là phiên test mẫu hoặc lỗi kết nối, log chi tiết và rethrow
    console.error("[ZaloNotifier] Lỗi gửi tin nhắn qua Zalo:", err);
    throw new Error(`Gửi tin nhắn qua Zalo thất bại (${targetType}: ${threadId}): ${err.message || String(err)}`);
  }
}
