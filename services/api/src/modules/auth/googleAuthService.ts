/**
 * GoogleAuthService — Xác thực ID Token từ Google Identity Services (GIS).
 *
 * Luồng hoạt động:
 *   1. Frontend nhận `credential` (ID Token JWT do Google ký) từ GIS button hoặc One Tap.
 *   2. Gửi ID Token lên API `POST /api/auth/google`.
 *   3. Backend dùng `OAuth2Client` của `google-auth-library` để verify chữ ký số của Google
 *      và kiểm tra audience khớp với GOOGLE_CLIENT_ID.
 *   4. Lấy thông tin user (sub, email, name, picture).
 *   5. Tìm Founder trong DB theo email:
 *      - Nếu đã có -> đăng nhập và cấp session token.
 *      - Nếu chưa có -> tự động khởi tạo Founder mới.
 */
import { OAuth2Client } from "google-auth-library";
import { db } from "../../db/client";
import { env } from "../../config/env";
import { issueSessionToken } from "./authService";
import { logAudit } from "../audit/auditLogger";

let cachedOAuthClient: OAuth2Client | null = null;

function getOAuthClient(): OAuth2Client {
  if (!cachedOAuthClient) {
    cachedOAuthClient = new OAuth2Client(env.googleClientId || undefined);
  }
  return cachedOAuthClient;
}

export interface GoogleAuthResult {
  token: string;
  founder: {
    id: string;
    email: string;
    name?: string;
    picture?: string;
  };
}

export async function verifyGoogleIdTokenAndLogin(idToken: string): Promise<GoogleAuthResult> {
  if (!idToken || typeof idToken !== "string") {
    throw new Error("Thiếu Google ID Token hợp lệ.");
  }

  const client = getOAuthClient();
  const audience = env.googleClientId ? env.googleClientId : undefined;

  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken,
      audience,
    });
  } catch (err) {
    throw new Error(`Xác thực Google ID Token thất bại: ${err instanceof Error ? err.message : String(err)}`);
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error("Google ID Token không chứa thông tin email hợp lệ.");
  }

  const email = payload.email.toLowerCase();
  const name = payload.name || payload.email.split("@")[0];
  const picture = payload.picture;
  const googleSub = payload.sub;

  // 1. Tìm Founder theo email trong DB
  let founder = await db.founder.findUnique({ where: { email } });

  // 2. Nếu chưa có, tự động tạo Founder mới
  if (!founder) {
    const founderId = `founder_${googleSub.slice(-8)}`;
    founder = await db.founder.create({
      data: {
        id: founderId,
        email,
        passwordHash: "", // Đăng nhập qua Google OAuth
        totpEnabled: false,
      },
    });

    await logAudit({
      action: "FOUNDER_CREATED_VIA_GOOGLE",
      resultSummary: `Tự động tạo Founder từ Google Account: ${email} (${name})`,
    });
  }

  // 3. Cấp session JWT
  const token = issueSessionToken(founder, false);

  await logAudit({
    action: "FOUNDER_LOGIN_GOOGLE",
    resultSummary: `Founder đăng nhập thành công qua Google: ${email}`,
  });

  return {
    token,
    founder: {
      id: founder.id,
      email: founder.email,
      name,
      picture,
    },
  };
}
