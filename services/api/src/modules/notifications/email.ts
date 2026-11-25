/**
 * Client gửi email qua SMTP dùng `nodemailer`.
 *
 * Setup nhanh với Gmail: bật "App Password" (myaccount.google.com/apppasswords),
 * dùng SMTP_HOST=smtp.gmail.com, SMTP_PORT=465 hoặc 587, SMTP_USER=<gmail>, SMTP_PASS=<app password>.
 * Hoặc dùng bất kỳ SMTP nào khác (SendGrid SMTP relay, Mailgun, Postmark...).
 *
 * Hệ thống hỗ trợ cấu hình động qua Cài đặt (NotificationPreferences),
 * tự động ghi đè và fallback về .env nếu để trống.
 */
import nodemailer from "nodemailer";
import { env } from "../../config/env";

export interface EmailConfigOptions {
  customEmailRecipient?: string | null;
  customSmtpHost?: string | null;
  customSmtpPort?: number | string | null;
  customSmtpUser?: string | null;
  customSmtpPass?: string | null;
  customSmtpFrom?: string | null;
}

export function resolveSmtpConfig(options?: string | null | EmailConfigOptions): {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  recipient: string;
} {
  const opt: EmailConfigOptions =
    typeof options === "string"
      ? { customEmailRecipient: options }
      : (options || {});

  const host = opt.customSmtpHost?.trim() || env.smtpHost || "";
  const rawPort =
    opt.customSmtpPort !== undefined &&
    opt.customSmtpPort !== null &&
    String(opt.customSmtpPort).trim() !== ""
      ? Number(opt.customSmtpPort)
      : env.smtpPort || 587;
  const port = isNaN(rawPort) ? 587 : rawPort;
  const user = opt.customSmtpUser?.trim() || env.smtpUser || "";
  const pass = opt.customSmtpPass?.trim() || env.smtpPass || "";
  const from = opt.customSmtpFrom?.trim() || env.smtpFrom || user;
  const recipient = opt.customEmailRecipient?.trim() || env.founderNotifyEmail || "";

  return { host, port, user, pass, from, recipient };
}

export function isEmailConfigured(options?: string | null | EmailConfigOptions): boolean {
  const config = resolveSmtpConfig(options);
  return Boolean(config.host && config.user && config.pass && config.recipient);
}

export async function sendEmail(
  subject: string,
  text: string,
  options?: string | null | EmailConfigOptions
): Promise<void> {
  const { host, port, user, pass, from, recipient } = resolveSmtpConfig(options);

  if (!host || !user || !pass || !recipient) {
    throw new Error(
      "Chưa cấu hình đầy đủ SMTP_HOST, SMTP_USER, SMTP_PASS và FOUNDER_NOTIFY_EMAIL (trong Cài đặt hoặc file .env)"
    );
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });

  await transporter.sendMail({
    from: from || user,
    to: recipient,
    subject,
    text,
  });
}
