"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ShieldAlert,
  DollarSign,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Building2,
  Bell,
  Send,
  Loader2,
  MessageSquare,
  Mail,
  Check,
  X,
  Scale,
  Ban,
  FileText,
  Power,
  SlidersHorizontal,
  Eye,
  EyeOff,
  CheckCheck,
  Save,
  Radio,
  ExternalLink,
  Cpu,
  Bot,
  Server,
  Key,
  Globe,
  Activity as ActivityIcon,
  Play,
  Terminal,
} from "lucide-react";
import {
  fetchCompanySettings,
  updateCompanySettings,
  resetCompanyCost,
  fetchAgents,
  fetchNotificationStatus,
  fetchNotificationPreferences,
  updateNotificationPreferences,
  sendTestNotification,
  fetchLlmSettings,
  updateLlmSettings,
  testLlmConnection,
  type LlmSettingsData,
} from "@/lib/api";
import { openZaloAuthPopup, ZaloLoginModal } from "@/components/ZaloLoginModal";
import type { Agent, NotificationPreferences } from "@ai-opc/shared";
import { useI18n } from "@/context/I18nContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface NotificationStatus {
  telegram: boolean;
  email: boolean;
  zalo?: boolean;
  zaloDetails?: {
    sessionConnected: boolean;
    uid: string | null;
    configured: boolean;
    defaultPhone: string;
    defaultGroupId: string;
  };
  channelsHealth?: {
    telegram: { inCooldown: boolean; failures: number; lastSuccess: number | null };
    zalo: { inCooldown: boolean; failures: number; lastSuccess: number | null };
    email: { inCooldown: boolean; failures: number; lastSuccess: number | null };
  };
  anyConfigured: boolean;
}

const DEFAULT_PREFS: NotificationPreferences = {
  sendToTelegram: true,
  sendToEmail: true,
  sendToZalo: true,
  notifyBudgetCapExceeded: true,
  notifyDecisionRequired: true,
  notifyBlockedTasks: true,
  notifyWeeklyReport: true,
  notifyEmergencyStop: true,
  customTelegramChatId: "",
  customEmailRecipient: "",
  customZaloPhone: "",
  customZaloGroupId: "",
};

export default function SettingsPage() {
  const { t, locale } = useI18n();
  const [capInput, setCapInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);

  // LLM / AI Gateway State
  const [llmProvider, setLlmProvider] = useState<"gemini" | "openai" | "anthropic" | "custom" | "auto">("auto");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [customLlmUrl, setCustomLlmUrl] = useState("");
  const [customLlmApiKey, setCustomLlmApiKey] = useState("");
  const [orchestratorModel, setOrchestratorModel] = useState("");
  const [temperature, setTemperature] = useState(0.2);
  const [llmStatusDesc, setLlmStatusDesc] = useState("");
  const [llmMasked, setLlmMasked] = useState<{
    gemini: string | null;
    openai: string | null;
    anthropic: string | null;
    custom: string | null;
  }>({ gemini: null, openai: null, anthropic: null, custom: null });
  const [showLlmKeys, setShowLlmKeys] = useState<Record<string, boolean>>({});
  const [savingLlm, setSavingLlm] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [llmMessage, setLlmMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs: number;
    provider?: string;
    modelUsed?: string;
    reply?: string;
    tokensUsed?: number;
    costUsd?: number;
    error?: string;
  } | null>(null);

  // Notification State
  const [notifStatus, setNotifStatus] = useState<NotificationStatus | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFS);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [testingNotif, setTestingNotif] = useState(false);
  const [notifMessage, setNotifMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState<Record<string, boolean>>({
    BUDGET_CAP: true,
    DECISION: false,
    BLOCKED_TASK: false,
    WEEKLY_REPORT: false,
    EMERGENCY_STOP: false,
  });
  const [selectedTestEvent, setSelectedTestEvent] = useState<string>("BUDGET_CAP");
  const [isZaloModalOpen, setIsZaloModalOpen] = useState(false);

  async function refresh() {
    try {
      const [s, a, n, p, llm] = await Promise.all([
        fetchCompanySettings(),
        fetchAgents(),
        fetchNotificationStatus().catch(() => null),
        fetchNotificationPreferences().catch(() => null),
        fetchLlmSettings().catch(() => null),
      ]);
      setCapInput(s.monthlyBudgetCapUsd != null ? String(s.monthlyBudgetCapUsd) : "");
      setAgents(a || []);
      if (n) setNotifStatus(n as NotificationStatus);
      if (p) setPrefs((prev) => ({ ...prev, ...p }));
      if (llm) {
        setLlmProvider(llm.llmProvider || "auto");
        setCustomLlmUrl(llm.customLlmUrl || "");
        setOrchestratorModel(llm.orchestratorModel || "");
        setTemperature(llm.temperature ?? 0.2);
        setLlmStatusDesc(llm.statusDescription || "");
        setLlmMasked({
          gemini: llm.geminiApiKeyMasked,
          openai: llm.openaiApiKeyMasked,
          anthropic: llm.anthropicApiKeyMasked,
          custom: llm.customLlmApiKeyMasked,
        });
      }
      setLoaded(true);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Lỗi tải cài đặt" });
      setLoaded(true);
    }
  }

  useEffect(() => {
    refresh();

    // Lắng nghe tín hiệu postMessage ZALO_AUTH_SUCCESS từ Popup theo Zalo_guide.md
    function handleMessage(event: MessageEvent) {
      if (
        event.data &&
        (event.data.type === "ZALO_AUTH_SUCCESS" || event.data.event === "ZALO_AUTH_SUCCESS")
      ) {
        console.log("[Settings] Nhận ZALO_AUTH_SUCCESS từ popup:", event.data);
        const uid = event.data.userId || event.data.payload?.userId || "Zalo User";
        setNotifMessage({
          type: "success",
          text: `Liên kết tài khoản Zalo thành công! Phiên UID: ${uid} đã sẵn sàng nhận thông báo.`,
        });
        refresh();
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const totalSpentUsd = agents.reduce((sum, a) => sum + Number(a.monthlyCostUsd || 0), 0);
  const suspendedAgents = agents.filter((a) => a.status === "SUSPENDED");
  const budgetCapNumber = capInput.trim() === "" ? null : Number(capInput);
  const percentUsed =
    budgetCapNumber && budgetCapNumber > 0
      ? Math.min(100, Math.round((totalSpentUsd / budgetCapNumber) * 100))
      : null;

  async function handleSaveBudget(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const value = capInput.trim() === "" ? null : Number(capInput);
      await updateCompanySettings(value);
      setMessage({ type: "success", text: "Đã cập nhật trần ngân sách toàn công ty thành công." });
      await refresh();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Lỗi khi lưu trần ngân sách" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveLlm(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSavingLlm(true);
    setLlmMessage(null);
    try {
      await updateLlmSettings({
        llmProvider: llmProvider === "auto" ? null : llmProvider,
        orchestratorModel: orchestratorModel.trim() || null,
        customLlmUrl: customLlmUrl.trim() || null,
        temperature,
        geminiApiKey: geminiApiKey.trim() || undefined,
        openaiApiKey: openaiApiKey.trim() || undefined,
        anthropicApiKey: anthropicApiKey.trim() || undefined,
        customLlmApiKey: customLlmApiKey.trim() || undefined,
      });
      setLlmMessage({ type: "success", text: "Đã lưu cấu hình AI Agent Input thành công!" });
      setGeminiApiKey("");
      setOpenaiApiKey("");
      setAnthropicApiKey("");
      setCustomLlmApiKey("");
      await refresh();
    } catch (err: any) {
      setLlmMessage({ type: "error", text: err.message || "Lỗi lưu cấu hình AI" });
    } finally {
      setSavingLlm(false);
    }
  }

  async function handleTestLlm() {
    setTestingLlm(true);
    setTestResult(null);
    setLlmMessage(null);
    try {
      let activeKey = "";
      if (llmProvider === "gemini") activeKey = geminiApiKey;
      else if (llmProvider === "openai") activeKey = openaiApiKey;
      else if (llmProvider === "anthropic") activeKey = anthropicApiKey;

      const res = await testLlmConnection({
        provider: llmProvider === "auto" ? undefined : llmProvider,
        model: orchestratorModel.trim() || undefined,
        apiKey: activeKey.trim() || undefined,
        customLlmUrl: customLlmUrl.trim() || undefined,
        customLlmApiKey: customLlmApiKey.trim() || undefined,
        temperature,
      });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        latencyMs: 0,
        error: err.message || "Kiểm tra kết nối thất bại",
      });
    } finally {
      setTestingLlm(false);
    }
  }

  async function handleResetCompanyCost() {
    if (
      !window.confirm(
        "Xác nhận Reset chi phí TOÀN BỘ agent về $0 và tự động mở lại các agent đang bị khoá do vượt ngân sách?"
      )
    )
      return;
    setResetting(true);
    setMessage(null);
    try {
      const result = await resetCompanyCost();
      setMessage({
        type: "success",
        text: `Đã reset chi phí ${result.agentCount} agent, tự động mở lại ${result.unsuspendedCount} agent bị khoá do ngân sách.`,
      });
      await refresh();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Lỗi khi reset chi phí" });
    } finally {
      setResetting(false);
    }
  }

  async function handleSavePreferences(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSavingPrefs(true);
    setNotifMessage(null);
    try {
      await updateNotificationPreferences(prefs);
      setNotifMessage({
        type: "success",
        text: "Đã lưu cấu hình bộ lọc sự kiện và kênh thông báo của Founder.",
      });
    } catch (err: any) {
      setNotifMessage({
        type: "error",
        text: err.message || "Lỗi khi lưu cấu hình thông báo.",
      });
    } finally {
      setSavingPrefs(false);
    }
  }

  function toggleAllEvents(enabled: boolean) {
    setPrefs((prev) => ({
      ...prev,
      notifyBudgetCapExceeded: enabled,
      notifyDecisionRequired: enabled,
      notifyBlockedTasks: enabled,
      notifyWeeklyReport: enabled,
      notifyEmergencyStop: enabled,
    }));
  }

  const sampleMessages: Record<
    string,
    { title: string; preview: string; rawText: string; severity: string; badge: string; badgeColor: string }
  > = {
    BUDGET_CAP: {
      title: "Vượt trần ngân sách AI (Budget Cap)",
      badge: "Cực kỳ quan trọng",
      badgeColor: "border-rose-500/30 bg-rose-500/10 text-rose-400",
      severity: "warning",
      preview: "Agent \"ai_analyst\" vượt trần ngân sách riêng ($9.00 / $0.01) — tự động SUSPENDED. Founder vào trang chi tiết Agent để tăng trần hoặc reset chi phí.",
      rawText: "🚨 *BUDGET CAP EXCEEDED*\n\nAgent \"ai_analyst\" vượt trần ngân sách riêng ($9.00 / $0.01) — tự động SUSPENDED.\n\nFounder vào trang chi tiết Agent để tăng trần hoặc reset chi phí.",
    },
    DECISION: {
      title: "Quyết định rủi ro cao (Decision Package R3/R4)",
      badge: "Cần phê duyệt",
      badgeColor: "border-amber-500/30 bg-amber-500/10 text-amber-400",
      severity: "warning",
      preview: "Agent \"ai_finance\" yêu cầu chạy tool \"execute_payment\". Risk: R3.\n\nVào Web app (cột \"Chờ phê duyệt\") để duyệt hoặc từ chối.",
      rawText: "⚠️ *Cần duyệt: execute_payment (R3)*\n\nAgent \"ai_finance\" yêu cầu chạy tool \"execute_payment\".\nRisk: R3\n\nVào Web app (cột \"Chờ phê duyệt\") để duyệt hoặc từ chối.",
    },
    BLOCKED_TASK: {
      title: "Task bị Blocked quá lâu (Stuck Tasks)",
      badge: "Cảnh báo trễ hạn",
      badgeColor: "border-orange-500/30 bg-orange-500/10 text-orange-400",
      severity: "warning",
      preview: "\"Triển khai chiến dịch marketing Q3\"\n\nAgent phụ trách: ai_marketer (Blocked > 60 phút)",
      rawText: "⚠️ *Task bị Blocked quá 60 phút*\n\n\"Triển khai chiến dịch marketing Q3\"\n\nAgent phụ trách: ai_marketer",
    },
    WEEKLY_REPORT: {
      title: "Báo cáo tổng kết tuần (Weekly Executive Digest)",
      badge: "Định kỳ thứ 2",
      badgeColor: "border-sky-500/30 bg-sky-500/10 text-sky-400",
      severity: "info",
      preview: "Tuần 2026-W38 — Đã hoàn thành 18 tasks, 2 Decision Packages đã duyệt. Tổng chi phí: $5.23 / $50.00.",
      rawText: "ℹ️ *Weekly Report sẵn sàng*\n\n=== AI-OPC WEEKLY REPORT (Tuần 2026-W38) ===\n• Tasks hoàn thành: 18\n• Decision Packages: 2 đã duyệt\n• Chi phí tiêu thụ: $5.23 / $50.00 trần\n• Agent trạng thái: 6 Ready, 0 Suspended",
    },
    EMERGENCY_STOP: {
      title: "Dừng khẩn cấp toàn hệ thống (/stop Killswitch)",
      badge: "Khẩn cấp hệ thống",
      badgeColor: "border-rose-500/30 bg-rose-500/10 text-rose-400",
      severity: "critical",
      preview: "Founder vừa gọi /stop — toàn bộ Agent đang hoạt động đã chuyển sang SUSPENDED ngay lập tức.",
      rawText: "🚨 *Emergency Stop đã kích hoạt*\n\nFounder vừa gọi /stop — toàn bộ Agent đang hoạt động đã chuyển sang SUSPENDED.",
    },
  };

  async function handleTestNotification() {
    setTestingNotif(true);
    setNotifMessage(null);
    try {
      const sample = sampleMessages[selectedTestEvent] || sampleMessages.BUDGET_CAP;
      const res = await sendTestNotification({
        category: selectedTestEvent,
        title: sample.title,
        message: sample.preview,
        severity: sample.severity,
      });
      const channelName = res?.deliveredChannel || "Kênh tiếp nhận";
      setNotifMessage({
        type: "success",
        text: `Đã gửi tin thử nghiệm [${sample.title}] thành công qua ${channelName}! (Hệ thống điều phối tuần tự failover 10s).`,
      });
    } catch (err: any) {
      setNotifMessage({
        type: "error",
        text: err.message || "Gửi thông báo thử nghiệm thất bại sau khi thử các kênh.",
      });
    } finally {
      setTestingNotif(false);
    }
  }

  function togglePreview(key: string) {
    setPreviewOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 pb-16">
      {/* Top navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" /> {t.settings.backLink}
        </Link>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
            <Sparkles className="h-3.5 w-3.5" /> Company Governance &amp; Controls
          </span>
          <LanguageSwitcher />
        </div>
      </div>

      {/* Header Banner */}
      <div className="rounded-2xl border border-border/80 bg-panel/90 p-6 backdrop-blur-sm shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-inner">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-zinc-100">{t.settings.title}</h1>
                <p className="text-xs text-zinc-400">
                  {locale === "vi" ? "Kiểm soát chi tiêu AI toàn diện & Đẩy thông báo có chọn lọc ra Telegram / Email khi phát sinh sự kiện trọng yếu" : "Comprehensive AI spending control & real-time alerts dispatched via Telegram / Email on key events"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Global Stats Overview */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border/60 bg-canvas/60 p-4 transition-colors hover:border-border">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-emerald-400" /> Tổng chi phí đã dùng
              </span>
              <span className="font-mono text-[11px] text-zinc-500">{agents.length} agents</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-zinc-100">${totalSpentUsd.toFixed(4)}</p>
            {percentUsed !== null && (
              <div className="mt-2 space-y-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${percentUsed >= 100 ? "bg-rose-500" : percentUsed >= 80 ? "bg-amber-500" : "bg-emerald-500"
                      }`}
                    style={{ width: `${percentUsed}%` }}
                  />
                </div>
                <p className="text-right text-[10px] text-zinc-500">Đã dùng {percentUsed}% trần công ty</p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border/60 bg-canvas/60 p-4 transition-colors hover:border-border">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Building2 className="h-3.5 w-3.5 text-cyan-400" /> Trần ngân sách công ty
            </div>
            <p className="mt-2 text-2xl font-bold text-zinc-100">
              {budgetCapNumber != null ? `$${budgetCapNumber.toFixed(2)}` : "Không giới hạn"}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">Áp dụng cho toàn bộ hoạt động AI</p>
          </div>

          <div className="rounded-xl border border-border/60 bg-canvas/60 p-4 transition-colors hover:border-border">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Trạng thái khoá Agent
            </div>
            <p className="mt-2 text-2xl font-bold text-zinc-100">
              {suspendedAgents.length}{" "}
              <span className="text-xs font-normal text-zinc-400">/ {agents.length} agent tạm dừng</span>
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              {suspendedAgents.length > 0 ? "Cần tăng trần hoặc reset" : "Hoạt động bình thường"}
            </p>
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`flex items-center gap-2.5 rounded-xl border p-4 text-sm ${message.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
            }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Founder Notification System Configuration */}
      <div className="space-y-6 rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl">
        {/* Section Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
          <div className="space-y-0.5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
              <Bell className="h-4 w-4 text-accent" /> Kênh báo &amp; Bộ lọc thông báo Founder
            </h2>
            <p className="text-xs text-zinc-400">
              Tùy chọn nhận thông báo qua Telegram / Email theo từng danh mục sự kiện cụ thể kèm xem trước nội dung mẫu.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSavePreferences}
              disabled={savingPrefs}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-50"
            >
              {savingPrefs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span>{savingPrefs ? "Đang lưu..." : "Lưu cấu hình"}</span>
            </button>
          </div>
        </div>

        {/* Channels Control Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
              1. Kênh tiếp nhận thông báo
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Telegram Card */}
            <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-zinc-200">Telegram Bot</p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${notifStatus?.channelsHealth?.telegram?.inCooldown
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                            : notifStatus?.telegram
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-zinc-800 text-zinc-500 border-zinc-700"
                          }`}
                      >
                        {notifStatus?.channelsHealth?.telegram?.inCooldown
                          ? "Mạng chập chờn — Tự động Failover"
                          : notifStatus?.telegram
                            ? "Đã kết nối"
                            : "Chưa cấu hình .env"}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">Khuyên dùng — tức thì, 0 độ trễ</p>
                  </div>
                </div>

                {/* Switch Toggle */}
                <button
                  type="button"
                  onClick={() => setPrefs((p) => ({ ...p, sendToTelegram: !p.sendToTelegram }))}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.sendToTelegram ? "bg-accent" : "bg-zinc-800"
                    }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.sendToTelegram ? "translate-x-5" : "translate-x-0"
                      }`}
                  />
                </button>
              </div>

              {/* Optional Custom Telegram Chat ID */}
              <div className="mt-3 border-t border-border/40 pt-2.5">
                <label className="text-[11px] text-zinc-400 block mb-1">
                  Telegram Chat ID nhận tin (mặc định lấy từ <code>.env</code>):
                </label>
                <input
                  type="text"
                  placeholder="Để trống để dùng Chat ID mặc định"
                  value={prefs.customTelegramChatId || ""}
                  onChange={(e) => setPrefs((p) => ({ ...p, customTelegramChatId: e.target.value }))}
                  className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* Email Card */}
            <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-zinc-200">Email (SMTP)</p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${notifStatus?.email
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-zinc-800 text-zinc-500 border-zinc-700"
                          }`}
                      >
                        {notifStatus?.email ? "Đã kết nối" : "Chưa cấu hình .env"}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">Gmail App Password, SMTP Relay</p>
                  </div>
                </div>

                {/* Switch Toggle */}
                <button
                  type="button"
                  onClick={() => setPrefs((p) => ({ ...p, sendToEmail: !p.sendToEmail }))}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.sendToEmail ? "bg-accent" : "bg-zinc-800"
                    }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.sendToEmail ? "translate-x-5" : "translate-x-0"
                      }`}
                  />
                </button>
              </div>

              {/* Optional Custom Email */}
              <div className="mt-3 border-t border-border/40 pt-2.5">
                <label className="text-[11px] text-zinc-400 block mb-1">
                  Email Founder nhận tin (mặc định lấy từ <code>.env</code>):
                </label>
                <input
                  type="email"
                  placeholder="founder@company.com"
                  value={prefs.customEmailRecipient || ""}
                  onChange={(e) => setPrefs((p) => ({ ...p, customEmailRecipient: e.target.value }))}
                  className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* Zalo Auth Card */}
            <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all hover:border-border sm:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0068FF]/15 text-[#0068FF] border border-blue-500/30">
                    <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.08L2 22l5.12-1.35C8.55 21.49 10.23 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-zinc-200">Zalo Auth</p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${notifStatus?.zaloDetails?.sessionConnected
                            ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                            : "bg-zinc-800 text-zinc-500 border-zinc-700"
                          }`}
                      >
                        {notifStatus?.zaloDetails?.sessionConnected
                          ? `Đã kết nối (UID: ${notifStatus.zaloDetails.uid || "Sẵn sàng"})`
                          : "Chưa có phiên Zalo"}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Sử dụng phiên Zalo đã đăng nhập làm nguồn gửi tin nhắn thông báo tự động
                    </p>
                  </div>
                </div>

                {/* Switch Toggle */}
                <button
                  type="button"
                  onClick={() => setPrefs((p) => ({ ...p, sendToZalo: !p.sendToZalo }))}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.sendToZalo ? "bg-[#0068FF]" : "bg-zinc-800"
                    }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.sendToZalo ? "translate-x-5" : "translate-x-0"
                      }`}
                  />
                </button>
              </div>

              {/* Zalo Founder nhận tin (mặc định lấy từ .env) */}
              <div className="mt-3 border-t border-border/40 pt-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-zinc-300">
                    Zalo Founder nhận tin (mặc định lấy từ <code>.env</code>):
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        openZaloAuthPopup();
                      }}
                      className="text-[10px] font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-lg px-2 py-1 flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <span>{notifStatus?.zaloDetails?.sessionConnected ? "Quét lại mã QR (Popup)" : "Xác thực qua Zalo (Popup)"}</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsZaloModalOpen(true)}
                      className="text-[10px] text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
                    >
                      Hướng dẫn API
                    </button>
                  </div>
                </div>

                {/* 2 input options: Số điện thoại và Nhóm Zalo */}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">
                      1. Nhập số điện thoại người nhận:
                    </label>
                    <input
                      type="text"
                      placeholder={
                        notifStatus?.zaloDetails?.defaultPhone
                          ? `Mặc định .env: ${notifStatus.zaloDetails.defaultPhone}`
                          : "vd: 0912345678 (để trống dùng .env)"
                      }
                      value={prefs.customZaloPhone || ""}
                      onChange={(e) => setPrefs((p) => ({ ...p, customZaloPhone: e.target.value }))}
                      className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">
                      2. Nhập text / ID nhóm Zalo:
                    </label>
                    <input
                      type="text"
                      placeholder={
                        notifStatus?.zaloDetails?.defaultGroupId
                          ? `Mặc định .env: ${notifStatus.zaloDetails.defaultGroupId}`
                          : "vd: group_id_xyz (để trống dùng .env)"
                      }
                      value={prefs.customZaloGroupId || ""}
                      onChange={(e) => setPrefs((p) => ({ ...p, customZaloGroupId: e.target.value }))}
                      className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Event Triggers Filter Section */}
        <div className="space-y-3 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5 text-accent" /> 2. Bộ lọc sự kiện gửi báo cáo
            </span>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => toggleAllEvents(true)}
                className="text-accent hover:underline flex items-center gap-1 text-[11px]"
              >
                <CheckCheck className="h-3 w-3" /> Bật tất cả
              </button>
              <span className="text-zinc-600">•</span>
              <button
                type="button"
                onClick={() => toggleAllEvents(false)}
                className="text-zinc-400 hover:text-zinc-200 text-[11px]"
              >
                Tắt tất cả
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {/* Event 1: Budget Cap Exceeded */}
            <div
              className={`rounded-xl border transition-all ${prefs.notifyBudgetCapExceeded
                  ? "border-rose-500/30 bg-rose-500/5"
                  : "border-border/60 bg-canvas/40 opacity-70"
                } p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <DollarSign className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xs font-semibold text-zinc-100">
                        Vượt trần ngân sách AI (BUDGET CAP EXCEEDED)
                      </h3>
                      <span className="inline-flex rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-400">
                        Cực kỳ quan trọng
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Gửi ngay khi một Agent vượt trần riêng hoặc Toàn bộ công ty chạm trần chi phí tháng (tự động SUSPENDED).
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => togglePreview("BUDGET_CAP")}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-white/5"
                  >
                    {previewOpen.BUDGET_CAP ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    <span className="hidden sm:inline">{previewOpen.BUDGET_CAP ? "Ẩn mẫu" : "Xem mẫu"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPrefs((p) => ({ ...p, notifyBudgetCapExceeded: !p.notifyBudgetCapExceeded }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.notifyBudgetCapExceeded ? "bg-accent" : "bg-zinc-800"
                      }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.notifyBudgetCapExceeded ? "translate-x-5" : "translate-x-0"
                        }`}
                    />
                  </button>
                </div>
              </div>

              {previewOpen.BUDGET_CAP && (
                <div className="mt-3 rounded-lg border border-border/80 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 leading-relaxed shadow-inner">
                  <div className="text-zinc-500 text-[10px] mb-1 flex items-center justify-between">
                    <span>MẪU THÔNG BÁO THỰC TẾ (TELEGRAM / EMAIL):</span>
                    <span className="text-rose-400 font-semibold">🚨 SEVERITY: WARNING / CRITICAL</span>
                  </div>
                  <p className="text-rose-400 font-semibold">🚨 *BUDGET CAP EXCEEDED*</p>
                  <p className="mt-1 text-zinc-300">
                    Agent "ai_analyst" (ai_analyst) vượt trần ngân sách riêng ($9.00 / $0.01) — tự động SUSPENDED.
                  </p>
                  <p className="mt-1 text-zinc-400 text-[10px]">
                    Founder vào trang chi tiết Agent để tăng trần hoặc reset chi phí.
                  </p>
                </div>
              )}
            </div>

            {/* Event 2: High Risk Decision Required */}
            <div
              className={`rounded-xl border transition-all ${prefs.notifyDecisionRequired
                  ? "border-amber-500/30 bg-amber-500/5"
                  : "border-border/60 bg-canvas/40 opacity-70"
                } p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Scale className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xs font-semibold text-zinc-100">
                        Quyết định rủi ro cao &amp; Phê duyệt (DECISION PACKAGE R3/R4)
                      </h3>
                      <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                        Cần phê duyệt
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Gửi khi Agent cần chạy các tool rủi ro cao hoặc vượt thẩm quyền tự chủ cần Founder duyệt.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => togglePreview("DECISION")}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-white/5"
                  >
                    {previewOpen.DECISION ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    <span className="hidden sm:inline">{previewOpen.DECISION ? "Ẩn mẫu" : "Xem mẫu"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPrefs((p) => ({ ...p, notifyDecisionRequired: !p.notifyDecisionRequired }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.notifyDecisionRequired ? "bg-accent" : "bg-zinc-800"
                      }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.notifyDecisionRequired ? "translate-x-5" : "translate-x-0"
                        }`}
                    />
                  </button>
                </div>
              </div>

              {previewOpen.DECISION && (
                <div className="mt-3 rounded-lg border border-border/80 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 leading-relaxed shadow-inner">
                  <div className="text-zinc-500 text-[10px] mb-1 flex items-center justify-between">
                    <span>MẪU THÔNG BÁO THỰC TẾ (TELEGRAM / EMAIL):</span>
                    <span className="text-amber-400 font-semibold">⚠️ SEVERITY: WARNING / CRITICAL</span>
                  </div>
                  <p className="text-amber-400 font-semibold">⚠️ *Cần duyệt: execute_payment (R3)*</p>
                  <p className="mt-1 text-zinc-300">
                    Agent "ai_finance" yêu cầu chạy tool "execute_payment". Risk: R3
                  </p>
                  <p className="mt-1 text-zinc-400 text-[10px]">
                    Vào Web app (cột "Chờ phê duyệt") để duyệt hoặc từ chối.
                  </p>
                </div>
              )}
            </div>

            {/* Event 3: Blocked Tasks */}
            <div
              className={`rounded-xl border transition-all ${prefs.notifyBlockedTasks
                  ? "border-orange-500/30 bg-orange-500/5"
                  : "border-border/60 bg-canvas/40 opacity-70"
                } p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20">
                    <Ban className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xs font-semibold text-zinc-100">
                        Nhiệm vụ bị nghẽn quá lâu (BLOCKED TASKS)
                      </h3>
                      <span className="inline-flex rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-400">
                        Cảnh báo trễ hạn
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Gửi khi một task bị tắc ở trạng thái BLOCKED quá thời gian cấu hình (mặc định 60 phút) chưa xử lý.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => togglePreview("BLOCKED_TASK")}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-white/5"
                  >
                    {previewOpen.BLOCKED_TASK ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    <span className="hidden sm:inline">{previewOpen.BLOCKED_TASK ? "Ẩn mẫu" : "Xem mẫu"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPrefs((p) => ({ ...p, notifyBlockedTasks: !p.notifyBlockedTasks }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.notifyBlockedTasks ? "bg-accent" : "bg-zinc-800"
                      }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.notifyBlockedTasks ? "translate-x-5" : "translate-x-0"
                        }`}
                    />
                  </button>
                </div>
              </div>

              {previewOpen.BLOCKED_TASK && (
                <div className="mt-3 rounded-lg border border-border/80 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 leading-relaxed shadow-inner">
                  <div className="text-zinc-500 text-[10px] mb-1 flex items-center justify-between">
                    <span>MẪU THÔNG BÁO THỰC TẾ (TELEGRAM / EMAIL):</span>
                    <span className="text-orange-400 font-semibold">⚠️ SEVERITY: WARNING</span>
                  </div>
                  <p className="text-orange-400 font-semibold">⚠️ *Task bị Blocked quá 60 phút*</p>
                  <p className="mt-1 text-zinc-300">
                    "Tích hợp cổng thanh toán MoMo và VietQR cho khách sạn"
                  </p>
                  <p className="mt-1 text-zinc-400 text-[10px]">Agent phụ trách: ai_engineer</p>
                </div>
              )}
            </div>

            {/* Event 4: Weekly Report */}
            <div
              className={`rounded-xl border transition-all ${prefs.notifyWeeklyReport
                  ? "border-sky-500/30 bg-sky-500/5"
                  : "border-border/60 bg-canvas/40 opacity-70"
                } p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xs font-semibold text-zinc-100">
                        Báo cáo tổng kết tuần (WEEKLY EXECUTIVE DIGEST)
                      </h3>
                      <span className="inline-flex rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-400">
                        Định kỳ thứ 2 &amp; /report
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Tự động gửi báo cáo tổng kết tiến độ tasks, chi phí và trạng thái agent vào 8h-10h sáng thứ 2 hàng tuần hoặc khi gõ /report.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => togglePreview("WEEKLY_REPORT")}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-white/5"
                  >
                    {previewOpen.WEEKLY_REPORT ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    <span className="hidden sm:inline">{previewOpen.WEEKLY_REPORT ? "Ẩn mẫu" : "Xem mẫu"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPrefs((p) => ({ ...p, notifyWeeklyReport: !p.notifyWeeklyReport }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.notifyWeeklyReport ? "bg-accent" : "bg-zinc-800"
                      }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.notifyWeeklyReport ? "translate-x-5" : "translate-x-0"
                        }`}
                    />
                  </button>
                </div>
              </div>

              {previewOpen.WEEKLY_REPORT && (
                <div className="mt-3 rounded-lg border border-border/80 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 leading-relaxed shadow-inner">
                  <div className="text-zinc-500 text-[10px] mb-1 flex items-center justify-between">
                    <span>MẪU THÔNG BÁO THỰC TẾ (TELEGRAM / EMAIL):</span>
                    <span className="text-sky-400 font-semibold">ℹ️ SEVERITY: INFO</span>
                  </div>
                  <p className="text-sky-400 font-semibold">ℹ️ *Weekly Report sẵn sàng*</p>
                  <p className="mt-1 text-zinc-300 whitespace-pre-line">
                    === AI-OPC WEEKLY REPORT (Tuần 2026-W38) ==={"\n"}
                    • Tasks hoàn thành tuần này: 14{"\n"}
                    • Decision Packages: 3 đã duyệt, 0 từ chối{"\n"}
                    • Chi phí tiêu thụ: $4.85 / $50.00 trần{"\n"}
                    • Trạng thái Agent: 6 Ready, 0 Suspended
                  </p>
                </div>
              )}
            </div>

            {/* Event 5: Emergency Stop */}
            <div
              className={`rounded-xl border transition-all ${prefs.notifyEmergencyStop
                  ? "border-rose-500/30 bg-rose-500/5"
                  : "border-border/60 bg-canvas/40 opacity-70"
                } p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <Power className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xs font-semibold text-zinc-100">
                        Dừng khẩn cấp toàn hệ thống (EMERGENCY STOP /STOP)
                      </h3>
                      <span className="inline-flex rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-400">
                        Khẩn cấp hệ thống
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Gửi cảnh báo tức thời khi Founder ra lệnh /stop để đình chỉ khẩn cấp mọi hoạt động Agent.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => togglePreview("EMERGENCY_STOP")}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-white/5"
                  >
                    {previewOpen.EMERGENCY_STOP ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    <span className="hidden sm:inline">{previewOpen.EMERGENCY_STOP ? "Ẩn mẫu" : "Xem mẫu"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPrefs((p) => ({ ...p, notifyEmergencyStop: !p.notifyEmergencyStop }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.notifyEmergencyStop ? "bg-accent" : "bg-zinc-800"
                      }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.notifyEmergencyStop ? "translate-x-5" : "translate-x-0"
                        }`}
                    />
                  </button>
                </div>
              </div>

              {previewOpen.EMERGENCY_STOP && (
                <div className="mt-3 rounded-lg border border-border/80 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 leading-relaxed shadow-inner">
                  <div className="text-zinc-500 text-[10px] mb-1 flex items-center justify-between">
                    <span>MẪU THÔNG BÁO THỰC TẾ (TELEGRAM / EMAIL):</span>
                    <span className="text-rose-400 font-semibold">🚨 SEVERITY: CRITICAL</span>
                  </div>
                  <p className="text-rose-400 font-semibold">🚨 *Emergency Stop đã kích hoạt*</p>
                  <p className="mt-1 text-zinc-300">
                    Founder vừa gọi /stop — toàn bộ Agent đang hoạt động đã chuyển sang SUSPENDED.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Live Test Notification Box */}
        <div className="rounded-xl border border-border/60 bg-zinc-950/40 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5 text-accent" /> Thử nghiệm gửi thông báo trực tiếp
              </h3>
              <p className="text-[11px] text-zinc-400">
                Chọn loại sự kiện để gửi ngay một tin nhắn mẫu thực tế về Telegram Bot / Email đã cấu hình.
              </p>
            </div>

            <button
              onClick={handleTestNotification}
              disabled={testingNotif || !notifStatus?.anyConfigured}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-50"
            >
              {testingNotif ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Đang gửi test...</span>
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  <span>Gửi tin mẫu ngay</span>
                </>
              )}
            </button>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {Object.entries(sampleMessages).map(([key, item]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedTestEvent(key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-all ${selectedTestEvent === key
                    ? "bg-accent/15 border-accent text-accent"
                    : "bg-white/5 border-border/60 text-zinc-400 hover:text-zinc-200 hover:border-border"
                  }`}
              >
                {item.title}
              </button>
            ))}
          </div>

          {notifStatus && !notifStatus.anyConfigured && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Chưa có kênh nào (Telegram hoặc Email) được cấu hình trong <code>services/api/.env</code>. Vui lòng cấu hình ít nhất 1 kênh để nhận thông báo.
              </span>
            </div>
          )}
        </div>

        {notifMessage && (
          <div
            className={`flex items-center gap-2 rounded-xl border p-3.5 text-xs ${notifMessage.type === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
          >
            {notifMessage.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            )}
            <span>{notifMessage.text}</span>
          </div>
        )}
      </div>

      {/* AI Agent Input & Model Gateway Configuration */}
      {loaded && (
        <div className="space-y-6 rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                  <Cpu className="h-5 w-5 text-accent" /> {t.settings.aiGateway.title}
                </h2>
                <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent font-mono">
                  {llmStatusDesc || (locale === "vi" ? "Đang phát hiện" : "Detecting")}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                {t.settings.aiGateway.desc}
              </p>
            </div>
          </div>

          {/* 1. Provider Cards */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
              {t.settings.aiGateway.providerSection}
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { id: "auto", name: t.settings.aiGateway.providers.auto.name, desc: t.settings.aiGateway.providers.auto.desc, badge: t.settings.aiGateway.providers.auto.badge },
                { id: "gemini", name: t.settings.aiGateway.providers.gemini.name, desc: t.settings.aiGateway.providers.gemini.desc, badge: t.settings.aiGateway.providers.gemini.badge },
                { id: "openai", name: t.settings.aiGateway.providers.openai.name, desc: t.settings.aiGateway.providers.openai.desc, badge: t.settings.aiGateway.providers.openai.badge },
                { id: "anthropic", name: t.settings.aiGateway.providers.anthropic.name, desc: t.settings.aiGateway.providers.anthropic.desc, badge: t.settings.aiGateway.providers.anthropic.badge },
                { id: "custom", name: t.settings.aiGateway.providers.custom.name, desc: t.settings.aiGateway.providers.custom.desc, badge: t.settings.aiGateway.providers.custom.badge },
              ].map((p) => {
                const selected = llmProvider === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setLlmProvider(p.id as any)}
                    className={`cursor-pointer rounded-xl border p-3.5 transition-all relative ${selected
                        ? "border-accent bg-accent/10 shadow-md ring-1 ring-accent/50"
                        : "border-border/60 bg-canvas/60 hover:border-border hover:bg-canvas/90"
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold ${selected ? "text-accent" : "text-zinc-200"}`}>
                        {p.name}
                      </span>
                      {selected && <Check className="h-3.5 w-3.5 text-accent" />}
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-400 line-clamp-1">{p.desc}</p>
                    <span className="mt-2 inline-block rounded bg-white/5 px-1.5 py-0.2 text-[9px] text-zinc-500 font-mono">
                      {p.badge}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. Model and Hyperparameters */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  2. Model mặc định (Default Model)
                </label>
                <span className="text-[11px] text-zinc-500">Để trống = Tự dùng model chuẩn</span>
              </div>
              <input
                type="text"
                placeholder={
                  llmProvider === "gemini"
                    ? "vd: gemini-3.7-flash"
                    : llmProvider === "openai"
                      ? "vd: gpt-4o"
                      : llmProvider === "anthropic"
                        ? "vd: claude-3-5-sonnet-20241022"
                        : llmProvider === "custom"
                          ? "vd: llama3.3 hoặc deepseek-r1"
                          : "vd: gemini-3.7-flash (hoặc để trống)"
                }
                value={orchestratorModel}
                onChange={(e) => setOrchestratorModel(e.target.value)}
                className="w-full rounded-xl border border-border/80 bg-canvas/90 px-3.5 py-2.5 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
              />
              {/* Quick model suggestion pills */}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {(llmProvider === "gemini" || llmProvider === "auto"
                  ? ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.1-pro-preview"]
                  : llmProvider === "openai"
                    ? ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"]
                    : llmProvider === "anthropic"
                      ? ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"]
                      : ["llama3.3", "deepseek-r1", "qwen2.5:14b", "mistral-nemo"]
                ).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setOrchestratorModel(m)}
                    className="rounded-lg border border-border/60 bg-white/5 px-2 py-0.5 text-[10px] font-mono text-zinc-400 hover:border-accent/40 hover:text-accent transition-colors"
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Nhiệt độ sáng tạo (Temperature: {temperature})
                </label>
                <span className="text-[11px] text-zinc-500">0.0 (Logic) - 1.0 (Sáng tạo)</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-accent"
              />
              <p className="text-[11px] text-zinc-500">
                Khuyến nghị: <strong>0.2</strong> cho AI-COO và phân rã task chính xác theo cấu trúc JSON.
              </p>
            </div>
          </div>

          {/* 3. Custom Endpoint URL (for Local / Self-hosted / Custom) */}
          {(llmProvider === "custom" || llmProvider === "auto") && (
            <div className="space-y-2 border-t border-border/60 pt-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-accent" /> URL Endpoint Tùy Chỉnh / Local AI (OpenAI Compatible)
                </label>
                <span className="text-[11px] text-zinc-500">Hỗ trợ Ollama, LM Studio, vLLM, Groq, DeepSeek</span>
              </div>
              <input
                type="text"
                placeholder="vd: http://localhost:11434/v1 (Ollama) hoặc https://api.groq.com/openai/v1"
                value={customLlmUrl}
                onChange={(e) => setCustomLlmUrl(e.target.value)}
                className="w-full rounded-xl border border-border/80 bg-canvas/90 px-3.5 py-2.5 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCustomLlmUrl("http://localhost:11434/v1")}
                  className="rounded-lg border border-border/60 bg-white/5 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                >
                  Gợi ý: Ollama (localhost:11434/v1)
                </button>
                <button
                  type="button"
                  onClick={() => setCustomLlmUrl("http://localhost:1234/v1")}
                  className="rounded-lg border border-border/60 bg-white/5 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                >
                  Gợi ý: LM Studio (localhost:1234/v1)
                </button>
                <button
                  type="button"
                  onClick={() => setCustomLlmUrl("https://api.groq.com/openai/v1")}
                  className="rounded-lg border border-border/60 bg-white/5 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                >
                  Gợi ý: Groq Cloud
                </button>
              </div>
            </div>
          )}

          {/* 3. API Keys Configuration */}
          <div className="space-y-3 border-t border-border/60 pt-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
                3. Nhập Khóa API (API Keys)
              </label>
              <span className="text-[11px] text-zinc-400">
                {llmProvider === "auto"
                  ? "Cấu hình khóa cho chế độ Tự động (Multi-provider)"
                  : `Chỉ yêu cầu khóa cho: ${llmProvider === "gemini"
                    ? "Google Gemini"
                    : llmProvider === "openai"
                      ? "OpenAI GPT"
                      : llmProvider === "anthropic"
                        ? "Anthropic Claude"
                        : "Custom / Local AI"
                  }`}
              </span>
            </div>

            {/* Gemini Key Only */}
            {llmProvider === "gemini" && (
              <div className="space-y-1.5 max-w-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5 text-accent" /> Google Gemini API Key
                  </span>
                  {llmMasked.gemini && (
                    <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.gemini}</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showLlmKeys.gemini ? "text" : "password"}
                    placeholder={llmMasked.gemini ? "Nhập để thay đổi key mới..." : "AIzaSy..."}
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLlmKeys({ ...showLlmKeys, gemini: !showLlmKeys.gemini })}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showLlmKeys.gemini ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {/* OpenAI Key Only */}
            {llmProvider === "openai" && (
              <div className="space-y-1.5 max-w-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5 text-sky-400" /> OpenAI API Key
                  </span>
                  {llmMasked.openai && (
                    <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.openai}</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showLlmKeys.openai ? "text" : "password"}
                    placeholder={llmMasked.openai ? "Nhập để thay đổi key mới..." : "sk-..."}
                    value={openaiApiKey}
                    onChange={(e) => setOpenaiApiKey(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLlmKeys({ ...showLlmKeys, openai: !showLlmKeys.openai })}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showLlmKeys.openai ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {/* Anthropic Key Only */}
            {llmProvider === "anthropic" && (
              <div className="space-y-1.5 max-w-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5 text-amber-400" /> Anthropic Claude Key
                  </span>
                  {llmMasked.anthropic && (
                    <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.anthropic}</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showLlmKeys.anthropic ? "text" : "password"}
                    placeholder={llmMasked.anthropic ? "Nhập để thay đổi key mới..." : "sk-ant-..."}
                    value={anthropicApiKey}
                    onChange={(e) => setAnthropicApiKey(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLlmKeys({ ...showLlmKeys, anthropic: !showLlmKeys.anthropic })}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showLlmKeys.anthropic ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {/* Custom LLM Key Only */}
            {llmProvider === "custom" && (
              <div className="space-y-1.5 max-w-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5 text-purple-400" /> Custom / Bearer Token
                  </span>
                  {llmMasked.custom && (
                    <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.custom}</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showLlmKeys.custom ? "text" : "password"}
                    placeholder={llmMasked.custom ? "Nhập để thay đổi token..." : "Tùy chọn (để trống nếu Ollama/LM Studio không yêu cầu token)..."}
                    value={customLlmApiKey}
                    onChange={(e) => setCustomLlmApiKey(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLlmKeys({ ...showLlmKeys, custom: !showLlmKeys.custom })}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showLlmKeys.custom ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {/* Auto Mode: Show all 4 in a responsive grid */}
            {llmProvider === "auto" && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Gemini Key */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-accent" /> Google Gemini API Key
                    </span>
                    {llmMasked.gemini && (
                      <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.gemini}</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showLlmKeys.gemini ? "text" : "password"}
                      placeholder={llmMasked.gemini ? "Nhập để thay đổi key mới..." : "AIzaSy..."}
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLlmKeys({ ...showLlmKeys, gemini: !showLlmKeys.gemini })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      {showLlmKeys.gemini ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* OpenAI Key */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-sky-400" /> OpenAI API Key
                    </span>
                    {llmMasked.openai && (
                      <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.openai}</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showLlmKeys.openai ? "text" : "password"}
                      placeholder={llmMasked.openai ? "Nhập để thay đổi key mới..." : "sk-..."}
                      value={openaiApiKey}
                      onChange={(e) => setOpenaiApiKey(e.target.value)}
                      className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLlmKeys({ ...showLlmKeys, openai: !showLlmKeys.openai })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      {showLlmKeys.openai ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Anthropic Key */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-amber-400" /> Anthropic Claude Key
                    </span>
                    {llmMasked.anthropic && (
                      <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.anthropic}</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showLlmKeys.anthropic ? "text" : "password"}
                      placeholder={llmMasked.anthropic ? "Nhập để thay đổi key mới..." : "sk-ant-..."}
                      value={anthropicApiKey}
                      onChange={(e) => setAnthropicApiKey(e.target.value)}
                      className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLlmKeys({ ...showLlmKeys, anthropic: !showLlmKeys.anthropic })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      {showLlmKeys.anthropic ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Custom LLM Key */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-purple-400" /> Custom / Bearer Token
                    </span>
                    {llmMasked.custom && (
                      <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.custom}</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showLlmKeys.custom ? "text" : "password"}
                      placeholder={llmMasked.custom ? "Nhập để thay đổi token..." : "Tùy chọn cho Groq/Local..."}
                      value={customLlmApiKey}
                      onChange={(e) => setCustomLlmApiKey(e.target.value)}
                      className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLlmKeys({ ...showLlmKeys, custom: !showLlmKeys.custom })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      {showLlmKeys.custom ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 4. Bottom Action Footer */}
          <div className="space-y-4 border-t border-border/60 pt-4 mt-2 bg-white/[0.02] -mx-6 -mb-6 p-6 rounded-b-2xl">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Sparkles className="h-4 w-4 text-accent shrink-0" />
                <span>
                  {t.settings.aiGateway.footerNotice}
                </span>
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={handleTestLlm}
                  disabled={testingLlm}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 transition-all cursor-pointer shadow-sm"
                >
                  {testingLlm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  <span>{testingLlm ? t.settings.aiGateway.testingConnection : t.settings.aiGateway.testConnection}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveLlm}
                  disabled={savingLlm}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-black hover:bg-accent/90 disabled:opacity-50 transition-all shadow-lg shadow-accent/25 hover:shadow-accent/40 cursor-pointer font-medium"
                >
                  {savingLlm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  <span>{savingLlm ? t.settings.aiGateway.savingConfig : t.settings.aiGateway.saveConfig}</span>
                </button>
              </div>
            </div>

            {/* Feedback message (Đã lưu / Thông báo lỗi) */}
            {llmMessage && (
              <div
                className={`flex items-center gap-2.5 rounded-xl border p-3.5 text-xs ${
                  llmMessage.type === "success"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                }`}
              >
                {llmMessage.type === "success" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                )}
                <span>{llmMessage.text}</span>
              </div>
            )}

            {/* Live Test Result (Kết nối thành công / Phản hồi test từ model) */}
            {testResult && (
              <div
                className={`rounded-xl border p-4 text-xs space-y-2.5 ${
                  testResult.success
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-rose-500/40 bg-rose-500/10 text-rose-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1.5">
                    {testResult.success ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        {t.settings.aiGateway.testSuccess.replace("{provider}", testResult.provider?.toUpperCase() || "").replace("{model}", testResult.modelUsed || "")}
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4 text-rose-400" />
                        {t.settings.aiGateway.testFailed}
                      </>
                    )}
                  </span>
                  <span className="font-mono text-[11px] bg-black/40 px-2.5 py-0.5 rounded-md border border-white/10">
                    {t.common.latency}: {testResult.latencyMs} ms
                  </span>
                </div>
                {testResult.reply && (
                  <div className="rounded-lg bg-black/50 p-3 font-mono text-[11px] text-zinc-300 border border-white/10 leading-relaxed">
                    {t.settings.aiGateway.aiReply} &ldquo;{testResult.reply}&rdquo;
                  </div>
                )}
                {testResult.error && (
                  <p className="text-rose-300/90 leading-relaxed font-mono text-[11px] bg-black/50 p-3 rounded-lg border border-rose-500/20">
                    {testResult.error}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Budget Guardrail Form */}
      {loaded && (
        <form onSubmit={handleSaveBudget} className="space-y-4 rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-zinc-100">{t.settings.budget.title}</h2>
            <p className="text-xs text-zinc-400">
              {t.settings.budget.desc}
            </p>
          </div>

          <div className="space-y-2">
            <div className="relative max-w-xs">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g.: 50.00"
                value={capInput}
                onChange={(e) => setCapInput(e.target.value)}
                className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2.5 pl-8 pr-4 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-all focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              💡 {t.settings.budget.autoBlockNotice}
            </p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
          >
            {saving ? t.common.saving : t.settings.budget.saveCap}
          </button>
        </form>
      )}

      {/* Reset Monthly Cost Section */}
      <div className="space-y-3 rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-zinc-100">{locale === "vi" ? "Chu kỳ & Reset đầu tháng" : "Cycle & Monthly Cost Reset"}</h2>
          <p className="text-xs text-zinc-400">
            {locale === "vi" ? "Đặt lại số dư tiêu thụ tích luỹ về $0 để bắt đầu kỳ tính toán mới." : "Reset accumulated AI cost counter to $0 to start a new billing cycle."}
          </p>
        </div>

        <p className="text-xs text-zinc-500 leading-relaxed">
          {locale === "vi"
            ? "Nút này sẽ reset monthlyCostUsd của tất cả Agent về $0, đồng thời tự động mở lại (chuyển về READY) các agent đang bị khoá do Budget Guardrail (cả trần riêng lẫn trần công ty)."
            : "This resets monthlyCostUsd for all agents back to $0, and unlocks (restores to READY) agents that were suspended due to Budget Guardrails."}
        </p>

        <button
          onClick={handleResetCompanyCost}
          disabled={resetting}
          className="flex items-center gap-2 rounded-xl border border-border/80 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/10 hover:text-zinc-100 disabled:opacity-50 cursor-pointer"
        >
          <RotateCcw className={`h-4 w-4 ${resetting ? "animate-spin" : ""}`} />
          <span>{resetting ? t.common.loading : t.settings.budget.resetCostBtn}</span>
        </button>
      </div>

      {/* Zalo Login / Auth Modal */}
      <ZaloLoginModal
        isOpen={isZaloModalOpen}
        onClose={() => setIsZaloModalOpen(false)}
        onSuccess={() => {
          setIsZaloModalOpen(false);
          setNotifMessage({
            type: "success",
            text: "Xác thực và liên kết tài khoản Zalo thành công!",
          });
          refresh();
        }}
      />
    </main>
  );
}
