/**
 * Client gửi email qua SMTP dùng `nodemailer`.
 *
 * Setup nhanh với Gmail: bật "App Password" (myaccount.google.com/apppasswords),
 * dùng SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=<gmail>, SMTP_PASS=<app password>.
 * Hoặc dùng bất kỳ SMTP nào khác (SendGrid SMTP relay, Mailgun, Postmark...).
 */
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env";

export function isEmailConfigured(): boolean {
  return Boolean(env.smtpHost && env.smtpUser && env.smtpPass && env.founderNotifyEmail);
}

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }
  return cachedTransporter;
}

export async function sendEmail(subject: string, text: string, customRecipient?: string | null): Promise<void> {
  const recipient = customRecipient || env.founderNotifyEmail;
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass || !recipient) {
    throw new Error("Chưa cấu hình SMTP_HOST/SMTP_USER/SMTP_PASS/FOUNDER_NOTIFY_EMAIL trong .env");
  }

  await getTransporter().sendMail({
    from: env.smtpFrom || env.smtpUser,
    to: recipient,
    subject,
    text,
  });
}
