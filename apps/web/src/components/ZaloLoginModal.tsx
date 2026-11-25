"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  AlertCircle,
  QrCode,
  ShieldCheck,
  Terminal,
  Sparkles,
  Smartphone,
  Code2,
  CheckCircle2,
  Globe,
  Radio,
  RefreshCw,
  Zap,
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import { checkZaloAuthSession, loginWithZaloManual, setToken, fetchZaloStatus } from "@/lib/api";

interface ZaloLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (token: string) => void;
  autoOpenPopup?: boolean;
  initialTab?: "popup" | "apiGuide" | "manual";
}

// const SAMPLE_PAYLOAD = {
//   event: "ZALO_AUTH_SUCCESS",
//   timestamp: new Date().toISOString(),
//   userId: "637619582990873903",
//   context: {
//     uid: "637619582990873903",
//     imei: "23ce4d45-9169-475c-976b-64d1a6f9eef9-a69b52f9d7f760edf3fd052bcda2542f",
//     cookie: [{ key: "zpw_sek", value: "sample_zalo_session_token_xyz" }],
//     userAgent:
//       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
//     secretKey: "sample_secret_key",
//     sessionKey: "sample_session_key",
//   },
//   customParams: {
//     systemId: "ai-opc-cockpit",
//   },
// };

const SAMPLE_PAYLOAD = {
  event: "ZALO_AUTH_SUCCESS",
  timestamp: new Date().toISOString(),
  userId: "637...",
  context: {
    uid: "637...",
    imei: "23ce4d45-9...",
    cookie: [{ key: "zpw_sek", value: "sample_zalo_session_token_xyz" }],
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    secretKey: "sample_secret_key",
    sessionKey: "sample_session_key",
  },
  customParams: {
    systemId: "ai-opc-cockpit",
  },
};

/**
 * Hàm mở Popup xác thực Zalo Portal nội bộ:
 * - Căn giữa màn hình (540x720)
 * - Truyền targetUrl, customParams, autoStart=true
 * - Lắng nghe postMessage ZALO_AUTH_SUCCESS
 */
export function openZaloAuthPopup(options?: {
  targetWebhookUrl?: string;
  zaloPortalUrl?: string;
  onAuthSuccess?: (payload: any) => void;
}) {
  if (typeof window === "undefined") return null;

  const hostname = window.location.hostname || "localhost";
  const apiBase = process.env.NEXT_PUBLIC_API_URL || `http://${hostname}:8000`;
  const defaultWebhook = `${apiBase}/api/zalo/webhook`;
  const targetWebhook = encodeURIComponent(options?.targetWebhookUrl || defaultWebhook);

  const customParams = encodeURIComponent(
    JSON.stringify({
      currentUserId: "founder",
      tenantId: "ai_opc_corp",
      timestamp: Date.now(),
    })
  );

  const defaultPortal =
    process.env.NEXT_PUBLIC_ZALO_PORTAL_URL ||
    (typeof window !== "undefined" ? `${window.location.origin}/zalo-portal` : "/zalo-portal");
  const portalBase = (options?.zaloPortalUrl || defaultPortal).replace(/\/+$/, "");
  const zaloAuthUrl = `${portalBase}${portalBase.includes("?") ? "&" : "/?"}targetUrl=${targetWebhook}&customParams=${customParams}&autoStart=true`;

  const width = 540;
  const height = 720;
  const left = (window.innerWidth - width) / 2 + window.screenX;
  const top = (window.innerHeight - height) / 2 + window.screenY;

  const popup = window.open(
    zaloAuthUrl,
    "ZaloAuthPopup",
    `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes`
  );

  // Lắng nghe tín hiệu postMessage từ Zalo Auth Portal
  const listener = (event: MessageEvent) => {
    if (
      event.data &&
      (event.data.type === "ZALO_AUTH_SUCCESS" || event.data.event === "ZALO_AUTH_SUCCESS")
    ) {
      console.log("[ZaloAuthPopup] Xác thực Zalo thành công từ popup:", event.data);
      if (options?.onAuthSuccess) {
        options.onAuthSuccess(event.data.payload || event.data);
      }
      window.removeEventListener("message", listener);
    }
  };

  window.addEventListener("message", listener);
  return popup;
}

export function ZaloLoginModal({
  isOpen,
  onClose,
  onSuccess,
  autoOpenPopup,
  initialTab = "popup",
}: ZaloLoginModalProps) {
  const [activeTab, setActiveTab] = useState<"popup" | "apiGuide" | "manual">(initialTab);
  const [codeLang, setCodeLang] = useState<"express" | "nextjs" | "popupJs">("nextjs");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("http://localhost:8000/api/zalo/webhook");
  const [nextWebhookUrl, setNextWebhookUrl] = useState("http://localhost:3000/api/zalo/webhook");
  const [zaloPortalUrl, setZaloPortalUrl] = useState("/zalo-portal");

  // State cho In-App Live QR
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrStep, setQrStep] = useState<"idle" | "init" | "waiting_scan" | "scanned" | "qr_expired" | "logged_in" | "error">("idle");
  const [qrStatusText, setQrStatusText] = useState("Đang kết nối Zalo Gateway...");
  const [detectedUid, setDetectedUid] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [manualJson, setManualJson] = useState(JSON.stringify(SAMPLE_PAYLOAD, null, 2));
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState("");
  const [popupOpened, setPopupOpened] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Cập nhật webhook URL chuẩn dựa trên hostname hiện tại
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hostname = window.location.hostname || "localhost";
      const apiBase = process.env.NEXT_PUBLIC_API_URL || `http://${hostname}:8000`;
      setWebhookUrl(`${apiBase}/api/zalo/webhook`);
      setNextWebhookUrl(`${window.location.origin}/api/zalo/webhook`);
      setZaloPortalUrl(
        process.env.NEXT_PUBLIC_ZALO_PORTAL_URL || `${window.location.origin}/zalo-portal`
      );
    }
  }, []);

  // Xử lý tín hiệu thành công
  const handleZaloSuccessSignal = useCallback((payload: any) => {
    const uid = payload?.userId || payload?.context?.uid || "Zalo User";
    setDetectedUid(uid);
    setQrStep("logged_in");
    setQrStatusText(`Đã xác thực thành công tài khoản Zalo (UID: ${uid})`);

    const token = payload?.token;
    if (token) {
      setToken(token);
      setTimeout(() => {
        onSuccess(token);
      }, 700);
      return;
    }

    // Fallback kiểm tra token từ backend
    checkZaloAuthSession()
      .then((res) => {
        if (res.authenticated && res.token) {
          setToken(res.token);
          setTimeout(() => {
            onSuccess(res.token!);
          }, 700);
        }
      })
      .catch(() => { });
  }, [onSuccess]);

  // Khởi tạo luồng Socket.io QR khi mở tab "popup" (Live QR Scan)
  const startLiveQrSession = useCallback(() => {
    setErrorMessage(null);
    setQrStep("init");
    setQrStatusText("Đang kết nối Zalo Gateway & khởi tạo mã QR...");
    setQrImage(null);

    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
      console.log("[ZaloModal] Đã kết nối Socket.io tới API:", socket.id);
      socket.emit("start-login", {
        targetAppUrl: `${apiBase}/api/zalo/webhook`,
        customParams: {
          source: "ZaloLoginModal_InApp",
          timestamp: Date.now(),
        },
      });
    });

    socket.on("qr-received", (data: { qrImage: string; message: string }) => {
      console.log("[ZaloModal] Đã nhận mã QR từ Zalo Gateway");
      setQrImage(data.qrImage);
      setQrStep("waiting_scan");
      setQrStatusText(data.message || "Mã QR đã sẵn sàng! Mở app Zalo trên điện thoại để quét mã.");
    });

    socket.on("status-update", (data: { step: string; message: string }) => {
      console.log("[ZaloModal] Status update:", data);
      if (data.step === "waiting_scan") {
        setQrStep("waiting_scan");
      } else if (data.step === "scanned") {
        setQrStep("scanned");
      } else if (data.step === "qr_expired") {
        setQrStep("qr_expired");
      } else if (data.step === "logged_in") {
        setQrStep("logged_in");
      }
      setQrStatusText(data.message);
    });

    socket.on("login-complete", (data: any) => {
      console.log("[ZaloModal] Login complete:", data);
      handleZaloSuccessSignal(data);
    });

    socket.on("login-error", (data: { message: string }) => {
      console.error("[ZaloModal] Login error:", data);
      setQrStep("error");
      setErrorMessage(data.message || "Phiên tạo mã QR gặp lỗi.");
      setQrStatusText("Không thể tạo mã QR Zalo.");
    });

    socket.on("connect_error", (err) => {
      console.warn("[ZaloModal] Lỗi kết nối Socket:", err.message);
      setQrStep("error");
      setErrorMessage(`Không thể kết nối máy chủ Zalo Bridge (${err.message}). Vui lòng kiểm tra API.`);
    });
  }, [handleZaloSuccessSignal]);

  // Quản lý lifecycle của Socket.io theo trạng thái mở Modal
  useEffect(() => {
    if (isOpen && activeTab === "popup" && qrStep === "idle") {
      startLiveQrSession();
    }

    return () => {
      if (!isOpen && socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setQrStep("idle");
      }
    };
  }, [isOpen, activeTab, qrStep, startLiveQrSession]);

  // Lắng nghe postMessage từ Popup (nếu người dùng mở popup ngoài)
  useEffect(() => {
    if (!isOpen) return;

    function handleMessage(event: MessageEvent) {
      if (
        event.data &&
        (event.data.type === "ZALO_AUTH_SUCCESS" || event.data.event === "ZALO_AUTH_SUCCESS")
      ) {
        console.log("[ZaloAuth] Nhận postMessage ZALO_AUTH_SUCCESS:", event.data);
        handleZaloSuccessSignal(event.data.payload || event.data);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [isOpen, handleZaloSuccessSignal]);

  if (!isOpen) return null;

  const handleManualOpenPopup = () => {
    setPopupOpened(true);
    openZaloAuthPopup({
      targetWebhookUrl: webhookUrl,
      zaloPortalUrl,
      onAuthSuccess: handleZaloSuccessSignal,
    });
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleManualLogin = async () => {
    setManualError("");
    setManualLoading(true);
    try {
      let parsed;
      try {
        parsed = JSON.parse(manualJson);
      } catch {
        throw new Error("JSON không hợp lệ. Vui lòng kiểm tra định dạng cú pháp.");
      }

      const res = await loginWithZaloManual(parsed);
      setQrStep("logged_in");
      setDetectedUid(res.userId || "Zalo User");
      setToken(res.token);
      setTimeout(() => {
        onSuccess(res.token);
      }, 700);
    } catch (err: any) {
      setManualError(err.message || "Xác thực phiên Zalo thất bại.");
    } finally {
      setManualLoading(false);
    }
  };

  const codeSnippets = {
    nextjs: `// Next.js App Router: app/api/zalo/webhook/route.ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json();
  const { event, userId, context, customParams } = body;

  console.log("[Next.js Zalo Webhook] Nhận context Zalo:", userId, context?.imei);

  // Lưu context vào Database / chuyển tiếp sang Backend API
  return NextResponse.json({ success: true, received: true });
}`,
    express: `// Node.js / Express: app.post('/api/zalo/webhook')
app.post('/api/zalo/webhook', async (req, res) => {
  const { event, userId, context, customParams } = req.body;
  if (event === 'ZALO_AUTH_SUCCESS') {
    // 1. Lưu session Zalo vào Database hoặc Redis của bạn
    await db.zaloSessions.upsert({
      where: { userId: userId },
      update: {
        cookie: JSON.stringify(context.cookie),
        imei: context.imei,
        userAgent: context.userAgent,
        updatedAt: new Date()
      }
    });
    console.log(\`Đã cập nhật phiên Zalo cho user: \${userId}\`);

    // 2. Phản hồi 200 OK để Zalo Auth Portal hiển thị thành công
    return res.status(200).json({ success: true, message: 'Đã lưu phiên thành công' });
  }
  return res.status(400).json({ error: 'Sự kiện không hợp lệ' });
});`,
    popupJs: `// Giao diện gọi Popup chuẩn (Self-hosted Portal)
function openZaloAuthPopup() {
  const targetWebhook = encodeURIComponent('http://localhost:8000/api/zalo/webhook');
  const customParams = encodeURIComponent(JSON.stringify({
    currentUserId: "founder",
    tenantId: "ai_opc_corp"
  }));
  const zaloAuthUrl = \`/zalo-portal?targetUrl=\${targetWebhook}&customParams=\${customParams}&autoStart=true\`;

  // Căn giữa màn hình để mở popup (540x720)
  const width = 540, height = 720;
  const left = (window.innerWidth - width) / 2 + window.screenX;
  const top = (window.innerHeight - height) / 2 + window.screenY;

  window.open(zaloAuthUrl, 'ZaloAuthPopup', \`width=\${width},height=\${height},top=\${top},left=\${left}\`);

  // Lắng nghe tín hiệu khi Zalo Auth Portal xác thực thành công
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'ZALO_AUTH_SUCCESS') {
      console.log('Xác thực Zalo thành công:', event.data.payload);
      location.reload();
    }
  });
}`,
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl rounded-2xl border border-zinc-700/80 bg-zinc-900/95 shadow-2xl shadow-blue-950/60 overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Zalo Brand Gradient */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/70 bg-gradient-to-r from-blue-950/80 via-zinc-900 to-zinc-900">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0068FF] text-white shadow-lg shadow-blue-500/40 shrink-0">
              <svg className="h-6 w-6 fill-current" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.08L2 22l5.12-1.35C8.55 21.49 10.23 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
                Xác thực &amp; Đăng nhập qua Zalo
                <span className="rounded-full bg-blue-500/20 border border-blue-400/40 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                  Realtime QR Gateway
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400">
                Quét mã QR bằng ứng dụng Zalo trên điện thoại để cấp quyền truy cập hệ thống AI_OPC.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-border/60 bg-zinc-950/60 px-5 text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setActiveTab("popup");
              if (qrStep === "idle" || qrStep === "error") {
                startLiveQrSession();
              }
            }}
            className={`flex items-center gap-1.5 border-b-2 py-2.5 px-3 transition-colors cursor-pointer ${activeTab === "popup"
                ? "border-blue-500 text-blue-400 font-semibold"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
          >
            <QrCode className="h-3.5 w-3.5" />
            <span>Quét Mã Trực Tiếp (In-App)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("apiGuide")}
            className={`flex items-center gap-1.5 border-b-2 py-2.5 px-3 transition-colors cursor-pointer ${activeTab === "apiGuide"
                ? "border-blue-500 text-blue-400 font-semibold"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>Hướng dẫn API &amp; Webhook</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("manual")}
            className={`flex items-center gap-1.5 border-b-2 py-2.5 px-3 transition-colors cursor-pointer ${activeTab === "manual"
                ? "border-blue-500 text-blue-400 font-semibold"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>Test Payload JSON</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-5 overflow-y-auto space-y-4">
          {activeTab === "popup" ? (
            <div className="space-y-4">
              {/* Success Banner */}
              {qrStep === "logged_in" ? (
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-4 text-emerald-300 animate-in zoom-in-95 duration-200 text-center space-y-2">
                  <div className="flex items-center justify-center gap-2 font-semibold text-emerald-400 text-sm">
                    <ShieldCheck className="h-6 w-6" />
                    <span>Xác thực Zalo thành công!</span>
                  </div>
                  <p className="text-xs text-emerald-300/90 leading-relaxed">
                    Đã nhận phiên từ UID <strong>{detectedUid}</strong>. Đang thiết lập phiên làm việc và chuyển hướng...
                  </p>
                  <div className="flex items-center justify-center gap-2 pt-1 text-xs text-emerald-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Đang hoàn tất đăng nhập...</span>
                  </div>
                </div>
              ) : (
                /* Interactive QR Scanner Card */
                <div className="flex flex-col items-center justify-center rounded-2xl border border-blue-500/30 bg-gradient-to-b from-blue-950/25 via-zinc-950/80 to-zinc-950/90 p-5 shadow-inner space-y-4">

                  {/* Status Indicator */}
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

                  {/* QR Image Container */}
                  <div className="relative flex items-center justify-center p-3 rounded-2xl bg-white shadow-2xl shadow-blue-500/10 min-h-[220px] min-w-[220px] border-4 border-zinc-800">
                    {qrImage && qrStep !== "qr_expired" && qrStep !== "init" ? (
                      <div className="relative group">
                        <img
                          src={qrImage}
                          alt="Mã QR Zalo"
                          className="h-48 w-48 rounded-lg object-contain"
                        />
                        {/* Radar scanning line effect */}
                        {qrStep === "waiting_scan" && (
                          <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-lg">
                            <div className="w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent shadow-lg shadow-blue-400 animate-bounce opacity-80" />
                          </div>
                        )}
                        {/* Scanned Overlay */}
                        {qrStep === "scanned" && (
                          <div className="absolute inset-0 bg-blue-950/85 backdrop-blur-xs rounded-lg flex flex-col items-center justify-center p-3 text-center text-white space-y-2 animate-in fade-in duration-150">
                            <Smartphone className="h-8 w-8 text-blue-400 animate-bounce" />
                            <p className="text-xs font-semibold text-blue-200">Đã nhận diện thiết bị!</p>
                            <p className="text-[10px] text-zinc-300">Vui lòng bấm &quot;Xác nhận đăng nhập&quot; trên điện thoại của bạn.</p>
                          </div>
                        )}
                      </div>
                    ) : qrStep === "qr_expired" ? (
                      <div className="flex flex-col items-center justify-center h-48 w-48 text-zinc-800 space-y-2 p-2 text-center">
                        <AlertCircle className="h-10 w-10 text-amber-500" />
                        <p className="text-xs font-semibold text-zinc-700">Mã QR đã hết hạn</p>
                        <button
                          type="button"
                          onClick={startLiveQrSession}
                          className="mt-1 flex items-center gap-1 rounded-lg bg-[#0068FF] px-3 py-1.5 text-[11px] font-semibold text-white shadow hover:bg-blue-600 transition-colors cursor-pointer"
                        >
                          <RefreshCw className="h-3 w-3" />
                          <span>Tạo mã mới</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-48 w-48 text-zinc-600 space-y-2">
                        <Loader2 className="h-8 w-8 animate-spin text-[#0068FF]" />
                        <p className="text-[11px] font-medium text-zinc-500">Đang tạo mã QR...</p>
                      </div>
                    )}
                  </div>

                  {/* Status text instruction */}
                  <p className="text-xs text-zinc-300 text-center max-w-sm leading-relaxed font-medium">
                    {qrStatusText}
                  </p>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 pt-1 w-full max-w-sm">
                    <button
                      type="button"
                      onClick={startLiveQrSession}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700/80 py-2.5 px-3 text-xs font-medium text-zinc-200 transition-colors cursor-pointer"
                    >
                      <RefreshCw className="h-3.5 w-3.5 text-zinc-400" />
                      <span>Làm mới mã QR</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleManualOpenPopup}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-blue-600/20 border border-blue-500/40 hover:bg-blue-600/30 py-2.5 px-3 text-xs font-semibold text-blue-300 transition-colors cursor-pointer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>Mở Popup riêng</span>
                    </button>
                  </div>

                  {errorMessage && (
                    <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 w-full">
                      <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                      <span>{errorMessage}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Endpoint Status Card */}
              <div className="rounded-xl border border-border/60 bg-zinc-950/40 p-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Globe className="h-4 w-4 text-blue-400" />
                  <span>Cổng Zalo Auth: <strong className="text-zinc-200 font-mono">Self-Hosted Portal (/zalo-portal)</strong></span>
                </div>
                <div className="flex items-center gap-2 text-zinc-400">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span>Trạng thái: <strong className="text-emerald-400 font-mono">Tích hợp sẵn</strong></span>
                </div>
              </div>
            </div>
          ) : activeTab === "apiGuide" ? (
            /* Tab 2: Hướng dẫn & Code API Tiếp Nhận */
            <div className="space-y-4">
              <div className="rounded-xl border border-blue-500/20 bg-blue-950/15 p-3.5 text-xs text-zinc-300 space-y-1.5">
                <p className="font-semibold text-blue-300 flex items-center gap-1.5">
                  <Code2 className="h-4 w-4 text-blue-400" />
                  Tích hợp Webhook tiếp nhận phiên Zalo
                </p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Zalo Auth Bridge phát dữ liệu phiên làm việc (cookie, imei, secretKey) tự động sang Webhook backend và đồng thời lưu trữ bền vững tại <code>data/zalo_session.json</code>.
                </p>
              </div>

              {/* Webhook URLs */}
              <div className="space-y-2.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-zinc-300 flex items-center justify-between">
                    <span>URL Webhook tiếp nhận:</span>
                    <span className="text-[10px] text-emerald-400 font-normal">200 OK • Đang hoạt động</span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value={webhookUrl}
                      className="w-full flex-1 rounded-lg border border-border/80 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none select-all"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(webhookUrl, "express_wh")}
                      className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors cursor-pointer shrink-0"
                    >
                      {copiedKey === "express_wh" ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Đã chép</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 text-zinc-400" />
                          <span>Sao chép</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="rounded-lg bg-zinc-950/60 border border-zinc-800 p-2.5 text-[11px] text-zinc-400 space-y-1">
                  <p className="text-zinc-300 font-medium">💡 Tham số truyền vào Popup Portal:</p>
                  <code className="text-[10px] text-blue-300 font-mono block break-all">
                    /zalo-portal?targetUrl={encodeURIComponent(webhookUrl)}&amp;autoStart=true
                  </code>
                </div>
              </div>

              {/* Code Snippet Switcher */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-border/60">
                    <button
                      type="button"
                      onClick={() => setCodeLang("nextjs")}
                      className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors cursor-pointer ${codeLang === "nextjs"
                          ? "bg-blue-600 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                        }`}
                    >
                      Next.js App Router
                    </button>
                    <button
                      type="button"
                      onClick={() => setCodeLang("express")}
                      className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors cursor-pointer ${codeLang === "express"
                          ? "bg-blue-600 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                        }`}
                    >
                      Node.js / Express
                    </button>
                    <button
                      type="button"
                      onClick={() => setCodeLang("popupJs")}
                      className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors cursor-pointer ${codeLang === "popupJs"
                          ? "bg-blue-600 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                        }`}
                    >
                      Client Popup JS
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => copyToClipboard(codeSnippets[codeLang], "snippet")}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  >
                    {copiedKey === "snippet" ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">Đã chép code</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Chép code mẫu</span>
                      </>
                    )}
                  </button>
                </div>

                <pre className="p-3.5 rounded-xl bg-zinc-950 border border-border/70 text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-52 leading-relaxed">
                  {codeSnippets[codeLang]}
                </pre>
              </div>
            </div>
          ) : (
            /* Tab 3: Test Payload JSON Thủ Công */
            <div className="space-y-3">
              <div className="rounded-xl border border-border/80 bg-zinc-950 p-3 text-xs text-zinc-300 space-y-1">
                <p className="font-semibold text-zinc-200">🛠️ Kiểm thử trực tiếp với JSON Payload:</p>
                <p className="text-[11px] text-zinc-400">
                  Dán payload chứa <code>uid</code>, <code>imei</code> và <code>cookie</code> để mô phỏng sự kiện xác thực từ Zalo Gateway.
                </p>
              </div>

              <textarea
                rows={9}
                value={manualJson}
                onChange={(e) => setManualJson(e.target.value)}
                className="w-full rounded-xl border border-border/80 bg-zinc-950 p-3 text-xs font-mono text-zinc-200 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 leading-relaxed select-all"
              />

              {manualError && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-300">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                  <span>{manualError}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleManualLogin}
                disabled={manualLoading}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#0068FF] hover:bg-blue-600 py-2.5 px-4 text-xs font-semibold text-white shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                {manualLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Terminal className="h-4 w-4" />
                )}
                <span>Kích hoạt phiên thủ công</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
