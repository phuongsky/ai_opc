/**
 * Two-Factor Authentication Service — TOTP via otplib + QR code via qrcode.
 * Tương thích Google Authenticator, Authy, và mọi TOTP app chuẩn RFC 6238.
 */
import { authenticator } from "otplib";
import QRCode from "qrcode";

const ISSUER = "AI-OPC Company OS";

// ---- Secret generation -------------------------------------------------

export function generateTotpSecret(founderEmail: string): {
  secret: string;
  otpauth: string;
} {
  const secret = authenticator.generateSecret(); // 20-byte base32 secret
  const otpauth = authenticator.keyuri(founderEmail, ISSUER, secret);
  return { secret, otpauth };
}

// ---- QR Code -----------------------------------------------------------

/** Trả về Data URL (base64 PNG) để nhúng thẳng vào <img src="..."> */
export async function otpauthToQrDataUrl(otpauth: string): Promise<string> {
  return QRCode.toDataURL(otpauth);
}

// ---- Verification ------------------------------------------------------

/**
 * Xác minh mã 6 số từ Authenticator app.
 * otplib mặc định cho phép lệch ±1 bước thời gian (30 giây) để bù trừ
 * đồng hồ lệch giữa server và thiết bị.
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}
