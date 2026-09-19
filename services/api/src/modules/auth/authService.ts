/**
 * Auth Service — bcrypt password hashing + JWT issue/verify.
 * Hệ thống có đúng 1 người dùng (Founder). JWT có 2 loại:
 *   - Session token (12h): dùng cho mọi API call sau khi đăng nhập xong.
 *   - Pending-2FA token (5 phút): chỉ dùng để xác nhận bước 2 (/verify-2fa),
 *     bị reject bởi requireAuth middleware cho mọi route nghiệp vụ khác.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../../db/client";
import { env } from "../../config/env";

const BCRYPT_ROUNDS = 12;
const SESSION_TTL = "12h";
const PENDING_2FA_TTL = "5m";

export interface JwtPayload {
  sub: string;       // founder id
  email: string;
  pending2fa?: true; // chỉ có trên pending token — bị block ở requireAuth
}

// ---- Password ----------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Tìm Founder theo email và kiểm tra password.
 * Trả về Founder object nếu đúng, null nếu sai email hoặc sai mật khẩu.
 */
export async function verifyFounderPassword(email: string, plain: string) {
  const founder = await db.founder.findUnique({ where: { email } });
  if (!founder) return null;
  const ok = await bcrypt.compare(plain, founder.passwordHash);
  return ok ? founder : null;
}

// ---- JWT ---------------------------------------------------------------

export function issueSessionToken(
  founder: { id: string; email: string },
  totpVerified: boolean
): string {
  const payload: JwtPayload = { sub: founder.id, email: founder.email };
  // totpVerified chỉ dùng để phân biệt log/audit — không encode vào token
  // để đơn giản; kiểm tra 2FA xảy ra ở middleware requireTotpForHighRisk.
  void totpVerified;
  return jwt.sign(payload, env.jwtSecret, { expiresIn: SESSION_TTL });
}

export function issuePending2faToken(founder: { id: string; email: string }): string {
  const payload: JwtPayload = { sub: founder.id, email: founder.email, pending2fa: true };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: PENDING_2FA_TTL });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}
