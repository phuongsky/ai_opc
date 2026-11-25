"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  QrCode,
  ShieldCheck,
  Smartphone,
  Radio,
  RefreshCw,
  AlertCircle,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  ChevronLeft,
} from "lucide-react";
import { io, Socket } from "socket.io-client";

function ZaloPortalContent() {
  const searchParams = useSearchParams();

  const [targetUrl, setTargetUrl] = useState("/api/zalo/webhook");
  const [customParams, setCustomParams] = useState("");
  const [autoStart, setAutoStart] = useState(false);

  const [step, setStep] = useState<"config" | "qr" | "success">("config");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrStep, setQrStep] = useState<"idle" | "init" | "waiting_scan" | "scanned" | "qr_expired" | "logged_in" | "error">("idle");
  const [statusText, setStatusText] = useState("Đang yêu cầu tạo phiên Zalo...");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [sessionResult, setSessionResult] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  // Đọc query parameters khi mount
  useEffect(() => {
    const pTargetUrl = searchParams.get("targetUrl");
    const pCustomParams = searchParams.get("customParams");
    const pAutoStart = searchParams.get("autoStart");

    if (pTargetUrl) {
      setTargetUrl(pTargetUrl);
    } else {
      const hostname = window.location.hostname || "localhost";
      const apiBase = process.env.NEXT_PUBLIC_API_URL || `http://${hostname}:8000`;
      setTargetUrl(`${apiBase}/api/zalo/webhook`);
    }

    if (pCustomParams) {
      try {
        setCustomParams(decodeURIComponent(pCustomParams));
      } catch {
        setCustomParams(pCustomParams);
      }
    }

    if (pAutoStart === "true" || pAutoStart === "1") {
      setAutoStart(true);
    }
  }, [searchParams]);

  // Khởi động luồng tạo mã QR
  const handleStartLogin = useCallback((explicitTargetUrl?: string, explicitParams?: string) => {
    const finalTarget = explicitTargetUrl || targetUrl;
    const finalParams = explicitParams !== undefined ? explicitParams : customParams;

    let parsedParams: any = {};
    if (finalParams && finalParams.trim()) {
      try {
        parsedParams = JSON.parse(finalParams);
      } catch {
        parsedParams = { raw: finalParams };
      }
    }

    setErrorMessage(null);
    setQrImage(null);
    setStep("qr");
    setQrStep("init");
    setStatusText("Đang kết nối Zalo Gateway & khởi tạo mã QR...");

    const hostname = window.location.hostname || "localhost";
    const apiBase = process.env.NEXT_PUBLIC_API_URL || `http://${hostname}:8000`;

    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const socket = io(apiBase, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnectionAttempts: 5,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[ZaloPortal] Socket connected:", socket.id);
      socket.emit("start-login", {
        targetAppUrl: finalTarget,
        customParams: parsedParams,
      });
    });

    socket.on("qr-received", (data: { qrImage: string; message: string }) => {
      setQrImage(data.qrImage);
      setQrStep("waiting_scan");
      setStatusText(data.message || "Mã QR đã sẵn sàng! Mở app Zalo trên điện thoại để quét mã.");
    });

    socket.on("status-update", (data: { step: string; message: string }) => {
      if (data.step === "waiting_scan") setQrStep("waiting_scan");
      else if (data.step === "scanned") setQrStep("scanned");
      else if (data.step === "qr_expired") setQrStep("qr_expired");
      else if (data.step === "logged_in") setQrStep("logged_in");
      setStatusText(data.message);
    });

    socket.on("login-complete", (data: any) => {
      console.log("[ZaloPortal] Login completed:", data);
      setSessionResult(data);
      setStep("success");
      setQrStep("logged_in");

      // Bắn postMessage về cửa sổ cha (nếu mở dạng popup)
      if (window.opener && typeof window.opener.postMessage === "function") {
        const payload = {
          type: "ZALO_AUTH_SUCCESS",
          event: "ZALO_AUTH_SUCCESS",
          userId: data.userId || data.sessionInfo?.uid,
          payload: data,
        };
        console.log("[ZaloPortal] Gửi postMessage về window.opener:", payload);
        window.opener.postMessage(payload, "*");

        // Tự động đóng sau 2.5s nếu là popup tự động
        setTimeout(() => {
          try {
            window.close();
          } catch {}
        }, 2500);
      }
    });

    socket.on("login-error", (data: { message: string }) => {
      console.error("[ZaloPortal] Login error:", data);
      setQrStep("error");
      setErrorMessage(data.message || "Phiên tạo mã QR gặp lỗi.");
      setStatusText("Không thể tạo mã QR Zalo.");
    });

    socket.on("connect_error", (err) => {
      console.warn("[ZaloPortal] Connect error:", err.message);
      setQrStep("error");
      setErrorMessage(`Không thể kết nối máy chủ Zalo Bridge (${err.message}).`);
    });
  }, [targetUrl, customParams]);

  // Tự động khởi động nếu autoStart được bật
  useEffect(() => {
    if (autoStart && targetUrl && step === "config") {
      handleStartLogin(targetUrl, customParams);
    }
  }, [autoStart, targetUrl, customParams, step, handleStartLogin]);

  // Dọn dẹp socket khi unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const handleCopyResponse = () => {
    if (!sessionResult) return;
    navigator.clipboard.writeText(JSON.stringify(sessionResult, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-100 flex items-center justify-center p-4 selection:bg-blue-500 selection:text-white">
      <div className="w-full max-w-lg bg-slate-900/90 border border-slate-700/80 backdrop-blur-xl rounded-3xl shadow-2xl p-6 sm:p-8 relative overflow-hidden">
        {/* Ambient Glows */}
        <div className="absolute -top-24 -right-24 w-56 h-56 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-56 h-56 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="text-center mb-6 relative">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-2xl mb-3 shadow-lg shadow-blue-500/30 ring-4 ring-blue-500/10">
            <svg className="w-9 h-9 text-white fill-current" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.08L2 22l5.12-1.35C8.55 21.49 10.23 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z" />
            </svg>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            Xác thực Tài khoản Zalo
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1.5 font-medium">
            Quét mã QR thời gian thực &amp; tự động gửi phiên sang ứng dụng đích
          </p>
        </div>

        {/* Bước 1: Cấu hình */}
        {step === "config" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                URL ứng dụng đích nhận Webhook API:
              </label>
              <input
                type="text"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="http://localhost:8000/api/zalo/webhook"
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl p-3 text-xs sm:text-sm text-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none font-mono transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Ghi chú / Tham số kèm theo (JSON tùy chọn):
              </label>
              <input
                type="text"
                value={customParams}
                onChange={(e) => setCustomParams(e.target.value)}
                placeholder='{"systemId": "ai-opc-cockpit", "env": "prod"}'
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl p-3 text-xs sm:text-sm text-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none font-mono transition"
              />
            </div>

            <button
              type="button"
              onClick={() => handleStartLogin()}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-blue-500/25 transition duration-200 flex items-center justify-center gap-2 group cursor-pointer text-xs sm:text-sm"
            >
              <QrCode className="w-4 h-4 transition-transform group-hover:scale-110" />
              <span>Tạo mã QR Đăng nhập</span>
            </button>
          </div>
        )}

        {/* Bước 2: Hiển thị QR Code và trạng thái */}
        {step === "qr" && (
          <div className="flex flex-col items-center justify-center text-center space-y-4">
            {/* Status pill */}
            <div className="flex items-center gap-2 text-xs">
              {qrStep === "scanned" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/20 border border-blue-500/40 px-3 py-1 text-xs font-medium text-blue-300 animate-pulse">
                  <Smartphone className="h-3.5 w-3.5 text-blue-400" />
                  Đã quét mã! Xác nhận trên điện thoại...
                </span>
              ) : qrStep === "waiting_scan" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-medium text-emerald-400">
                  <Radio className="h-3 w-3 animate-pulse text-emerald-400" />
                  Mã QR sẵn sàng • Đang chờ quét
                </span>
              ) : qrStep === "qr_expired" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 border border-amber-500/40 px-3 py-1 text-xs font-medium text-amber-300">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                  Mã QR đã hết hạn
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 border border-blue-500/30 px-3 py-1 text-xs font-medium text-blue-300">
                  <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                  Đang kết nối Zalo Gateway...
                </span>
              )}
            </div>

            {/* QR Card */}
            <div className="relative p-3 bg-white rounded-2xl shadow-2xl min-h-[220px] min-w-[220px] flex items-center justify-center border-4 border-slate-800">
              {qrImage && qrStep !== "qr_expired" && qrStep !== "init" ? (
                <div className="relative group">
                  <img
                    src={qrImage}
                    alt="Mã QR Zalo"
                    className="h-52 w-52 rounded-lg object-contain"
                  />
                  {qrStep === "waiting_scan" && (
                    <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-lg">
                      <div className="w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent shadow-lg shadow-blue-400 animate-bounce opacity-80" />
                    </div>
                  )}
                  {qrStep === "scanned" && (
                    <div className="absolute inset-0 bg-blue-950/85 backdrop-blur-xs rounded-lg flex flex-col items-center justify-center p-3 text-center text-white space-y-2">
                      <Smartphone className="h-8 w-8 text-blue-400 animate-bounce" />
                      <p className="text-xs font-semibold text-blue-200">Đã quét thành công!</p>
                      <p className="text-[10px] text-zinc-300">Vui lòng bấm &quot;Xác nhận đăng nhập&quot; trên Zalo.</p>
                    </div>
                  )}
                </div>
              ) : qrStep === "qr_expired" ? (
                <div className="flex flex-col items-center justify-center h-52 w-52 text-slate-800 space-y-2 p-2 text-center">
                  <AlertCircle className="h-10 w-10 text-amber-500" />
                  <p className="text-xs font-semibold text-slate-700">Mã QR đã hết hạn</p>
                  <button
                    type="button"
                    onClick={() => handleStartLogin()}
                    className="mt-1 flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-blue-500 cursor-pointer"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Tạo mã mới</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-52 w-52 text-slate-600 space-y-2">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                  <p className="text-xs font-medium text-slate-500">Đang khởi tạo Zalo Bridge...</p>
                </div>
              )}
            </div>

            {/* Instruction */}
            <p className="text-xs text-slate-300 text-center max-w-xs leading-relaxed font-medium">
              {statusText}
            </p>

            {errorMessage && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 w-full text-left">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setStep("config")}
              className="text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer flex items-center gap-1"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Hủy và quay lại cấu hình</span>
            </button>
          </div>
        )}

        {/* Bước 3: Kết quả thành công */}
        {step === "success" && (
          <div className="space-y-4">
            <div className="bg-emerald-950/50 border border-emerald-500/40 rounded-2xl p-4 sm:p-5 text-emerald-200">
              <div className="flex items-center gap-2.5 mb-2 font-bold text-base text-emerald-300">
                <ShieldCheck className="h-6 w-6 text-emerald-400" />
                <span>Xác thực thành công!</span>
              </div>
              <p className="text-xs sm:text-sm text-emerald-300/90 leading-relaxed font-medium">
                Phiên làm việc của UID <strong>{sessionResult?.userId || sessionResult?.sessionInfo?.uid}</strong> đã được kích hoạt thành công.
              </p>
            </div>

            {sessionResult && (
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-400">Kết quả phản hồi phiên:</p>
                  <button
                    type="button"
                    onClick={handleCopyResponse}
                    className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium px-2 py-1 bg-blue-950/50 rounded border border-blue-800/40 transition cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">Đã chép</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Sao chép JSON</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="text-[11px] text-slate-300 overflow-x-auto max-h-44 p-3 bg-slate-900 rounded-xl font-mono leading-relaxed">
                  {JSON.stringify(sessionResult, null, 2)}
                </pre>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setStep("config");
                setQrStep("idle");
              }}
              className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-2.5 px-4 rounded-xl border border-slate-700 transition cursor-pointer text-xs"
            >
              Đăng nhập tài khoản khác
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ZaloPortalPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-300">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      }
    >
      <ZaloPortalContent />
    </Suspense>
  );
}
