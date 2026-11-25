/**
 * ZaloAuthService — Xử lý xác thực qua Zalo QR Webhook (zca-js bridge).
 *
 * Tham khảo: Zalo_guide.md
 * - Tiếp nhận payload HTTP POST từ cổng quét mã Zalo Auth Portal.
 * - Lưu context phiên Zalo (uid, imei, cookie, userAgent, secretKey) vào DB / file data/zalo_session.json.
 * - Cấp quyền Founder Session Token và tự động kích hoạt phiên đăng nhập.
 */

import fs from "fs";
import path from "path";
import { db } from "../../db/client";
import { issueSessionToken } from "./authService";
import { logAudit } from "../audit/auditLogger";

export interface ZaloContext {
  uid: string;
  imei: string;
  cookie: Array<{ key: string; value: string; domain?: string; path?: string }> | string;
  userAgent: string;
  secretKey?: string | null;
  sessionKey?: string | null;
}

export interface ZaloAuthPayload {
  event: string;
  timestamp?: string;
  userId: string;
  context: ZaloContext;
  customParams?: Record<string, any>;
}

export interface ActiveZaloSession {
  sessionId?: string;
  userId: string;
  token: string;
  founder: {
    id: string;
    email: string;
  };
  context: ZaloContext;
  receivedAt: string;
}

// Lưu session gần nhất trong RAM
let latestPendingSession: ActiveZaloSession | null = null;
const sessionMap = new Map<string, ActiveZaloSession>();

import { resolveDataDir } from "../../config/env";

// Đường dẫn lưu file session bền vững
export function getSessionFilePath(): string {
  return path.join(resolveDataDir(), "zalo_session.json");
}

/**
 * Đọc phiên Zalo đã lưu từ đĩa
 */
export function getSavedZaloSession(): ZaloContext | null {
  try {
    const sessionFile = getSessionFilePath();
    if (fs.existsSync(sessionFile)) {
      const raw = fs.readFileSync(sessionFile, "utf-8");
      const parsed = JSON.parse(raw);
      return parsed.context || null;
    }
  } catch (err) {
    console.warn("[ZaloAuth] Không thể đọc file session:", err);
  }
  return null;
}

/**
 * Đọc đầy đủ thông tin phiên Zalo từ đĩa (userId, context, savedAt)
 */
export function getSavedZaloFullSession(): { userId: string; context: ZaloContext; savedAt: string } | null {
  try {
    const sessionFile = getSessionFilePath();
    if (fs.existsSync(sessionFile)) {
      const raw = fs.readFileSync(sessionFile, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn("[ZaloAuth] Không thể đọc file session:", err);
  }
  return null;
}

/**
 * Lưu phiên Zalo xuống đĩa để các AI Agent tái sử dụng
 */
function persistZaloSession(data: { userId: string; context: ZaloContext; savedAt: string }) {
  try {
    const sessionFile = getSessionFilePath();
    const dir = path.dirname(sessionFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[ZaloAuth] Lỗi lưu session xuống đĩa:", err);
  }
}

/**
 * Xóa sạch toàn bộ phiên Zalo trong RAM và trên đĩa khi Founder đăng xuất
 */
export function clearAllZaloSessions() {
  latestPendingSession = null;
  sessionMap.clear();
  try {
    const sessionFile = getSessionFilePath();
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
      console.log("[ZaloAuth] Đã xóa toàn bộ file zalo_session.json trên đĩa.");
    }
  } catch (err) {
    console.warn("[ZaloAuth] Lỗi khi xóa file session trên đĩa:", err);
  }
}

/**
 * Xử lý webhook từ Zalo Auth Bridge
 */
export async function handleZaloWebhook(payload: ZaloAuthPayload) {
  if (payload.event !== "ZALO_AUTH_SUCCESS" || !payload.userId || !payload.context) {
    throw new Error("Payload không hợp lệ: Thiếu event ZALO_AUTH_SUCCESS, userId hoặc context.");
  }

  const { userId, context, customParams } = payload;
  const sessionId = customParams?.sessionId || customParams?.systemId;

  // 1. Tìm hoặc gán với tài khoản Founder chính
  let founder = await db.founder.findFirst();

  if (!founder) {
    const founderId = "founder_1";
    founder = await db.founder.create({
      data: {
        id: founderId,
        email: `founder_zalo_${userId.slice(-6)}@company.internal`,
        passwordHash: "",
        totpEnabled: false,
      },
    });

    await logAudit({
      action: "FOUNDER_CREATED_VIA_ZALO",
      resultSummary: `Tự động tạo Founder từ Zalo Auth: UID ${userId}`,
    });
  }

  // 2. Cấp JWT Session Token cho Founder
  const token = issueSessionToken(founder, false);

  const activeSession: ActiveZaloSession = {
    sessionId: typeof sessionId === "string" ? sessionId : undefined,
    userId,
    token,
    founder: {
      id: founder.id,
      email: founder.email,
    },
    context,
    receivedAt: new Date().toISOString(),
  };

  // 3. Cập nhật cache phiên
  latestPendingSession = activeSession;
  if (activeSession.sessionId) {
    sessionMap.set(activeSession.sessionId, activeSession);
  }
  sessionMap.set(userId, activeSession);

  // 4. Lưu phiên bền vững vào file để AI Agent tái sử dụng
  persistZaloSession({
    userId,
    context,
    savedAt: activeSession.receivedAt,
  });

  // 5. Ghi Audit Log
  await logAudit({
    action: "FOUNDER_LOGIN_ZALO",
    resultSummary: `Founder đăng nhập thành công qua Zalo Auth Webhook: UID ${userId} (IMEI: ${context.imei ? context.imei.slice(0, 12) + "..." : "N/A"})`,
  });

  return {
    status: 200,
    data: {
      status: "ok",
      message: "Nhận phiên Zalo Auth thành công từ Webhook Bridge!",
      receivedAt: activeSession.receivedAt,
    },
    activeSession,
  };
}

/**
 * Kiểm tra trạng thái phiên Zalo đang đợi từ frontend
 */
export async function checkZaloSessionStatus(sessionId?: string): Promise<{
  authenticated: boolean;
  token?: string;
  founder?: { id: string; email: string };
  userId?: string;
  receivedAt?: string;
}> {
  // 1. Nếu có sessionId cụ thể trong RAM
  if (sessionId && sessionMap.has(sessionId)) {
    const s = sessionMap.get(sessionId)!;
    return {
      authenticated: true,
      token: s.token,
      founder: s.founder,
      userId: s.userId,
      receivedAt: s.receivedAt,
    };
  }

  // 2. Kiểm tra latest session trong RAM (trong vòng 15 phút trở lại)
  if (latestPendingSession) {
    const ageMs = Date.now() - new Date(latestPendingSession.receivedAt).getTime();
    if (ageMs < 15 * 60 * 1000) {
      return {
        authenticated: true,
        token: latestPendingSession.token,
        founder: latestPendingSession.founder,
        userId: latestPendingSession.userId,
        receivedAt: latestPendingSession.receivedAt,
      };
    }
  }

  // 3. Fallback: Khôi phục phiên từ file disk (zalo_session.json) nếu được lưu trong vòng 30 phút
  const saved = getSavedZaloFullSession();
  if (saved && saved.savedAt && saved.userId) {
    const ageMs = Date.now() - new Date(saved.savedAt).getTime();
    if (ageMs < 30 * 60 * 1000) {
      try {
        let founder = await db.founder.findFirst();
        if (!founder) {
          founder = await db.founder.create({
            data: {
              id: "founder_1",
              email: `founder_zalo_${saved.userId.slice(-6)}@company.internal`,
              passwordHash: "",
              totpEnabled: false,
            },
          });
        }
        const token = issueSessionToken(founder, false);
        latestPendingSession = {
          userId: saved.userId,
          token,
          founder: { id: founder.id, email: founder.email },
          context: saved.context,
          receivedAt: saved.savedAt,
        };
        sessionMap.set(saved.userId, latestPendingSession);
        return {
          authenticated: true,
          token,
          founder: { id: founder.id, email: founder.email },
          userId: saved.userId,
          receivedAt: saved.savedAt,
        };
      } catch (err) {
        console.warn("[ZaloAuth] Lỗi khôi phục session từ DB:", err);
      }
    }
  }

  return { authenticated: false };
}

/**
 * Kiểm tra xem công ty đã có phiên Zalo nào được kết nối trước đó hay chưa
 */
export function getZaloAuthStatus() {
  const saved = getSavedZaloSession();
  return {
    connected: Boolean(saved),
    uid: saved?.uid || null,
    imei: saved?.imei ? `${saved.imei.slice(0, 16)}...` : null,
    lastReceived: latestPendingSession?.receivedAt || null,
  };
}
