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

export interface ZaloSendRecipient {
  phone?: string | null;
  groupId?: string | null;
}

export interface ZaloUserIdentity {
  uid: string;
  phone?: string;
  displayName?: string;
  avatar?: string;
}

// Bộ nhớ đệm 2 chiều SĐT <-> UID
const phoneToIdentityCache = new Map<string, ZaloUserIdentity>();
const uidToIdentityCache = new Map<string, ZaloUserIdentity>();

/**
 * Xóa sạch toàn bộ instance API Zalo và bộ nhớ đệm danh tính trong RAM
 */
export function clearZaloApiCache(): void {
  cachedZaloApi = null;
  lastSessionUid = null;
  phoneToIdentityCache.clear();
  uidToIdentityCache.clear();
}

/**
 * Chuẩn hóa các biến thể của số điện thoại Việt Nam (090... <-> 8490...)
 */
export function normalizePhoneNumber(phone: string): string[] {
  const cleaned = phone.replace(/[^0-9]/g, "");
  if (!cleaned) return [];
  const variants = new Set<string>();
  variants.add(cleaned);
  if (cleaned.startsWith("0")) {
    variants.add("84" + cleaned.slice(1));
  } else if (cleaned.startsWith("84")) {
    variants.add("0" + cleaned.slice(2));
  }
  return Array.from(variants);
}

/**
 * Tra cứu và phân giải Số điện thoại thành Zalo UID và lưu vào Cache
 */
export async function resolvePhoneToZaloUid(
  phone: string,
  apiInstance?: any
): Promise<ZaloUserIdentity | null> {
  const trimmed = phone?.trim();
  if (!trimmed) return null;

  // Kiểm tra cache trước
  const variants = normalizePhoneNumber(trimmed);
  for (const v of variants) {
    const hit = phoneToIdentityCache.get(v);
    if (hit) return hit;
  }

  const session = getSavedZaloSession();
  if (!session) return null;

  try {
    const api = apiInstance || (await getAuthenticatedZaloApi(session));
    if (typeof api.findUser !== "function") return null;

    let found: any = null;
    for (const v of variants) {
      try {
        found = await withTimeout(api.findUser(v), 5000, `Tra cứu SĐT Zalo ${v}`);
        if (found && (found.uid || found.userId)) break;
      } catch (findErr) {
        // thử định dạng tiếp theo
      }
    }

    if (found && (found.uid || found.userId)) {
      const uid = String(found.uid || found.userId);
      const identity: ZaloUserIdentity = {
        uid,
        phone: trimmed,
        displayName: found.display_name || found.zalo_name || "",
        avatar: found.avatar || "",
      };

      // Ghi nhận vào cache tất cả các biến thể
      variants.forEach((v) => phoneToIdentityCache.set(v, identity));
      phoneToIdentityCache.set(trimmed, identity);
      uidToIdentityCache.set(uid, identity);

      console.log(
        `[ZaloAuth] ✅ Đã phân giải SĐT ${trimmed} -> UID: ${uid} (Tên: ${identity.displayName || "Zalo User"})`
      );
      return identity;
    }
  } catch (err: any) {
    console.warn(`[ZaloAuth] Không thể phân giải SĐT ${trimmed} qua findUser:`, err.message || err);
  }

  return null;
}

/**
 * Lấy danh tính đã biết qua UID
 */
export function getKnownIdentityByUid(uid: string): ZaloUserIdentity | undefined {
  return uidToIdentityCache.get(String(uid));
}

/**
 * Phân giải toàn bộ danh sách SĐT & Nhóm Zalo hợp lệ từ .env và Notification Preferences
 */
export async function resolveAllConfiguredZaloIdentities(apiInstance?: any): Promise<{
  allowedUids: Set<string>;
  allowedGroupIds: Set<string>;
}> {
  const allowedUids = new Set<string>();
  const allowedGroupIds = new Set<string>();

  // 1. Static Admin IDs & Group IDs from .env
  env.zaloAdminIds.forEach((id) => allowedUids.add(id));
  if (env.zaloNotifyGroupId) allowedGroupIds.add(env.zaloNotifyGroupId.trim());

  const session = getSavedZaloSession();
  if (session?.uid) allowedUids.add(session.uid);

  // 2. Dynamic Preferences
  const phonesToResolve = new Set<string>();
  if (env.zaloNotifyPhone) phonesToResolve.add(env.zaloNotifyPhone.trim());

  try {
    const { getNotificationPreferences } = await import("./notifier");
    const prefs = getNotificationPreferences();
    if (prefs.customZaloPhone) phonesToResolve.add(prefs.customZaloPhone.trim());
    if (prefs.customZaloGroupId) allowedGroupIds.add(prefs.customZaloGroupId.trim());
    if (prefs.customZaloRecipients && Array.isArray(prefs.customZaloRecipients)) {
      prefs.customZaloRecipients.forEach((r) => {
        if (r.phone && r.phone.trim()) phonesToResolve.add(r.phone.trim());
        if (r.groupId && r.groupId.trim()) allowedGroupIds.add(r.groupId.trim());
      });
    }
  } catch (e) {
    // ignore
  }

  // 3. Phân giải tất cả các số điện thoại thành UIDs
  const resolvePromises = Array.from(phonesToResolve).map(async (phone) => {
    const identity = await resolvePhoneToZaloUid(phone, apiInstance);
    if (identity) {
      allowedUids.add(identity.uid);
    }
  });

  await Promise.allSettled(resolvePromises);

  return { allowedUids, allowedGroupIds };
}

/**
 * Kiểm tra xem kênh Zalo đã sẵn sàng gửi tin nhắn hay chưa:
 * 1. Phải có phiên Zalo Auth hợp lệ được lưu trong hệ thống (từ đăng nhập Zalo).
 * 2. Có ít nhất 1 đích nhận (Số điện thoại hoặc Nhóm Zalo).
 */
export function isZaloConfigured(
  customPhone?: string | null,
  customGroupId?: string | null,
  customRecipients?: ZaloSendRecipient[] | null
): boolean {
  const session = getSavedZaloSession();
  if (!session) return false;

  if (customRecipients && customRecipients.length > 0) {
    const hasAny = customRecipients.some(
      (r) => (r.phone && r.phone.trim()) || (r.groupId && r.groupId.trim())
    );
    if (hasAny) return true;
  }

  const phone = (customPhone || env.zaloNotifyPhone)?.trim();
  const group = (customGroupId || env.zaloNotifyGroupId)?.trim();

  return Boolean(phone || group);
}

/**
 * Trả về trạng thái chi tiết của kênh Zalo
 */
export function getZaloChannelStatus(
  customPhone?: string | null,
  customGroupId?: string | null,
  customRecipients?: ZaloSendRecipient[] | null
) {
  const session = getSavedZaloSession();
  const defaultPhone = env.zaloNotifyPhone || "";
  const defaultGroupId = env.zaloNotifyGroupId || "";
  const activePhone = customPhone || defaultPhone;
  const activeGroupId = customGroupId || defaultGroupId;

  let recipientCount = 0;
  if (customRecipients && customRecipients.length > 0) {
    recipientCount = customRecipients.filter(
      (r) => (r.phone && r.phone.trim()) || (r.groupId && r.groupId.trim())
    ).length;
  }
  if (recipientCount === 0 && (activePhone || activeGroupId)) {
    recipientCount = 1;
  }

  return {
    sessionConnected: Boolean(session),
    uid: session?.uid || null,
    configured: isZaloConfigured(customPhone, customGroupId, customRecipients),
    defaultPhone,
    defaultGroupId,
    recipientCount,
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
export async function getAuthenticatedZaloApi(session: ZaloContext) {
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

async function sendSingleZaloTarget(
  api: any,
  session: ZaloContext,
  text: string,
  target: { phone?: string; groupId?: string }
): Promise<{ threadId: string; targetType: string }> {
  const targetGroupId = target.groupId?.trim();
  const targetPhone = target.phone?.trim();

  let threadId = targetGroupId || targetPhone!;
  let targetType = targetGroupId ? "Nhóm Zalo" : "SĐT Cá nhân";

  // Nếu gửi tới số điện thoại, phân giải SĐT -> UID qua resolvePhoneToZaloUid
  if (!targetGroupId && targetPhone) {
    const identity = await resolvePhoneToZaloUid(targetPhone, api);
    if (identity && identity.uid) {
      threadId = identity.uid;
      targetType = `SĐT (${targetPhone}${identity.displayName ? ` - ${identity.displayName}` : ""})`;
    }
  }

  if (typeof api.sendMessage === "function") {
    await withTimeout(api.sendMessage({ msg: text }, threadId), 10000, "Gửi tin nhắn Zalo");
  } else {
    throw new Error("Phiên Zalo không hỗ trợ phương thức sendMessage.");
  }

  return { threadId, targetType };
}

/**
 * Gửi tin nhắn thông báo qua Zalo bằng phiên Zalo Auth (hỗ trợ nhiều người nhận / nhóm)
 */
export async function sendZaloMessage(
  text: string,
  options?: {
    phone?: string | null;
    groupId?: string | null;
    recipients?: ZaloSendRecipient[] | null;
  }
): Promise<{ success: boolean; threadId: string; note?: string }> {
  const session = getSavedZaloSession();
  if (!session) {
    throw new Error("Chưa có phiên Zalo Auth. Vui lòng vào trang Đăng nhập và chọn 'Đăng nhập qua Zalo' trước.");
  }

  // Thu thập danh sách các targets nhận tin
  const targets: Array<{ phone?: string; groupId?: string }> = [];
  const seenTargets = new Set<string>();

  if (options?.recipients && options.recipients.length > 0) {
    for (const r of options.recipients) {
      const p = r.phone?.trim();
      const g = r.groupId?.trim();
      if (p && !seenTargets.has(`phone:${p}`)) {
        seenTargets.add(`phone:${p}`);
        targets.push({ phone: p });
      }
      if (g && !seenTargets.has(`group:${g}`)) {
        seenTargets.add(`group:${g}`);
        targets.push({ groupId: g });
      }
    }
  }

  if (targets.length === 0) {
    const targetGroupId = (options?.groupId || env.zaloNotifyGroupId)?.trim();
    const targetPhone = (options?.phone || env.zaloNotifyPhone)?.trim();
    if (targetPhone && !seenTargets.has(`phone:${targetPhone}`)) {
      seenTargets.add(`phone:${targetPhone}`);
      targets.push({ phone: targetPhone });
    }
    if (targetGroupId && !seenTargets.has(`group:${targetGroupId}`)) {
      seenTargets.add(`group:${targetGroupId}`);
      targets.push({ groupId: targetGroupId });
    }
  }

  if (targets.length === 0) {
    throw new Error("Chưa cấu hình Số điện thoại hoặc ID Nhóm Zalo nhận tin.");
  }

  const api = await getAuthenticatedZaloApi(session);

  // Gửi song song tới tất cả đích (Promise.allSettled)
  const results = await Promise.allSettled(
    targets.map((t) => sendSingleZaloTarget(api, session, text, t))
  );

  const successful: string[] = [];
  const errors: string[] = [];

  results.forEach((r, idx) => {
    const t = targets[idx];
    const label = t.groupId ? `Nhóm ${t.groupId}` : `SĐT ${t.phone}`;
    if (r.status === "fulfilled") {
      successful.push(`${label} (${r.value.threadId})`);
    } else {
      errors.push(`${label}: ${r.reason?.message || String(r.reason)}`);
    }
  });

  if (successful.length === 0) {
    console.error("[ZaloNotifier] Lỗi gửi tin nhắn qua Zalo tới tất cả đích:", errors);
    throw new Error(`Gửi tin nhắn Zalo thất bại tới tất cả đích:\n${errors.join("\n")}`);
  }

  await logAudit({
    action: "ZALO_MESSAGE_SENT",
    resultSummary: `Gửi thông báo Zalo thành công tới ${successful.length}/${targets.length} đích: ${successful.join(", ")} (Người gửi: UID ${session.uid})`,
  });

  return {
    success: true,
    threadId: successful.join(", "),
    note: `Đã gửi tới ${successful.length} đích Zalo (${successful.join(", ")})` + (errors.length > 0 ? ` [Lỗi ${errors.length} đích: ${errors.join("; ")}]` : ""),
  };
}
