/**
 * Auth routes — đăng nhập 2 bước (password → optional TOTP), quản lý 2FA.
 * Tất cả routes ở đây KHÔNG qua requireAuth (login phải gọi được khi chưa có token).
 */
import { Router } from "express";
import { db } from "../db/client";
import { env } from "../config/env";
import {
  verifyFounderPassword,
  issueSessionToken,
  issuePending2faToken,
  verifyToken,
} from "../modules/auth/authService";
import {
  generateTotpSecret,
  otpauthToQrDataUrl,
  verifyTotpCode,
} from "../modules/auth/twoFactorService";
import { verifyGoogleIdTokenAndLogin } from "../modules/auth/googleAuthService";
import {
  handleZaloWebhook,
  checkZaloSessionStatus,
  getZaloAuthStatus,
  clearAllZaloSessions,
  type ZaloAuthPayload,
} from "../modules/auth/zaloAuthService";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth";
import { logAudit } from "../modules/audit/auditLogger";

export const authRouter = Router();

function setSessionCookie(res: import("express").Response, token: string) {
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,           // HTTPS-only ở prod; http ok ở local dev
    maxAge: 12 * 60 * 60 * 1000, // 12 giờ (khớp với JWT TTL)
    path: "/",
  });
}

function clearSessionCookie(res: import("express").Response) {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
  });
  res.clearCookie("token");
}

// ---- GET /api/auth/config -----------------------------------------------
// Trả về cấu hình client công khai (vd: Google Client ID)
authRouter.get("/config", (_req, res) => {
  res.json({
    googleClientId: env.googleClientId,
    googleConfigured: Boolean(env.googleClientId),
  });
});

// ---- POST /api/auth/google ----------------------------------------------
// Đăng nhập bằng Google Identity Services (ID Token / Credential)
authRouter.post("/google", async (req, res) => {
  const { idToken, credential } = req.body as {
    idToken?: string;
    credential?: string;
  };
  const tokenToVerify = idToken || credential;

  if (!tokenToVerify) {
    return res.status(400).json({ error: "Thiếu Google ID Token (credential)." });
  }

  try {
    const result = await verifyGoogleIdTokenAndLogin(tokenToVerify);
    setSessionCookie(res, result.token);
    res.json({
      status: "OK",
      token: result.token,
      founder: result.founder,
      totpEnabled: false,
    });
  } catch (err: any) {
    res.status(401).json({ error: err.message || "Xác thực Google thất bại." });
  }
});

// ---- POST /api/zalo/webhook & /api/auth/zalo/webhook ---------------------
// Tiếp nhận Webhook kích hoạt phiên từ Zalo Auth Bridge (zca-js) theo Zalo_guide.md
authRouter.all(["/zalo/webhook", "/webhook"], async (req, res) => {
  if (req.method === "GET") {
    return res.status(200).json({
      service: "AI-OPC Zalo Auth Webhook Handler",
      status: "ready",
      guide: "Zalo_guide.md",
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const payload = req.body as ZaloAuthPayload;
    const result = await handleZaloWebhook(payload);
    if (result.activeSession?.token) {
      setSessionCookie(res, result.activeSession.token);
    }
    return res.status(200).json(result.data);
  } catch (err: any) {
    console.error("[Zalo Webhook Error]:", err);
    return res.status(400).json({
      status: "error",
      message: err.message || "Xử lý webhook Zalo thất bại.",
      receivedAt: new Date().toISOString(),
    });
  }
});

// ---- GET /api/zalo/check-session & /api/auth/zalo/check-session ---------
// Polling kiểm tra phiên từ trang /login
authRouter.get(["/zalo/check-session", "/check-session"], async (req, res) => {
  const sessionId = req.query.sessionId as string | undefined;
  const status = await checkZaloSessionStatus(sessionId);
  if (status.authenticated && status.token) {
    setSessionCookie(res, status.token);
  }
  res.json(status);
});

// ---- POST /api/zalo/manual-login & /api/auth/zalo/manual-login -----------
// Đăng nhập nhanh bằng cách dán payload JSON (hỗ trợ kiểm thử / manual)
authRouter.post(["/zalo/manual-login", "/manual-login"], async (req, res) => {
  try {
    const payload = req.body as ZaloAuthPayload;
    const result = await handleZaloWebhook(payload);
    setSessionCookie(res, result.activeSession.token);
    res.json({
      status: "OK",
      token: result.activeSession.token,
      founder: result.activeSession.founder,
      userId: result.activeSession.userId,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Payload Zalo không hợp lệ." });
  }
});

// ---- GET /api/zalo/status & /api/auth/zalo/status ------------------------
// Lấy thông tin phiên Zalo đã lưu của công ty
authRouter.get(["/zalo/status", "/status"], (_req, res) => {
  res.json(getZaloAuthStatus());
});


// ---- POST /api/auth/login -----------------------------------------------
// Bước 1: kiểm tra email + password.
// - Chưa bật 2FA → trả JWT đầy đủ ngay.
// - Đã bật 2FA → trả pendingToken (5 phút) + status "2FA_REQUIRED".
authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password)
    return res.status(400).json({ error: "Thiếu email hoặc password." });

  const founder = await verifyFounderPassword(email, password);
  if (!founder)
    return res.status(401).json({ error: "Email hoặc mật khẩu không đúng." });

  if (founder.totpEnabled) {
    const pendingToken = issuePending2faToken(founder);
    return res.json({ status: "2FA_REQUIRED", pendingToken });
  }

  const token = issueSessionToken(founder, false);
  setSessionCookie(res, token);
  res.json({ status: "OK", token, totpEnabled: false });
});

// ---- POST /api/auth/verify-2fa -----------------------------------------
// Bước 2 (chỉ khi 2FA bật): đổi pendingToken + mã TOTP → JWT đầy đủ.
authRouter.post("/verify-2fa", async (req, res) => {
  const { pendingToken, code } = req.body as {
    pendingToken?: string;
    code?: string;
  };
  if (!pendingToken || !code)
    return res.status(400).json({ error: "Thiếu pendingToken hoặc code." });

  try {
    const payload = verifyToken(pendingToken);
    if (!payload.pending2fa) throw new Error("not a pending token");

    const founder = await db.founder.findUnique({ where: { id: payload.sub } });
    if (!founder?.totpSecret || !verifyTotpCode(founder.totpSecret, code))
      return res.status(401).json({ error: "Mã 2FA không đúng." });

    const token = issueSessionToken(founder, true);
    setSessionCookie(res, token);
    res.json({ status: "OK", token });
  } catch {
    res
      .status(401)
      .json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn, vui lòng đăng nhập lại." });
  }
});

// ---- POST /api/auth/setup-2fa ------------------------------------------
// Sinh TOTP secret + QR code mới. Chưa bật ngay — cần gọi /enable-2fa để xác nhận.
authRouter.post("/setup-2fa", requireAuth, async (req: AuthedRequest, res) => {
  const founder = await db.founder.findUnique({ where: { id: req.founder!.sub } });
  if (!founder) return res.status(404).json({ error: "Founder không tồn tại." });

  const { secret, otpauth } = generateTotpSecret(founder.email);
  await db.founder.update({
    where: { id: founder.id },
    data: { totpSecret: secret, totpEnabled: false },
  });

  const qrDataUrl = await otpauthToQrDataUrl(otpauth);
  res.json({ secret, otpauth, qrDataUrl });
});

// ---- POST /api/auth/enable-2fa -----------------------------------------
// Xác nhận 1 mã từ Authenticator để chính thức bật totpEnabled = true.
authRouter.post("/enable-2fa", requireAuth, async (req: AuthedRequest, res) => {
  const { code } = req.body as { code?: string };
  const founder = await db.founder.findUnique({ where: { id: req.founder!.sub } });

  if (!founder?.totpSecret)
    return res.status(400).json({ error: "Chưa gọi /setup-2fa để tạo secret." });
  if (!code || !verifyTotpCode(founder.totpSecret, code))
    return res.status(401).json({ error: "Mã 2FA không đúng, thử lại." });

  await db.founder.update({ where: { id: founder.id }, data: { totpEnabled: true } });
  res.json({ status: "OK", totpEnabled: true });
});

// ---- GET /api/auth/me --------------------------------------------------
authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const founder = await db.founder.findUnique({ where: { id: req.founder!.sub } });
  res.json({
    id: req.founder!.sub,
    email: req.founder!.email,
    totpEnabled: founder?.totpEnabled ?? false,
  });
});

// ---- POST /api/auth/logout & /api/zalo/logout ---------------------------
authRouter.all(["/logout", "/zalo/logout"], async (_req, res) => {
  clearSessionCookie(res);
  clearAllZaloSessions();
  await logAudit({
    action: "FOUNDER_LOGOUT",
    resultSummary: "Founder đăng xuất: Đã xóa toàn bộ session JWT, cookie và phiên Zalo.",
  });
  res.json({ status: "OK", message: "Đã xóa toàn bộ session và cookie thành công." });
});
