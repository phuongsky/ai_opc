"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldOff, QrCode, CheckCircle2, AlertCircle } from "lucide-react";
import { fetchMe, setup2fa, enable2fa, logout } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function SecurityPage() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"idle" | "qr" | "done">("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    fetchMe()
      .then((me) => { setTotpEnabled(me.totpEnabled); setEmail(me.email); })
      .catch(() => router.push("/login"));
  }, [router]);

  async function handleSetup() {
    setError("");
    setLoading(true);
    try {
      const res = await setup2fa();
      setQrDataUrl(res.qrDataUrl);
      setSecret(res.secret);
      setStep("qr");
    } catch (err) {
      setError(err instanceof Error ? err.message : (locale === "vi" ? "Không thể tạo QR code" : "Could not generate QR code"));
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await enable2fa(code);
      setTotpEnabled(true);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : (locale === "vi" ? "Mã không đúng" : "Invalid code"));
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await logout();
    window.location.href = "/login";
  }

  if (totpEnabled === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas px-4 py-12">
      <div className="mx-auto max-w-lg space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{t.security.title}</h1>
            <p className="mt-0.5 text-sm text-zinc-500">{email}</p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <button
              onClick={() => router.push("/")}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 cursor-pointer"
            >
              {t.nav.backToDashboard}
            </button>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 cursor-pointer"
            >
              {t.nav.logout}
            </button>
          </div>
        </div>

        {/* 2FA Status Card */}
        <div className="rounded-2xl border border-border bg-panel p-6">
          <div className="flex items-center gap-3 pb-4 border-b border-border">
            {totpEnabled ? (
              <ShieldCheck className="h-6 w-6 text-accent" />
            ) : (
              <ShieldOff className="h-6 w-6 text-warn" />
            )}
            <div>
              <p className="font-medium">{t.auth.totpTitle} (TOTP)</p>
              <p className="text-xs text-zinc-500">
                {totpEnabled ? t.security.descEnabled : t.security.descDisabled}
              </p>
            </div>
            <span
              className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${
                totpEnabled
                  ? "bg-accent/15 text-accent"
                  : "bg-warn/15 text-warn"
              }`}
            >
              {totpEnabled ? t.common.active : t.common.inactive}
            </span>
          </div>

          {/* ---- State machine ---- */}
          {step === "idle" && !totpEnabled && (
            <div className="pt-5">
              <p className="mb-4 text-sm text-zinc-400">
                {t.security.desc}
              </p>
              <button
                onClick={handleSetup}
                disabled={loading}
                className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-black hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
              >
                {loading ? t.common.loading : t.security.enable2fa}
              </button>
            </div>
          )}

          {step === "qr" && (
            <div className="pt-5 space-y-5">
              <div className="text-sm text-zinc-400 space-y-1">
                <p className="font-medium text-zinc-200">
                  <QrCode className="mr-1.5 inline h-4 w-4" />
                  {t.security.scanQrTitle}
                </p>
                <p>{locale === "vi" ? "Mở Google Authenticator hoặc Authy → nhấn '+' → Quét mã QR." : "Open Google Authenticator or Authy → tap '+' → Scan QR Code."}</p>
              </div>

              {/* QR image */}
              <div className="flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt="TOTP QR Code"
                  className="h-48 w-48 rounded-xl border border-border bg-white p-2"
                />
              </div>

              {/* Manual secret fallback */}
              <details className="text-xs text-zinc-500">
                <summary className="cursor-pointer hover:text-zinc-300">
                  {locale === "vi" ? "Không quét được? Nhập thủ công" : "Cannot scan? Enter secret manually"}
                </summary>
                <p className="mt-2 break-all rounded-lg bg-canvas px-3 py-2 font-mono text-zinc-300">
                  {secret}
                </p>
              </details>

              {/* Confirm code */}
              <form onSubmit={handleEnable} className="space-y-3">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder={t.auth.totpPlaceholder}
                  required
                  autoFocus
                  className="w-full rounded-lg border border-border bg-canvas py-2.5 px-4 text-center font-mono text-lg tracking-[0.4em] outline-none placeholder:text-zinc-600 focus:border-accent/60"
                />
                {error && (
                  <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-black hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
                >
                  {loading ? t.auth.verifying : t.security.verifyToken}
                </button>
              </form>
            </div>
          )}

          {(step === "done" || totpEnabled) && step !== "qr" && (
            <div className="pt-5 flex items-center gap-3 text-sm text-zinc-400">
              <CheckCircle2 className="h-5 w-5 text-accent shrink-0" />
              <span>
                {t.security.setupSuccess}
              </span>
            </div>
          )}
        </div>

        {/* Info box */}
        <div className="rounded-xl border border-border/50 bg-panel/50 px-5 py-4 text-xs text-zinc-500 space-y-1">
          <p className="font-medium text-zinc-400">{locale === "vi" ? "Tại sao cần 2FA?" : "Why is 2FA required?"}</p>
          <p>
            {locale === "vi"
              ? "Theo Governance Model, các quyết định rủi ro R3/R4 (triển khai production, thanh toán, thay đổi DB) yêu cầu Founder xác nhận bằng mã TOTP. Đây là lớp bảo vệ cuối cùng ngăn AI tự ý thực thi hành động không thể hoàn tác."
              : "Per AI-OPC Governance Model, critical R3/R4 actions (production deployment, payments, DB mutations) require Founder TOTP confirmation. This is the last line of defense preventing unauthorized autonomous AI executions."}
          </p>
        </div>
      </div>
    </div>
  );
}
