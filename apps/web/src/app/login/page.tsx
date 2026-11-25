"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { Building2, Lock, Mail, KeyRound, AlertCircle, Sparkles, Loader2 } from "lucide-react";
import { login, verify2fa, setToken, loginWithGoogle, fetchAuthConfig, checkZaloAuthSession } from "@/lib/api";
import { ZaloLoginModal, openZaloAuthPopup } from "@/components/ZaloLoginModal";
import { useI18n } from "@/context/I18nContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              logo_alignment?: "left" | "center";
              width?: string | number;
              locale?: string;
            }
          ) => void;
          prompt: (notification?: (notification: any) => void) => void;
        };
      };
    };
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [googleClientId, setGoogleClientId] = useState<string>("");
  const [googleLoginEnabled, setGoogleLoginEnabled] = useState(true);
  const [zaloLoginEnabled, setZaloLoginEnabled] = useState(true);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [showConfigHelp, setShowConfigHelp] = useState(false);
  const [isZaloModalOpen, setIsZaloModalOpen] = useState(false);
  const [zaloWaiting, setZaloWaiting] = useState(false);
  const [zaloStatusText, setZaloStatusText] = useState("");
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<Window | null>(null);

  // Cơ chế xác thực và chuyển hướng tự động sang Dashboard
  const verifyAndRedirect = useCallback(async (maxAttempts = 15) => {
    setZaloWaiting(true);
    setZaloStatusText(locale === "vi" ? "Đang đồng bộ phiên Zalo..." : "Syncing Zalo session...");
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await checkZaloAuthSession();
        if (res.authenticated && res.token) {
          setZaloStatusText(locale === "vi" ? "Xác thực thành công! Đang vào hệ thống..." : "Authenticated! Entering system...");
          setToken(res.token);
          // Đóng popup nếu còn mở
          if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.close();
          }
          // Chuyển hướng trực tiếp vào Dashboard
          window.location.href = "/";
          return true;
        }
      } catch (err) {
        console.warn("[ZaloAuth] Đang chờ webhook ghi nhận phiên...", err);
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    setZaloWaiting(false);
    setZaloStatusText("");
    return false;
  }, [locale]);

  // Lắng nghe sự kiện Zalo Auth postMessage
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (
        event.data &&
        (event.data.type === "ZALO_AUTH_SUCCESS" || event.data.event === "ZALO_AUTH_SUCCESS")
      ) {
        console.log("[Login] Nhận tín hiệu postMessage ZALO_AUTH_SUCCESS từ Popup:", event.data);
        verifyAndRedirect(20);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [verifyAndRedirect]);

  // Polling song song định kỳ khi đang trong trạng thái chờ quét
  useEffect(() => {
    if (!zaloWaiting) return;
    const interval = setInterval(async () => {
      try {
        const res = await checkZaloAuthSession();
        if (res.authenticated && res.token) {
          setZaloWaiting(false);
          setToken(res.token);
          if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.close();
          }
          window.location.href = "/";
        }
      } catch {
        // Tiếp tục polling
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [zaloWaiting]);

  // 1. Fetch Google Client ID on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const cfg = await fetchAuthConfig().catch(() => ({
          googleLoginEnabled: true,
          googleClientId: "",
          googleConfigured: false,
          zaloLoginEnabled: true,
        }));
        setGoogleLoginEnabled(cfg.googleLoginEnabled);
        setZaloLoginEnabled(cfg.zaloLoginEnabled !== undefined ? cfg.zaloLoginEnabled : true);
        if (cfg.googleLoginEnabled) {
          if (cfg.googleClientId) {
            setGoogleClientId(cfg.googleClientId);
          } else if (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
            setGoogleClientId(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
          }
        } else {
          setGoogleClientId("");
        }
      } catch {
        // Ignore config fetch error
      }
    }
    loadConfig();
  }, []);

  // 2. Initialize Google Identity Services when script and client ID are ready
  useEffect(() => {
    if (!scriptLoaded || !googleClientId || !window.google?.accounts?.id) return;

    try {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleGoogleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      if (googleButtonRef.current) {
        googleButtonRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "signin_with",
          width: "100%",
          logo_alignment: "left",
        });
      }

      // One Tap prompt
      window.google.accounts.id.prompt();
    } catch (err) {
      console.error("[GIS] Init failed:", err);
    }
  }, [scriptLoaded, googleClientId]);

  async function handleGoogleCredentialResponse(response: { credential: string }) {
    if (!response.credential) return;
    setError("");
    setGoogleLoading(true);
    try {
      const res = await loginWithGoogle(response.credential);
      setToken(res.token);
      router.push("/");
    } catch (err: any) {
      setError(err.message || (locale === "vi" ? "Đăng nhập với Google thất bại" : "Google Sign-In failed"));
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login(email, password);
      if (res.status === "2FA_REQUIRED") {
        setPendingToken(res.pendingToken);
      } else {
        setToken(res.token);
        router.push("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (locale === "vi" ? "Đăng nhập thất bại" : "Login failed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify2fa(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await verify2fa(pendingToken!, totpCode);
      setToken(res.token);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : (locale === "vi" ? "Mã 2FA không đúng" : "Invalid 2FA code"));
      setTotpCode("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Load Google Identity Services */}
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
      />

      <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12 relative">
        {/* Language Switcher in Top-Right */}
        <div className="absolute top-6 right-6">
          <LanguageSwitcher />
        </div>

        <div className="w-full max-w-sm space-y-6">
          {/* Logo / Branding */}
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-border/80 bg-panel shadow-lg shadow-black/20">
              <Building2 className="h-7 w-7 text-accent" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-zinc-100">{t.auth.loginTitle}</h1>
              <p className="text-xs text-zinc-400 flex items-center justify-center gap-1 mt-0.5">
                <Sparkles className="h-3 w-3 text-accent" /> {t.auth.loginSubtitle}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border/80 bg-panel/95 p-6 sm:p-7 shadow-2xl backdrop-blur-md">
            {!pendingToken ? (
              <div className="space-y-5">
                {(googleLoginEnabled || zaloLoginEnabled) && (
                  <div className="space-y-2.5">
                    {/* Google Sign-In Integration */}
                    {googleLoginEnabled && (
                      googleLoading ? (
                      <div className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border/80 bg-zinc-900 text-xs font-medium text-zinc-300">
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        <span>{t.auth.signingIn}</span>
                      </div>
                    ) : googleClientId ? (
                      <div className="flex justify-center min-h-[44px]">
                        <div ref={googleButtonRef} className="w-full flex justify-center" />
                      </div>
                    ) : (
                      /* Fallback when Google Client ID not yet set */
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowConfigHelp((v) => !v)}
                          className="flex h-11 w-full items-center justify-center gap-3 rounded-full border border-border/80 bg-white/5 px-4 text-xs font-medium text-zinc-200 transition-all hover:bg-white/10 hover:border-zinc-500 cursor-pointer shadow-sm"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24">
                            <path
                              fill="#4285F4"
                              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            />
                            <path
                              fill="#34A853"
                              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                            />
                            <path
                              fill="#EA4335"
                              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                            />
                          </svg>
                          <span>{t.auth.googleSignIn}</span>
                        </button>

                        {showConfigHelp && (
                          <div className="mt-2 rounded-xl border border-border/80 bg-zinc-950 p-3 text-[11px] text-zinc-400 space-y-1 leading-relaxed">
                            <p className="font-semibold text-zinc-200">ℹ️ Google Sign-In:</p>
                            <p>
                              Configure <code>GOOGLE_CLIENT_ID</code> in <code>services/api/.env</code> or <code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> in <code>apps/web/.env.local</code>.
                            </p>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Zalo Sign-In Integration */}
                    {zaloLoginEnabled && (
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setIsZaloModalOpen(true);
                          }}
                          className="flex h-11 w-full items-center justify-between rounded-full border border-blue-500/40 bg-gradient-to-r from-[#0068FF]/20 via-[#0068FF]/15 to-[#0068FF]/25 hover:from-[#0068FF]/30 hover:to-[#0068FF]/35 px-4 text-xs font-semibold text-blue-200 hover:text-white transition-all cursor-pointer shadow-sm hover:shadow-blue-500/25 hover:border-blue-400/70 group"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0068FF] text-white shadow group-hover:scale-105 transition-transform shrink-0">
                              <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                                <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.08L2 22l5.12-1.35C8.55 21.49 10.23 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/>
                              </svg>
                            </div>
                            <span className="font-medium">
                              {t.auth.zaloSignIn}
                            </span>
                          </div>
                          <span className="rounded-full bg-blue-500/25 border border-blue-400/30 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                            Quét mã QR
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Divider */}
                {(googleLoginEnabled || zaloLoginEnabled) && (
                  <div className="relative flex items-center justify-center">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-border/60" />
                    </div>
                    <div className="relative bg-panel px-3 text-[11px] uppercase tracking-wider text-zinc-500">
                      {t.auth.orContinueWith}
                    </div>
                  </div>
                )}

                {/* Password Login Form */}
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-3">
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t.auth.emailPlaceholder}
                        required
                        className="w-full rounded-xl border border-border/80 bg-canvas/80 py-2.5 pl-10 pr-4 text-xs sm:text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-all focus:border-accent focus:ring-1 focus:ring-accent"
                      />
                    </div>

                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t.auth.passwordPlaceholder}
                        required
                        className="w-full rounded-xl border border-border/80 bg-canvas/80 py-2.5 pl-10 pr-4 text-xs sm:text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-all focus:border-accent focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                      <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || googleLoading}
                    className="w-full rounded-xl bg-accent py-2.5 text-xs sm:text-sm font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-50 cursor-pointer shadow-md"
                  >
                    {loading ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{t.auth.signingIn}</span>
                      </span>
                    ) : (
                      t.auth.signInBtn
                    )}
                  </button>
                </form>
              </div>
            ) : (
              /* ---- Bước 2: TOTP Code ---- */
              <form onSubmit={handleVerify2fa} className="space-y-5">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-zinc-200">{t.auth.totpTitle}</h2>
                  <p className="text-xs text-zinc-400">
                    {t.auth.totpSubtitle}
                  </p>
                </div>

                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                    placeholder={t.auth.totpPlaceholder}
                    required
                    autoFocus
                    className="w-full rounded-xl border border-border/80 bg-canvas/80 py-2.5 pl-10 pr-4 text-center font-mono text-lg tracking-[0.4em] text-zinc-100 placeholder-zinc-600 outline-none transition-all focus:border-accent focus:ring-1 focus:ring-accent"
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || totpCode.length !== 6}
                  className="w-full rounded-xl bg-accent py-2.5 text-xs sm:text-sm font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-50 cursor-pointer shadow-md"
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{t.auth.verifying}</span>
                    </span>
                  ) : (
                    t.auth.verifyBtn
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPendingToken(null);
                    setError("");
                  }}
                  className="w-full text-center text-xs text-zinc-500 transition-colors hover:text-zinc-300 cursor-pointer"
                >
                  ← {t.auth.backToLogin}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Zalo Login Modal */}
      <ZaloLoginModal
        isOpen={isZaloModalOpen}
        initialTab="popup"
        onClose={() => setIsZaloModalOpen(false)}
        onSuccess={(token) => {
          setToken(token);
          router.push("/");
        }}
      />
    </>
  );
}
