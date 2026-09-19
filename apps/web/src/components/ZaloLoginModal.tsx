"use client";

import { useState, useEffect, useRef } from "react";
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
} from "lucide-react";
import { checkZaloAuthSession, loginWithZaloManual, setToken, fetchZaloStatus } from "@/lib/api";

interface ZaloLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (token: string) => void;
  autoOpenPopup?: boolean;
  initialTab?: "popup" | "apiGuide" | "manual";
}

const SAMPLE_PAYLOAD = {
  event: "ZALO_AUTH_SUCCESS",
  timestamp: new Date().toISOString(),
  userId: "637619582990873903",
  context: {
    uid: "637619582990873903",
    imei: "23ce4d45-9169-475c-976b-64d1a6f9eef9-a69b52f9d7f760edf3fd052bcda2542f",
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
 * Hàm mở Popup xác thực Zalo chuẩn theo mục 2 trong Zalo_guide.md:
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

  const portalBase = options?.zaloPortalUrl || `http://${hostname}:3001`;
  const zaloAuthUrl = `${portalBase}/?targetUrl=${targetWebhook}&customParams=${customParams}&autoStart=true`;

  const width = 540;
  const height = 720;
  const left = (window.innerWidth - width) / 2 + window.screenX;
  const top = (window.innerHeight - height) / 2 + window.screenY;

  const popup = window.open(
    zaloAuthUrl,
    "ZaloAuthPopup",
    `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes`
  );

  // Lắng nghe tín hiệu postMessage từ Zalo Auth Portal theo Zalo_guide.md dòng 68-76
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

export function ZaloLoginModal({ isOpen, onClose, onSuccess, autoOpenPopup, initialTab = "apiGuide" }: ZaloLoginModalProps) {
  const [activeTab, setActiveTab] = useState<"popup" | "apiGuide" | "manual">(initialTab);
  const [codeLang, setCodeLang] = useState<"express" | "nextjs" | "popupJs">("nextjs");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("http://localhost:8000/api/zalo/webhook");
  const [nextWebhookUrl, setNextWebhookUrl] = useState("http://localhost:3000/api/zalo/webhook");
  const [zaloPortalUrl, setZaloPortalUrl] = useState("http://localhost:3001");
  const [pollingStatus, setPollingStatus] = useState<"listening" | "success" | "idle">("listening");
  const [detectedUid, setDetectedUid] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);
  const [existingStatus, setExistingStatus] = useState<{ connected: boolean; uid: string | null } | null>(null);
  const [manualJson, setManualJson] = useState(JSON.stringify(SAMPLE_PAYLOAD, null, 2));
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState("");
  const [popupOpened, setPopupOpened] = useState(false);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Cập nhật webhook URL chuẩn dựa trên hostname hiện tại
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hostname = window.location.hostname || "localhost";
      const apiBase = process.env.NEXT_PUBLIC_API_URL || `http://${hostname}:8000`;
      setWebhookUrl(`${apiBase}/api/zalo/webhook`);
      setNextWebhookUrl(`${window.location.origin}/api/zalo/webhook`);
      setZaloPortalUrl(`http://${hostname}:3001`);
    }
    // Lấy thông tin phiên hiện có (nếu có)
    fetchZaloStatus()
      .then((st) => {
        if (st.connected) {
          setExistingStatus({ connected: true, uid: st.uid });
        }
      })
      .catch(() => {});
  }, []);

  // 2. Tự động mở Popup khi modal hiển thị (nếu autoOpenPopup được bật)
  useEffect(() => {
    if (isOpen && autoOpenPopup && !popupOpened) {
      const p = openZaloAuthPopup({
        targetWebhookUrl: webhookUrl,
        zaloPortalUrl,
        onAuthSuccess: handleZaloSuccessSignal,
      });
      if (p) setPopupOpened(true);
    }
  }, [isOpen, autoOpenPopup, popupOpened, webhookUrl, zaloPortalUrl]);

  // 3. Xử lý tín hiệu thành công
  const handleZaloSuccessSignal = (payload: any) => {
    const uid = payload?.userId || payload?.context?.uid || "Zalo User";
    setDetectedUid(uid);
    setPollingStatus("success");

    // Kiểm tra token từ backend
    checkZaloAuthSession()
      .then((res) => {
        if (res.authenticated && res.token) {
          setToken(res.token);
          setTimeout(() => {
            onSuccess(res.token!);
          }, 800);
        }
      })
      .catch(() => {});
  };

  // 4. Lắng nghe thông điệp postMessage từ Popup theo Zalo_guide.md
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
  }, [isOpen]);

  // 5. Polling song song từ Backend để nhận phiên tự động khi Webhook kích hoạt
  useEffect(() => {
    if (!isOpen || pollingStatus === "success") {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }

    setPollingStatus("listening");

    async function poll() {
      try {
        const res = await checkZaloAuthSession();
        if (res.authenticated && res.token) {
          setPollingStatus("success");
          setDetectedUid(res.userId || "Zalo User");
          setToken(res.token);
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setTimeout(() => {
            onSuccess(res.token!);
          }, 800);
        }
      } catch {
        // Tiếp tục polling
      }
    }

    poll();
    pollTimerRef.current = setInterval(poll, 1200);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [isOpen, pollingStatus, onSuccess]);

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
      setPollingStatus("success");
      setDetectedUid(res.userId || "Zalo User");
      setToken(res.token);
      setTimeout(() => {
        onSuccess(res.token);
      }, 800);
    } catch (err: any) {
      setManualError(err.message || "Xác thực phiên Zalo thất bại.");
    } finally {
      setManualLoading(false);
    }
  };

  const codeSnippets = {
    nextjs: `// Next.js App Router: app/api/zalo-auth/route.ts (Zalo_guide.md dòng 104)
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json();
  const { event, userId, context, customParams } = body;

  console.log("[Next.js Zalo Webhook] Nhận context Zalo:", userId, context?.imei);

  // Lưu context vào Database / chuyển tiếp sang Backend API
  return NextResponse.json({ success: true, received: true });
}`,
    express: `// Node.js / Express: app.post('/api/zalo/webhook') (Zalo_guide.md dòng 83)
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
    popupJs: `// Giao diện gọi Popup chuẩn (Zalo_guide.md dòng 44)
function openZaloAuthPopup() {
  const targetWebhook = encodeURIComponent('http://localhost:8000/api/zalo/webhook');
  const customParams = encodeURIComponent(JSON.stringify({
    currentUserId: "founder",
    tenantId: "ai_opc_corp"
  }));
  const zaloAuthUrl = \`http://localhost:3001/?targetUrl=\${targetWebhook}&customParams=\${customParams}&autoStart=true\`;

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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl rounded-2xl border border-zinc-700/80 bg-zinc-900/95 shadow-2xl shadow-blue-950/60 overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Zalo Brand Gradient */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/70 bg-gradient-to-r from-blue-950/70 via-zinc-900 to-zinc-900">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0068FF] text-white shadow-lg shadow-blue-500/40">
              <svg className="h-6 w-6 fill-current" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.08L2 22l5.12-1.35C8.55 21.49 10.23 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
                Xác thực &amp; Đăng nhập qua Zalo
                <span className="rounded bg-blue-500/15 border border-blue-500/30 px-1.5 py-0.2 text-[10px] font-medium text-blue-400">
                  Zalo Auth
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400">
                Tuân thủ mục 2 &quot;Cách viết API ở ứng dụng đích để tiếp nhận&quot; trong Zalo_guide.md
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
            onClick={() => setActiveTab("popup")}
            className={`flex items-center gap-1.5 border-b-2 py-2.5 px-3 transition-colors cursor-pointer ${
              activeTab === "popup"
                ? "border-blue-500 text-blue-400 font-semibold"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <QrCode className="h-3.5 w-3.5" />
            <span>Popup Quét Mã (Khuyên dùng)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("apiGuide")}
            className={`flex items-center gap-1.5 border-b-2 py-2.5 px-3 transition-colors cursor-pointer ${
              activeTab === "apiGuide"
                ? "border-blue-500 text-blue-400 font-semibold"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>Hướng dẫn &amp; Code API Tiếp nhận</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("manual")}
            className={`flex items-center gap-1.5 border-b-2 py-2.5 px-3 transition-colors cursor-pointer ${
              activeTab === "manual"
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
              {/* Status Banner */}
              {pollingStatus === "success" ? (
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-4 text-emerald-300 animate-in zoom-in-95 duration-200">
                  <div className="flex items-center gap-2 font-semibold">
                    <ShieldCheck className="h-5 w-5 text-emerald-400" />
                    <span>Xác thực Zalo thành công!</span>
                  </div>
                  <p className="mt-1 text-xs text-emerald-400/90 leading-relaxed">
                    Đã nhận phiên từ UID <strong>{detectedUid}</strong>. Đang tự động chuyển hướng vào Founder Cockpit...
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-blue-500/30 bg-blue-950/20 p-3.5">
                  <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 shrink-0">
                    <span className="absolute h-full w-full animate-ping rounded-lg bg-blue-400/20" />
                    <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-blue-300">
                        Đang lắng nghe tín hiệu quét mã QR từ Zalo...
                      </p>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.2 text-[10px] text-emerald-400">
                        <Radio className="h-2.5 w-2.5 animate-pulse" /> Live Polling
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Cửa sổ Popup xác thực đang mở. Quét mã QR bằng ứng dụng Zalo trên điện thoại.
                    </p>
                  </div>
                </div>
              )}

              {/* Main Popup Action Card */}
              <div className="rounded-xl border border-zinc-700/60 bg-zinc-950/60 p-4 space-y-3">
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <Smartphone className="h-4 w-4 text-blue-400" />
                    Quy trình 3 bước xác thực theo Zalo_guide.md:
                  </h4>
                  <ul className="text-[11px] text-zinc-400 space-y-1.5 pl-5 list-decimal leading-relaxed">
                    <li>
                      Bấm nút bên dưới để mở cửa sổ <strong>Zalo Auth Popup (540x720)</strong> căn giữa màn hình.
                    </li>
                    <li>
                      Mở app Zalo trên điện thoại $\rightarrow$ Chọn biểu tượng <strong>Quét mã QR</strong>.
                    </li>
                    <li>
                      Bấm <strong>Xác nhận</strong> trên điện thoại. Hệ thống tự động nhận Webhook và đăng nhập tức thì!
                    </li>
                  </ul>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleManualOpenPopup}
                    className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-[#0068FF] hover:bg-[#0057d6] py-3 px-4 text-xs font-semibold text-white shadow-lg shadow-blue-500/25 transition-all cursor-pointer hover:scale-[1.01]"
                  >
                    <ExternalLink className="h-4 w-4" />
                    <span>Mở Cửa Sổ Xác Thực Zalo (Popup 540x720)</span>
                  </button>
                </div>
              </div>

              {/* Endpoint Status Card */}
              <div className="rounded-xl border border-border/60 bg-zinc-950/40 p-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Globe className="h-4 w-4 text-zinc-500" />
                  <span>Cổng Zalo Auth: <strong className="text-zinc-200 font-mono">http://localhost:3001</strong></span>
                </div>
                <div className="flex items-center gap-2 text-zinc-400">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span>Webhook API: <strong className="text-zinc-200 font-mono">/api/zalo/webhook</strong></span>
                </div>
              </div>

              {/* Help tip */}
              <p className="text-[11px] text-zinc-500 text-center leading-relaxed">
                Nếu trình duyệt đang chặn cửa sổ bật lên (Popup Blocker), hãy chọn <strong>Cho phép popup</strong> cho trang này và bấm lại nút trên.
              </p>
            </div>
          ) : activeTab === "apiGuide" ? (
            /* Tab 2: Hướng dẫn & Code API Tiếp Nhận theo Zalo_guide.md */
            <div className="space-y-4">
              <div className="rounded-xl border border-blue-500/20 bg-blue-950/15 p-3.5 text-xs text-zinc-300 space-y-1.5">
                <p className="font-semibold text-blue-300 flex items-center gap-1.5">
                  <Code2 className="h-4 w-4 text-blue-400" />
                  Mục 2: Cách viết API ở ứng dụng đích để tiếp nhận
                </p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Zalo Auth Portal gửi HTTP POST webhook chứa cookie và imei tới địa chỉ URL bạn cấu hình. Cả Backend Express và Next.js App Router đều đã được thiết lập sẵn sàng:
                </p>
              </div>

              {/* Webhook URLs */}
              <div className="space-y-2.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-zinc-300 flex items-center justify-between">
                    <span>URL Webhook tiếp nhận (Khuyên dùng trong targetUrl):</span>
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
                  <p className="text-zinc-300 font-medium">💡 Tham số truyền vào Popup:</p>
                  <code className="text-[10px] text-blue-300 font-mono block break-all">
                    http://localhost:3001/?targetUrl={encodeURIComponent(webhookUrl)}&amp;autoStart=true
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
                      className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors cursor-pointer ${
                        codeLang === "nextjs"
                          ? "bg-blue-600 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Next.js App Router
                    </button>
                    <button
                      type="button"
                      onClick={() => setCodeLang("express")}
                      className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors cursor-pointer ${
                        codeLang === "express"
                          ? "bg-blue-600 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Node.js / Express
                    </button>
                    <button
                      type="button"
                      onClick={() => setCodeLang("popupJs")}
                      className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors cursor-pointer ${
                        codeLang === "popupJs"
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
                    className="text-[11px] text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedKey === "snippet" ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Đã chép code</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Sao chép code</span>
                      </>
                    )}
                  </button>
                </div>

                <pre className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-48 leading-relaxed">
                  {codeSnippets[codeLang]}
                </pre>
              </div>

              {/* Direct Open Portal Button */}
              <a
                href={`${zaloPortalUrl}/?targetUrl=${encodeURIComponent(webhookUrl)}&autoStart=true`}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 text-zinc-200 py-2.5 px-4 text-xs font-semibold transition-all cursor-pointer border border-zinc-700"
              >
                <ExternalLink className="h-4 w-4 text-blue-400" />
                <span>Mở Zalo Auth Portal trực tiếp trong Tab mới</span>
              </a>
            </div>
          ) : (
            /* Tab 3: Manual JSON */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-300">
                  Dán Payload Webhook từ Zalo Auth:
                </label>
                <button
                  type="button"
                  onClick={() => setManualJson(JSON.stringify(SAMPLE_PAYLOAD, null, 2))}
                  className="text-[11px] text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Tải mẫu test chuẩn</span>
                </button>
              </div>

              <textarea
                rows={9}
                value={manualJson}
                onChange={(e) => setManualJson(e.target.value)}
                className="w-full rounded-xl border border-border/80 bg-zinc-950 p-3 text-xs font-mono text-zinc-200 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 leading-relaxed"
                placeholder="Dán JSON payload chứa ZALO_AUTH_SUCCESS..."
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
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#0068FF] hover:bg-[#0057d6] py-2.5 px-4 text-xs font-semibold text-white transition-all disabled:opacity-50 cursor-pointer shadow-md"
              >
                {manualLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Đang kích hoạt phiên...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Xác nhận &amp; Đăng nhập ngay</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border/60 bg-zinc-950/60 text-[11px] text-zinc-500">
          <span>
            {existingStatus?.connected
              ? `Phiên Zalo hiện tại: UID ${existingStatus.uid} (Đang kết nối)`
              : "Khóa phiên Zalo được mã hóa & lưu an toàn cho AI Agents"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="hover:text-zinc-300 transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
