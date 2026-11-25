"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Terminal,
  AlertTriangle,
  Target,
  Activity,
  FileText,
  Zap,
  Copy,
  Check,
  X,
  Sparkles,
  Settings,
  BookOpen,
  History,
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
  UserPlus,
} from "lucide-react";
import { sendFounderCommand, fetchMe, fetchRbacPermissions } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useCompanySocket } from "@/hooks/useCompanySocket";
import type { RbacRoleId, RbacCommandId, RbacPermissionsMatrix } from "@ai-opc/shared";

function resolveCommandId(cmdStr: string): RbacCommandId {
  const trimmed = cmdStr.trim().toLowerCase();
  if (trimmed.startsWith("/hire")) return "hire";
  if (trimmed.startsWith("/report")) return "report";
  if (trimmed.startsWith("/do")) return "do";
  if (trimmed.startsWith("/goal")) return "goal";
  if (trimmed.startsWith("/status")) return "status";
  if (trimmed.startsWith("/settings")) return "settings";
  if (trimmed.startsWith("/knowledge")) return "knowledge";
  if (trimmed.startsWith("/audit")) return "audit";
  if (trimmed.startsWith("/security")) return "security";
  if (trimmed.startsWith("/stop")) return "stop";
  if (trimmed.startsWith("/plan")) return "plan";
  if (trimmed.startsWith("/analyze")) return "analyze";
  return "do";
}

function isCommandAllowed(
  cmd: string,
  role: RbacRoleId,
  matrix: RbacPermissionsMatrix | null
): boolean {
  if (role === "founder") return true;
  const cmdId = resolveCommandId(cmd);
  if (!matrix || !matrix.commandPermissions) {
    if (role === "viewer") return ["report", "status", "audit"].includes(cmdId);
    if (role === "operator") return ["report", "do", "status", "knowledge", "security"].includes(cmdId);
    if (role === "manager") return !["settings", "stop"].includes(cmdId);
    return true;
  }
  return Boolean(matrix.commandPermissions[role]?.[cmdId]);
}

function getSuggestions(locale: "en" | "vi"): { cmd: string; label: string; icon: React.ReactNode; danger?: boolean; isNav?: boolean }[] {
  if (locale === "vi") {
    return [
      { cmd: "/hire", label: "Tuyển dụng AI Agent mới (Agent Lifecycle)", icon: <UserPlus className="w-4 h-4 text-accent" />, isNav: true },
      { cmd: "/report weekly", label: "Xuất Weekly Executive Report đa chiều", icon: <FileText className="w-4 h-4 text-cyan-400" /> },
      { cmd: "/do @marketing Viết bài blog giới thiệu sản phẩm", label: "Giao thẳng việc cho AI-Marketing (bỏ qua COO)", icon: <Zap className="w-4 h-4 text-amber-400" /> },
      { cmd: "/do @tech Tối ưu hóa database & fix bug", label: "Giao việc kỹ thuật trực tiếp cho AI-Tech", icon: <Zap className="w-4 h-4 text-sky-400" /> },
      { cmd: "/goal ", label: "Giao mục tiêu chiến lược cho AI-COO phân rã", icon: <Target className="w-4 h-4 text-emerald-400" /> },
      { cmd: "/status", label: "Xem tổng quan tiến độ & chi phí công ty", icon: <Activity className="w-4 h-4 text-purple-400" /> },
      { cmd: "/settings", label: "Cài đặt công ty, Budget Guardrail & Kênh thông báo", icon: <Settings className="w-4 h-4 text-amber-400" />, isNav: true },
      { cmd: "/knowledge", label: "Company Knowledge Base & Bộ nhớ AI", icon: <BookOpen className="w-4 h-4 text-accent" />, isNav: true },
      { cmd: "/audit", label: "Audit Log — Nhật ký kiểm toán mọi hành vi AI", icon: <History className="w-4 h-4 text-zinc-400" />, isNav: true },
      { cmd: "/security", label: "Bảo mật tài khoản & Xác thực 2FA", icon: <ShieldCheck className="w-4 h-4 text-emerald-400" />, isNav: true },
      { cmd: "/stop", label: "DỪNG KHẨN CẤP mọi Agent (Rule 12)", icon: <AlertTriangle className="w-4 h-4 text-danger" />, danger: true },
    ];
  }

  return [
    { cmd: "/hire", label: "Hire New AI Agent (Agent Lifecycle)", icon: <UserPlus className="w-4 h-4 text-accent" />, isNav: true },
    { cmd: "/report weekly", label: "Generate Comprehensive Weekly Executive Report", icon: <FileText className="w-4 h-4 text-cyan-400" /> },
    { cmd: "/do @marketing Write product announcement blog post", label: "Dispatch direct task to AI-Marketing", icon: <Zap className="w-4 h-4 text-amber-400" /> },
    { cmd: "/do @tech Optimize database queries and fix bugs", label: "Dispatch direct engineering task to AI-Tech", icon: <Zap className="w-4 h-4 text-sky-400" /> },
    { cmd: "/goal ", label: "Assign high-level strategic goal to AI-COO", icon: <Target className="w-4 h-4 text-emerald-400" /> },
    { cmd: "/status", label: "View company progress, active tasks & AI cost", icon: <Activity className="w-4 h-4 text-purple-400" /> },
    { cmd: "/settings", label: "Company Settings, Budget Guardrail & Alert Channels", icon: <Settings className="w-4 h-4 text-amber-400" />, isNav: true },
    { cmd: "/knowledge", label: "Company Knowledge Base & AI Memory", icon: <BookOpen className="w-4 h-4 text-accent" />, isNav: true },
    { cmd: "/audit", label: "Audit Log — Comprehensive AI action audit trail", icon: <History className="w-4 h-4 text-zinc-400" />, isNav: true },
    { cmd: "/security", label: "Account Security & 2FA Setup", icon: <ShieldCheck className="w-4 h-4 text-emerald-400" />, isNav: true },
    { cmd: "/stop", label: "EMERGENCY STOP all AI Agents (Rule 12)", icon: <AlertTriangle className="w-4 h-4 text-danger" />, danger: true },
  ];
}

const NAVIGATION_ROUTES: Record<string, string> = {
  "/hire": "/agents/new",
  "/agents/new": "/agents/new",
  "/settings": "/settings",
  "/knowledge": "/knowledge",
  "/audit": "/audit",
  "/security": "/security",
  "/agents": "/agents",
  "/cockpit": "/",
  "/home": "/",
};

interface ExecutiveReportMetric {
  totalTasks?: number;
  completedTasks?: number;
  runningTasks?: number;
  blockedTasks?: number;
  pendingDecisions?: number;
  totalCostUsd?: number;
  activeAgentsCount?: number;
}

interface AgentStatItem {
  id: string;
  name: string;
  title: string;
  status: string;
  monthlyCostUsd: number;
  completedCount: number;
  runningCount: number;
  blockedCount: number;
}

interface ExecutiveReportData {
  title?: string;
  generatedAt?: string;
  markdown?: string;
  metrics?: ExecutiveReportMetric;
  agentStats?: AgentStatItem[];
}

interface CommandResult {
  status?: string;
  message?: string;
  type?: string;
  path?: string;
  taskId?: string;
  assignedTo?: string;
  title?: string;
  report?: ExecutiveReportData | string;
  error?: string;
}

export function CommandPalette() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const suggestions = getSuggestions(locale);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") {
        if (result) {
          setResult(null);
        } else {
          setOpen(false);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [result]);

  const [userRole, setUserRole] = useState<RbacRoleId>("founder");
  const [rbacMatrix, setRbacMatrix] = useState<RbacPermissionsMatrix | null>(null);
  const { lastEvent } = useCompanySocket();

  // Load User Role & RBAC permissions on mount & when opened
  useEffect(() => {
    let mounted = true;
    fetchMe()
      .then((me) => {
        if (mounted && me?.role) {
          setUserRole(me.role as RbacRoleId);
        }
      })
      .catch(() => {});

    fetchRbacPermissions()
      .then((matrix) => {
        if (mounted) setRbacMatrix(matrix);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [open]);

  // Real-time synchronization when RBAC matrix is updated
  useEffect(() => {
    if (lastEvent && lastEvent.type === "RBAC_PERMISSIONS_UPDATED" && lastEvent.payload) {
      setRbacMatrix(lastEvent.payload as RbacPermissionsMatrix);
    }
  }, [lastEvent]);

  const filteredSuggestions = suggestions.filter((s) =>
    isCommandAllowed(s.cmd, userRole, rbacMatrix)
  );

  async function run(command: string) {
    const trimmed = command.trim();
    if (!trimmed) return;

    // RBAC client-side permission enforcement
    if (!isCommandAllowed(trimmed, userRole, rbacMatrix)) {
      setResult({
        error:
          locale === "vi"
            ? `Tài khoản với vai trò "${userRole}" không có quyền thực hiện lệnh "${trimmed}" theo phân quyền RBAC.`
            : `Your account role "${userRole}" is not permitted to execute command "${trimmed}" under current RBAC settings.`,
      });
      return;
    }

    // Fast client-side navigation
    const targetRoute = NAVIGATION_ROUTES[trimmed.toLowerCase()];
    if (targetRoute) {
      setOpen(false);
      setInput("");
      setResult(null);
      router.push(targetRoute);
      return;
    }

    setBusy(true);
    try {
      const res = (await sendFounderCommand(trimmed)) as CommandResult;
      if (res.status === "NAVIGATE" && res.path) {
        setOpen(false);
        setInput("");
        setResult(null);
        router.push(res.path);
        return;
      }
      setResult(res);
      setInput("");
    } catch (err) {
      setResult({
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  const normalizedReport: ExecutiveReportData | null = (() => {
    if (!result?.report) return null;
    if (typeof result.report === "string") {
      return {
        title: "Executive Report",
        markdown: result.report,
      };
    }
    return result.report;
  })();

  const handleCopyReport = () => {
    const textToCopy =
      normalizedReport?.markdown ||
      (typeof result?.report === "string" ? result.report : "");
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 p-4 pt-20 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={() => {
        setOpen(false);
        setResult(null);
      }}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-800 bg-panel shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Input */}
        <div className="flex items-center gap-3 border-b border-border/80 px-4 py-3.5 bg-zinc-950/40">
          <Terminal className="h-4 w-4 text-accent shrink-0" />
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && input.trim() && run(input)}
            placeholder={t.cockpit.cmdPlaceholder}
            className="w-full bg-transparent font-mono text-xs sm:text-sm text-inherit outline-none placeholder:text-zinc-500"
          />
          {busy && (
            <span className="flex items-center gap-1.5 text-xs text-accent font-mono shrink-0">
              <span className="h-2 w-2 rounded-full bg-accent animate-ping" />
              {t.cockpit.runningCmd}
            </span>
          )}
          <button
            onClick={() => {
              setOpen(false);
              setResult(null);
            }}
            className="text-zinc-500 hover:text-zinc-300 p-1 rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Result View */}
        {result ? (
          <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
            {/* Error state */}
            {result.error && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-xs text-rose-300 space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4 text-rose-400" />
                  {t.common.error}
                </div>
                <p className="font-mono text-zinc-300">{result.error}</p>
              </div>
            )}

            {/* Executive Report Display */}
            {normalizedReport && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-border/60 pb-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-cyan-400" />
                    <div>
                      <h3 className="font-semibold text-sm text-zinc-200">
                        {normalizedReport.title || "Executive Report"}
                      </h3>
                      <p className="text-[11px] text-zinc-500">{t.cockpit.subtitle}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleCopyReport}
                    className="flex items-center gap-1.5 rounded-lg border border-border/80 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10 hover:text-zinc-100 cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-emerald-400">{t.cockpit.copiedMarkdown}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>{t.cockpit.copyMarkdown}</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Key Metrics Cards (when metrics available) */}
                {normalizedReport.metrics && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="rounded-xl border border-border/80 bg-canvas/60 p-3">
                      <p className="text-[10px] text-zinc-500">{t.cockpit.metricsTotalTasks}</p>
                      <p className="font-mono text-base font-semibold text-zinc-200">
                        {normalizedReport.metrics.totalTasks ?? 0}
                      </p>
                    </div>
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <p className="text-[10px] text-emerald-300/70">{t.cockpit.metricsCompleted}</p>
                      <p className="font-mono text-base font-semibold text-emerald-400">
                        {normalizedReport.metrics.completedTasks ?? 0}
                      </p>
                    </div>
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                      <p className="text-[10px] text-amber-300/70">{t.cockpit.metricsRunning}</p>
                      <p className="font-mono text-base font-semibold text-amber-300">
                        {normalizedReport.metrics.runningTasks ?? 0}
                      </p>
                    </div>
                    <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3">
                      <p className="text-[10px] text-purple-300/70">{t.cockpit.metricsTotalCost}</p>
                      <p className="font-mono text-base font-semibold text-purple-300">
                        ${Number(normalizedReport.metrics.totalCostUsd || 0).toFixed(4)}
                      </p>
                    </div>
                  </div>
                )}

                {/* Agent Stats breakdown if available */}
                {normalizedReport.agentStats && normalizedReport.agentStats.length > 0 && (
                  <div className="rounded-xl border border-border/70 bg-panel/50 p-3.5 space-y-2">
                    <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                      {locale === "vi" ? "Hiệu suất từng Agent" : "Agent Performance & Spend"}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {normalizedReport.agentStats.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between rounded-lg border border-border/50 bg-canvas/40 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-zinc-200 truncate">{a.name}</p>
                            <p className="text-[10px] text-zinc-500">{a.title}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono text-emerald-400 font-medium">
                              {a.completedCount} done
                            </p>
                            <p className="font-mono text-[10px] text-zinc-400">
                              ${Number(a.monthlyCostUsd || 0).toFixed(3)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Markdown text preview */}
                {normalizedReport.markdown && (
                  <div className="rounded-xl border border-border/80 bg-zinc-950/80 p-4 font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                    {normalizedReport.markdown}
                  </div>
                )}
              </div>
            )}

            {/* Direct Task Dispatch Confirmation (/do) */}
            {result.type === "/do" && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  {t.cockpit.taskAssignedSuccess}
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">{result.message}</p>
                {result.taskId && (
                  <div className="flex items-center gap-2 pt-1 font-mono text-[11px] text-zinc-400">
                    <span>{t.cockpit.taskIdLabel}</span>
                    <span className="rounded bg-black/40 px-2 py-0.5 text-zinc-200">
                      #{result.taskId}
                    </span>
                    <span>→ {t.cockpit.assignedToLabel} <strong className="text-emerald-300">{result.assignedTo}</strong></span>
                  </div>
                )}
              </div>
            )}

            {/* Status overview or other messages */}
            {result.type !== "/do" && !result.report && !result.error && (
              <div className="rounded-xl border border-border/80 bg-canvas/60 p-4 space-y-2">
                <div className="flex items-center gap-2 text-accent font-medium text-sm">
                  <Sparkles className="h-4 w-4" />
                  {t.cockpit.systemNotice}
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">{result.message || JSON.stringify(result)}</p>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setResult(null)}
                className="rounded-lg border border-border/80 bg-white/5 px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
              >
                {t.cockpit.enterOtherCmd}
              </button>
            </div>
          </div>
        ) : (
          /* Suggestions List */
          <div className="p-2 text-xs sm:text-sm">
            <div className="px-3 py-1.5 flex items-center justify-between text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
              <span>{t.cockpit.quickCommands}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-mono border ${
                  userRole === "founder"
                    ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                    : userRole === "manager"
                    ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/30"
                    : userRole === "operator"
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700"
                }`}
              >
                Role: {userRole}
              </span>
            </div>
            {filteredSuggestions.length > 0 ? (
              <ul className="space-y-0.5">
                {filteredSuggestions.map((s) => (
                  <li key={s.cmd}>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (s.cmd.endsWith(" ")) {
                          setInput(s.cmd);
                        } else {
                          run(s.cmd);
                        }
                      }}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/5 ${
                        s.danger ? "text-danger" : "text-zinc-300 hover:text-zinc-100"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {s.icon}
                        <span className="font-mono font-medium">{s.cmd.trim() || s.cmd}</span>
                      </div>
                      <span className="text-[11px] text-zinc-500 truncate flex items-center gap-1">
                        {s.label}
                        {s.isNav && <ExternalLink className="w-3 h-3 text-zinc-600 inline" />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-6 text-center text-xs text-zinc-500">
                {locale === "vi"
                  ? `Không có gợi ý lệnh nào khả dụng cho vai trò "${userRole}".`
                  : `No command suggestions available for role "${userRole}".`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
