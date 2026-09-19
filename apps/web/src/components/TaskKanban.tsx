"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  Clock,
  PlayCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  X,
  Copy,
  Check,
  RotateCcw,
  ExternalLink,
  Shield,
  FileText,
  MessageSquare,
  Sparkles,
  Download,
  BookOpen,
  Send,
  Edit3,
  Search,
  Filter,
  SlidersHorizontal,
  Bot,
  Zap,
} from "lucide-react";
import type { Task, RiskLevel, Agent } from "@ai-opc/shared";
import { cleanDeliverableText } from "@ai-opc/shared";
import {
  fetchTasks,
  submitTaskInternalReview,
  requeueTask,
  ingestKnowledgeDoc,
  sendTaskDeliverableNotification,
} from "@/lib/api";
import { DeliverableEditModal } from "./DeliverableEditModal";
import { useI18n } from "@/context/I18nContext";


// ---- Status config -------------------------------------------------------

type TaskStatus = Task["status"];

const STATUS_VISUALS: Record<
  TaskStatus,
  { icon: React.ReactNode; color: string; bg: string; border: string }
> = {
  NEW: {
    icon: <Circle className="h-3.5 w-3.5" />,
    color: "text-zinc-400",
    bg: "bg-zinc-800/80",
    border: "border-zinc-700/50",
  },
  TRIAGED: {
    icon: <Circle className="h-3.5 w-3.5" />,
    color: "text-zinc-300",
    bg: "bg-zinc-800/80",
    border: "border-zinc-700/50",
  },
  PLANNED: {
    icon: <Clock className="h-3.5 w-3.5" />,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  ASSIGNED: {
    icon: <Clock className="h-3.5 w-3.5" />,
    color: "text-sky-300",
    bg: "bg-sky-500/10",
    border: "border-sky-500/20",
  },
  RUNNING: {
    icon: <PlayCircle className="h-3.5 w-3.5 animate-pulse" />,
    color: "text-accent",
    bg: "bg-accent/10",
    border: "border-accent/30",
  },
  VERIFYING: {
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  AWAITING_APPROVAL: {
    icon: <Clock className="h-3.5 w-3.5" />,
    color: "text-warn",
    bg: "bg-warn/10",
    border: "border-warn/30",
  },
  AWAITING_INTERNAL_REVIEW: {
    icon: <Shield className="h-3.5 w-3.5" />,
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
  },
  BLOCKED: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    color: "text-danger",
    bg: "bg-danger/10",
    border: "border-danger/30",
  },
  ESCALATED: {
    icon: <AlertTriangle className="h-3.5 w-3.5 animate-pulse" />,
    color: "text-danger",
    bg: "bg-danger/10",
    border: "border-danger/30",
  },
  COMPLETED: {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
};

const RISK_VISUALS: Record<
  RiskLevel | string,
  { badgeClass: string; dotClass: string }
> = {
  R0: {
    badgeClass: "bg-zinc-800/80 text-zinc-400 border-zinc-700/50",
    dotClass: "bg-zinc-400",
  },
  R1: {
    badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    dotClass: "bg-blue-400",
  },
  R2: {
    badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dotClass: "bg-amber-400",
  },
  R3: {
    badgeClass: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    dotClass: "bg-orange-400",
  },
  R4: {
    badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    dotClass: "bg-rose-400",
  },
};

const COLUMN_ORDER: TaskStatus[] = [
  "NEW",
  "PLANNED",
  "ASSIGNED",
  "RUNNING",
  "AWAITING_APPROVAL",
  "AWAITING_INTERNAL_REVIEW",
  "BLOCKED",
  "ESCALATED",
  "COMPLETED",
];

const REQUEUEABLE: TaskStatus[] = ["BLOCKED", "ESCALATED"];

function formatDateTime(iso: string, locale: string = "en") {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    const loc = locale === "vi" ? "vi-VN" : "en-US";
    return `${d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} · ${d.toLocaleDateString(loc)}`;
  } catch {
    return iso;
  }
}

function formatRelativeTime(iso?: string | Date | null, locale: string = "en"): string {
  if (!iso) return "-";
  try {
    const d = typeof iso === "string" ? new Date(iso) : iso;
    if (isNaN(d.getTime())) return "-";
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
    const isVi = locale === "vi";
    if (diffSec < 45) return isVi ? "vừa xong" : "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return isVi ? `${diffMin}m trước` : `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return isVi ? `${diffHour}h trước` : `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay === 1) return isVi ? "hôm qua" : "yesterday";
    if (diffDay < 7) return isVi ? `${diffDay}d trước` : `${diffDay}d ago`;
    return d.toLocaleDateString(isVi ? "vi-VN" : "en-US", { day: "2-digit", month: "2-digit" });
  } catch {
    return "-";
  }
}

function formatTimestamp(iso?: string | null, locale: string = "en") {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    const loc = locale === "vi" ? "vi-VN" : "en-US";
    return `${d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} · ${d.toLocaleDateString(loc)}`;
  } catch {
    return iso;
  }
}

// ---- Single task card ---------------------------------------------------

function TaskCard({
  task,
  children,
  onSelect,
  onRequeued,
}: {
  task: Task;
  children?: React.ReactNode;
  onSelect: (t: Task) => void;
  onRequeued?: () => void;
}) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [requeuing, setRequeuing] = useState(false);
  const visual = STATUS_VISUALS[task.status] ?? STATUS_VISUALS.NEW;
  const statusLabel = t.kanban.statuses[task.status] || task.status;
  const riskVisual = RISK_VISUALS[task.riskLevel] ?? RISK_VISUALS.R0;
  const riskLabel = t.kanban.risks[task.riskLevel as keyof typeof t.kanban.risks] || task.riskLevel;
  const hasChildren = !!children;
  const isReviewPending = task.status === "AWAITING_INTERNAL_REVIEW";
  const isEscalated = task.status === "ESCALATED";

  const handleRequeueClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (requeuing) return;
    setRequeuing(true);
    try {
      await requeueTask(task.id);
      onRequeued?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : (locale === "vi" ? "Requeue thất bại" : "Requeue failed"));
    } finally {
      setRequeuing(false);
    }
  };

  return (
    <div
      onClick={() => onSelect(task)}
      className={`group cursor-pointer rounded-xl border p-2.5 text-xs transition-all duration-200 shadow-sm ${
        isReviewPending
          ? "border-purple-500/30 bg-purple-950/10 hover:border-purple-500/60 hover:bg-purple-950/20"
          : isEscalated
          ? "border-danger/40 bg-danger/5 hover:border-danger/70 hover:bg-danger/10"
          : "border-border/80 bg-panel/80 hover:border-zinc-600/80 hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Expand toggle — only for parent tasks with sub-tasks */}
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="mt-0.5 shrink-0 text-zinc-500 hover:text-zinc-300 p-0.5 rounded cursor-pointer"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="mt-1 shrink-0">
            <span className={`block h-2 w-2 rounded-full ${riskVisual.dotClass}`} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug text-zinc-200 group-hover:text-zinc-100">{task.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {task.assignedTo && (
              <span className="truncate text-[11px] text-zinc-500">
                → <span className="text-zinc-400 font-mono">{task.assignedTo}</span>
              </span>
            )}
            {task.reviewNeededByRole && task.reviewNeededByRole !== "none" && (
              <span className="inline-flex items-center gap-1 rounded bg-purple-500/15 px-1.5 py-0.2 font-mono text-[10px] text-purple-300 border border-purple-500/30">
                <Shield className="h-2.5 w-2.5" />
                {t.taskDetail.reviewBadge} {task.reviewNeededByRole}
              </span>
            )}
            {task.createdAt && (
              <span
                className="inline-flex items-center gap-1 text-[10px] text-zinc-500 font-mono"
                title={`${t.kanban.createdPrefix} ${formatDateTime(task.createdAt, locale)}`}
              >
                <Clock className="h-2.5 w-2.5 opacity-60 shrink-0" />
                {formatRelativeTime(task.createdAt, locale)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Requeue button on card if BLOCKED or ESCALATED */}
          {REQUEUEABLE.includes(task.status) && task.assignedTo && (
            <button
              type="button"
              onClick={handleRequeueClick}
              disabled={requeuing}
              title={t.kanban.requeueTooltip}
              className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-accent transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${requeuing ? "animate-spin text-accent" : ""}`} />
            </button>
          )}

          {/* Risk badge */}
          <span
            className={`rounded border px-1.5 py-0.2 font-mono text-[10px] ${riskVisual.badgeClass}`}
            title={riskLabel}
          >
            {task.riskLevel}
          </span>
        </div>
      </div>

      {/* Sub-tasks */}
      {hasChildren && expanded && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="ml-4 mt-2 border-t border-border/50 pt-2 space-y-1.5"
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ---- Task Detail Modal --------------------------------------------------

function TaskDetailModal({
  task,
  allTasks,
  onClose,
  onSelectTask,
  onTaskUpdated,
}: {
  task: Task;
  allTasks: Task[];
  onClose: () => void;
  onSelectTask: (t: Task) => void;
  onTaskUpdated: () => void;
}) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copiedResult, setCopiedResult] = useState(false);
  const [savingKb, setSavingKb] = useState(false);
  const [savedKbSuccess, setSavedKbSuccess] = useState(false);
  const [kbError, setKbError] = useState("");
  const [sendingNotify, setSendingNotify] = useState(false);
  const [sentNotifySuccess, setSentNotifySuccess] = useState("");
  const [notifyError, setNotifyError] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRequeuing, setIsRequeuing] = useState(false);
  const [reviewSuccessMsg, setReviewSuccessMsg] = useState("");
  const [reviewErrMsg, setReviewErrMsg] = useState("");

  // States for Deliverable Editing via Modal
  const [taskOverride, setTaskOverride] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const visual = STATUS_VISUALS[task.status] ?? STATUS_VISUALS.NEW;
  const statusLabel = t.kanban.statuses[task.status] || task.status;
  const riskVisual = RISK_VISUALS[task.riskLevel] ?? RISK_VISUALS.R0;
  const riskLabel = t.kanban.risks[task.riskLevel as keyof typeof t.kanban.risks] || task.riskLevel;

  const parentTask = task.parentTaskId ? allTasks.find((t) => t.id === task.parentTaskId) : null;
  const subTasks = allTasks.filter((t) => t.parentTaskId === task.id);

  const isAwaitingReview = task.status === "AWAITING_INTERNAL_REVIEW";
  const isRequeueable = REQUEUEABLE.includes(task.status) && !!task.assignedTo;
  const deliverable = taskOverride !== null ? taskOverride : cleanDeliverableText(task.result);
  const hasDeliverable = Boolean(deliverable && deliverable.trim());

  const handleCopyId = () => {
    navigator.clipboard.writeText(task.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleCopyResult = () => {
    if (!deliverable) return;
    navigator.clipboard.writeText(deliverable);
    setCopiedResult(true);
    setTimeout(() => setCopiedResult(false), 2000);
  };

  const handleSaveToKb = async () => {
    if (!deliverable) return;
    setSavingKb(true);
    setKbError("");
    try {
      await ingestKnowledgeDoc(
        `[SOP / Deliverable] ${task.title}`,
        deliverable,
        `Task #${task.id.slice(0, 8)} · ${t.kanban.assignedPrefix} ${task.assignedTo || "AI"}`
      );
      setSavedKbSuccess(true);
      setTimeout(() => setSavedKbSuccess(false), 3500);
    } catch (err) {
      setKbError(err instanceof Error ? err.message : (locale === "vi" ? "Lưu vào Knowledge Base thất bại" : "Failed to save to Knowledge Base"));
    } finally {
      setSavingKb(false);
    }
  };

  const handleDownloadMd = () => {
    if (!deliverable) return;
    const safeTitle = task.title
      .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
    const filename = `SOP_${safeTitle || "Document"}_${task.id.slice(0, 8)}.md`;
    const fullContent = `# ${task.title}\n\n` +
      `> **${t.cockpit.taskIdLabel}** #${task.id}  \n` +
      `> **${t.taskDetail.assignedTo}** ${task.assignedTo || "AI Agent"}  \n` +
      `> **${t.taskDetail.createdBy}** ${task.createdBy || "Founder"}  \n` +
      `> **${t.taskDetail.createdAt}** ${task.createdAt ? formatDateTime(task.createdAt, locale) : "-"}  \n` +
      `> **${t.taskDetail.completedAt}** ${task.completedAt ? formatDateTime(task.completedAt, locale) : "-"}  \n` +
      `> **${t.audit.details}:** ${task.riskLevel || "R0"}\n\n` +
      `---\n\n` +
      `## ${t.taskDetail.objective}\n\n` +
      `${task.objective}\n\n` +
      `---\n\n` +
      `## ${t.taskDetail.deliverable}\n\n` +
      `${deliverable}\n`;

    const blob = new Blob([fullContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSendNotification = async () => {
    if (!deliverable) return;
    setSendingNotify(true);
    setNotifyError("");
    try {
      const res = await sendTaskDeliverableNotification(task.id);
      if (res.success) {
        setSentNotifySuccess(res.message || (locale === "vi" ? "Đã gửi thông báo kết quả bàn giao qua Telegram & Email thành công!" : "Deliverable notification sent via Telegram & Email successfully!"));
        setTimeout(() => setSentNotifySuccess(""), 5000);
      } else {
        setNotifyError(res.message || (locale === "vi" ? "Không thể gửi thông báo qua Telegram/Email." : "Could not send notification via Telegram/Email."));
      }
    } catch (err) {
      setNotifyError(err instanceof Error ? err.message : (locale === "vi" ? "Gửi thông báo thất bại" : "Notification send failed"));
    } finally {
      setSendingNotify(false);
    }
  };

  const handleRequeue = async () => {
    setIsRequeuing(true);
    setReviewErrMsg("");
    try {
      await requeueTask(task.id);
      onTaskUpdated();
      onClose();
    } catch (err) {
      setReviewErrMsg(err instanceof Error ? err.message : (locale === "vi" ? "Requeue thất bại" : "Requeue failed"));
    } finally {
      setIsRequeuing(false);
    }
  };

  const handleReviewAction = async (action: "approve" | "reject") => {
    setIsSubmitting(true);
    setReviewErrMsg("");
    setReviewSuccessMsg("");
    try {
      await submitTaskInternalReview(task.id, action, reviewComment);
      setReviewSuccessMsg(
        action === "approve"
          ? (locale === "vi" ? "Đã phê duyệt hoàn tất task thành công!" : "Task approved and completed successfully!")
          : (locale === "vi" ? "Đã từ chối và yêu cầu Agent thực hiện lại task." : "Task rejected, requested Agent to redo.")
      );
      onTaskUpdated();
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err) {
      setReviewErrMsg(err instanceof Error ? err.message : (locale === "vi" ? "Thao tác thất bại." : "Action failed."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-panel shadow-2xl space-y-5 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-4">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyId}
                className="inline-flex items-center gap-1 rounded bg-white/5 px-2 py-0.5 font-mono text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-200 cursor-pointer transition-colors"
              >
                <span>#{task.id.slice(0, 10)}</span>
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 opacity-60" />}
              </button>
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${visual.bg} ${visual.color} ${visual.border}`}>
                {visual.icon}
                {statusLabel}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs ${riskVisual.badgeClass}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${riskVisual.dotClass}`} />
                {riskLabel}
              </span>
              {task.reviewNeededByRole && task.reviewNeededByRole !== "none" && (
                <span className="inline-flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 font-mono text-xs text-purple-300">
                  <Shield className="h-3 w-3" />
                  {t.taskDetail.reviewBadge} {task.reviewNeededByRole}
                </span>
              )}
              {hasDeliverable && (
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-xs text-emerald-400">
                  <Sparkles className="h-3 w-3" />
                  {t.taskDetail.hasSopBadge}
                </span>
              )}
            </div>
            <h2 className="text-lg font-semibold text-zinc-100">{task.title}</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 shrink-0 cursor-pointer transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 2-Block Parallel Grid: Objective (Left) & Deliverable (Right) */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Block 1: Objective */}
          <div className="flex flex-col rounded-xl border border-border/70 bg-panel/80 p-3.5 space-y-2">
            <div className="flex items-center justify-between pb-1.5 border-b border-border/50">
              <div className="flex items-center gap-1.5 font-semibold text-zinc-200 text-xs">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-blue-500/15 text-blue-400">
                  <FileText className="h-3.5 w-3.5" />
                </span>
                <span>{t.taskDetail.objective}</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">
                {t.taskDetail.createdBy} <strong className="text-zinc-300">{task.createdBy}</strong>
              </span>
            </div>
            <div className="flex-1 min-h-[140px] max-h-[300px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-950/70 p-3 font-sans text-xs text-zinc-200 leading-relaxed border border-border/40">
              {task.objective}
            </div>
          </div>

          {/* Block 2: Deliverables */}
          <div className="flex flex-col rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1.5 border-b border-emerald-500/20">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-400 text-xs">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-500/20 text-emerald-400">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <span>{t.taskDetail.deliverable}</span>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-1">
                {(hasDeliverable || task.status === "COMPLETED") && (
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(true)}
                    title={locale === "vi" ? "Chỉnh sửa nội dung kết quả bàn giao" : "Edit deliverable output content"}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/25 hover:text-amber-200 transition-all cursor-pointer"
                  >
                    <Edit3 className="h-3 w-3 text-amber-400" />
                    <span>{t.taskDetail.editDeliverable}</span>
                  </button>
                )}

                {hasDeliverable && (
                  <>
                    <button
                      type="button"
                      onClick={handleCopyResult}
                      title={locale === "vi" ? "Sao chép toàn bộ nội dung" : "Copy entire deliverable"}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-medium transition-all cursor-pointer ${
                        copiedResult
                          ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-300"
                          : "border-border/80 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-zinc-100"
                      }`}
                    >
                      {copiedResult ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 text-zinc-400" />}
                      <span>{copiedResult ? t.taskDetail.copiedDeliverable : t.taskDetail.copyDeliverable}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveToKb}
                      disabled={savingKb}
                      title={locale === "vi" ? "Lưu vào Knowledge Base" : "Save to Knowledge Base"}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-medium transition-all cursor-pointer disabled:opacity-50 ${
                        savedKbSuccess
                          ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-300"
                          : "border-purple-500/40 bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 hover:text-purple-200"
                      }`}
                    >
                      {savingKb ? <Loader2 className="h-3 w-3 animate-spin" /> : savedKbSuccess ? <Check className="h-3 w-3 text-emerald-400" /> : <BookOpen className="h-3 w-3 text-purple-400" />}
                      <span>{savedKbSuccess ? t.taskDetail.savedToKb : t.taskDetail.saveToKb}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadMd}
                      title={locale === "vi" ? "Tải file Markdown (.md)" : "Download Markdown (.md)"}
                      className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-zinc-300 hover:bg-white/10 hover:text-zinc-100 transition-all cursor-pointer"
                    >
                      <Download className="h-3 w-3 text-zinc-400" />
                      <span>{t.taskDetail.downloadMd}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSendNotification}
                      disabled={sendingNotify}
                      title={locale === "vi" ? "Gửi thông báo qua Telegram/Email" : "Send notification via Telegram/Email"}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-medium transition-all cursor-pointer disabled:opacity-50 ${
                        sentNotifySuccess
                          ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-300"
                          : "border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 hover:text-sky-200"
                      }`}
                    >
                      {sendingNotify ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>{t.taskDetail.sendingNotify}</span>
                        </>
                      ) : sentNotifySuccess ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span>{t.taskDetail.notifySent}</span>
                        </>
                      ) : (
                        <>
                          <Send className="h-3 w-3 text-sky-400" />
                          <span>{t.taskDetail.sendNotify}</span>
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>

            {kbError && (
              <p className="text-[11px] text-rose-400 bg-rose-500/10 p-1.5 rounded border border-rose-500/20">
                {kbError}
              </p>
            )}

            {savedKbSuccess && (
              <p className="text-[11px] text-emerald-300 bg-emerald-500/20 p-1.5 rounded border border-emerald-500/40 flex items-center gap-1">
                <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                <span>{locale === "vi" ? "Đã lưu vào Knowledge Base (/knowledge) cho toàn bộ AI Agents!" : "Saved to Knowledge Base (/knowledge) for all AI Agents!"}</span>
              </p>
            )}

            {notifyError && (
              <p className="text-[11px] text-rose-400 bg-rose-500/10 p-1.5 rounded border border-rose-500/20 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-rose-400 shrink-0" />
                <span>{notifyError}</span>
              </p>
            )}

            {sentNotifySuccess && (
              <p className="text-[11px] text-sky-300 bg-sky-500/20 p-1.5 rounded border border-sky-500/40 flex items-center gap-1">
                <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                <span>{sentNotifySuccess}</span>
              </p>
            )}

            <div className="flex-1 min-h-[140px] max-h-[340px] overflow-hidden rounded-lg bg-zinc-950/80 p-3 font-sans text-xs text-zinc-200 leading-relaxed border border-emerald-500/20 flex flex-col">
              {hasDeliverable ? (
                <div className="overflow-y-auto max-h-[300px] whitespace-pre-wrap font-sans text-xs text-zinc-100 leading-relaxed pr-1">
                  {deliverable}
                </div>
              ) : task.status === "COMPLETED" ? (
                <div className="flex h-full min-h-[120px] flex-col items-center justify-center text-center text-zinc-500">
                  <CheckCircle2 className="h-6 w-6 text-emerald-400/60 mb-1" />
                  <p className="text-xs text-zinc-400 font-medium">{locale === "vi" ? "Task đã hoàn tất thành công." : "Task completed successfully."}</p>
                  <p className="text-[11px] text-zinc-500 mb-2">{t.taskDetail.taskCompletedNoOutput}</p>
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(true)}
                    className="inline-flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-xs text-amber-300 hover:bg-amber-500/25 transition-colors cursor-pointer"
                  >
                    <Edit3 className="h-3 w-3" />
                    <span>{t.taskDetail.composeOutput}</span>
                  </button>
                </div>
              ) : task.status === "RUNNING" ? (
                <div className="flex h-full min-h-[120px] flex-col items-center justify-center text-center text-accent">
                  <Loader2 className="h-6 w-6 animate-spin text-accent mb-1.5" />
                  <p className="text-xs font-semibold text-accent">{t.taskDetail.agentExecuting}</p>
                  <p className="text-[11px] text-zinc-500">{t.taskDetail.agentExecutingDesc}</p>
                </div>
              ) : (
                <div className="flex h-full min-h-[120px] flex-col items-center justify-center text-center text-zinc-500">
                  <Clock className="h-6 w-6 text-zinc-600 mb-1" />
                  <p className="text-xs text-zinc-400">{t.taskDetail.noDeliverableYet}</p>
                  <p className="text-[11px] text-zinc-500">{t.common.status}: {statusLabel}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Requeue Box if ESCALATED or BLOCKED */}
        {isRequeueable && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs">
            <div className="space-y-0.5">
              <p className="font-semibold text-amber-300 flex items-center gap-1.5">
                <RotateCcw className="h-3.5 w-3.5 text-accent" />
                {locale === "vi" ? `Task đang ${task.status}` : `Task is currently ${task.status}`}
              </p>
              <p className="text-[11px] text-zinc-400 leading-normal">
                {t.taskDetail.requeueDesc}
              </p>
            </div>
            <button
              type="button"
              disabled={isRequeuing}
              onClick={handleRequeue}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black hover:bg-accent/90 transition-colors shrink-0 disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {isRequeuing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {t.taskDetail.requeueTask}
            </button>
          </div>
        )}

        {/* Internal Review History Notes (if any) */}
        {task.internalReviewNotes && (
          <div className="space-y-1.5 rounded-xl border border-purple-500/30 bg-purple-950/15 p-4 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-purple-300">
              <MessageSquare className="h-3.5 w-3.5" />
              {locale === "vi" ? "Lịch sử ghi chú đánh giá nội bộ (Internal Review Notes):" : "Internal Review Notes History:"}
            </div>
            <div className="whitespace-pre-wrap rounded-lg bg-black/30 p-3 font-mono text-[11px] text-purple-200 leading-relaxed max-h-36 overflow-y-auto border border-purple-500/20">
              {task.internalReviewNotes}
            </div>
          </div>
        )}

        {/* Action Panel for AWAITING_INTERNAL_REVIEW */}
        {isAwaitingReview && (
          <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-amber-300">
              <Sparkles className="h-4 w-4" />
              {t.taskDetail.internalReviewTitle}
            </div>
            <p className="text-zinc-400 text-[11px]">
              {t.taskDetail.internalReviewDesc}
            </p>

            <textarea
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              placeholder={t.taskDetail.internalReviewNotesPlaceholder}
              rows={2}
              className="w-full rounded-lg border border-border/80 bg-canvas/90 p-2.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none transition-colors focus:border-amber-500"
            />

            {reviewErrMsg && (
              <p className="text-xs text-danger font-medium">{reviewErrMsg}</p>
            )}
            {reviewSuccessMsg && (
              <p className="text-xs text-emerald-400 font-medium">{reviewSuccessMsg}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleReviewAction("reject")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {t.taskDetail.rejectAction}
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleReviewAction("approve")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {t.taskDetail.approveAction}
              </button>
            </div>
          </div>
        )}

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-border/60 bg-canvas/40 p-3 space-y-1">
            <p className="text-[11px] text-zinc-500">{t.taskDetail.assignedTo}</p>
            {task.assignedTo ? (
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-200 font-mono">{task.assignedTo}</span>
                <Link
                  href={`/agents?id=${task.assignedTo}`}
                  className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                >
                  {t.common.viewDetails} <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <span className="text-zinc-500 font-mono">{locale === "vi" ? "Chưa gán" : "Unassigned"}</span>
            )}
          </div>

          <div className="rounded-xl border border-border/60 bg-canvas/40 p-3 space-y-1">
            <p className="text-[11px] text-zinc-500">{t.taskDetail.createdBy}</p>
            <p className="font-semibold text-zinc-200">{task.createdBy}</p>
          </div>

          <div className="rounded-xl border border-border/60 bg-canvas/40 p-3 space-y-1">
            <p className="text-[11px] text-zinc-500">{t.taskDetail.createdAt}</p>
            <p className="font-mono text-zinc-300">{formatTimestamp(task.createdAt, locale)}</p>
          </div>

          <div className="rounded-xl border border-border/60 bg-canvas/40 p-3 space-y-1">
            <p className="text-[11px] text-zinc-500">{t.taskDetail.completedAt}</p>
            <p className="font-mono text-zinc-300">{formatTimestamp(task.completedAt, locale)}</p>
          </div>
        </div>

        {/* Parent / Subtasks */}
        {parentTask && (
          <div className="space-y-1.5 text-xs">
            <p className="text-[11px] text-zinc-500">{t.taskDetail.parentGoal}</p>
            <button
              type="button"
              onClick={() => onSelectTask(parentTask)}
              className="flex w-full items-center justify-between rounded-lg border border-border/60 bg-canvas/60 p-2.5 text-left hover:border-zinc-600 text-zinc-300 cursor-pointer"
            >
              <span className="font-medium truncate">{parentTask.title}</span>
              <span className="text-accent text-[11px] shrink-0">→</span>
            </button>
          </div>
        )}

        {subTasks.length > 0 && (
          <div className="space-y-2 text-xs">
            <p className="text-[11px] text-zinc-500">{t.taskDetail.subTasks} ({subTasks.length}):</p>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {subTasks.map((sub) => {
                const subVisual = STATUS_VISUALS[sub.status] ?? STATUS_VISUALS.NEW;
                const subLabel = t.kanban.statuses[sub.status] || sub.status;
                return (
                  <button
                    type="button"
                    key={sub.id}
                    onClick={() => onSelectTask(sub)}
                    className="flex w-full items-center justify-between rounded-lg border border-border/60 bg-canvas/60 px-3 py-2 text-left hover:border-zinc-600 transition-colors cursor-pointer"
                  >
                    <span className="truncate text-zinc-200 text-xs">{sub.title}</span>
                    <span className={`rounded px-1.5 py-0.2 text-[10px] font-medium shrink-0 ml-2 ${subVisual.color}`}>
                      {subLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-border/60 pt-4">
          {task.assignedTo && (
            <Link
              href={`/agents?id=${task.assignedTo}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10 hover:text-zinc-100 transition-colors"
            >
              {t.taskDetail.agentDetailsLink}
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg bg-zinc-200 px-4 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white transition-colors cursor-pointer"
          >
            {t.common.close}
          </button>
        </div>
      </div>

      {/* Deliverable Edit Modal */}
      <DeliverableEditModal
        task={task}
        initialText={deliverable}
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSaved={(newText) => {
          setTaskOverride(newText);
          onTaskUpdated();
        }}
      />
    </div>
  );
}

// ---- Column -------------------------------------------------------------

function KanbanColumn({
  status,
  tasks,
  childMap,
  onSelect,
  onRequeued,
}: {
  status: TaskStatus;
  tasks: Task[];
  childMap: Map<string, Task[]>;
  onSelect: (t: Task) => void;
  onRequeued?: () => void;
}) {
  const { t } = useI18n();
  const visual = STATUS_VISUALS[status] ?? STATUS_VISUALS.NEW;
  const statusLabel = t.kanban.statuses[status] || status;
  if (tasks.length === 0) return null;

  return (
    <div className="min-w-[220px] flex-1 space-y-2">
      {/* Column header */}
      <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 border ${visual.bg} ${visual.border}`}>
        <span className={visual.color}>{visual.icon}</span>
        <span className={`text-xs font-semibold ${visual.color}`}>{statusLabel}</span>
        <span className={`ml-auto rounded-full px-2 py-0.2 text-[10px] font-mono font-bold ${visual.color} bg-black/20`}>
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {tasks.map((task) => {
          const subs = childMap.get(task.id) ?? [];
          return (
            <TaskCard key={task.id} task={task} onSelect={onSelect} onRequeued={onRequeued}>
              {subs.length > 0
                ? subs.map((sub) => (
                    <TaskCard key={sub.id} task={sub} onSelect={onSelect} onRequeued={onRequeued} />
                  ))
                : undefined}
            </TaskCard>
          );
        })}
      </div>
    </div>
  );
}

// ---- Main export --------------------------------------------------------

export interface TaskKanbanProps {
  /** Được gọi từ parent khi có WS event — component tự re-fetch */
  refreshSignal?: unknown;
  /** Callback thông báo parent khi task có sự thay đổi (requeue, review...) */
  onChanged?: () => void;
  tasks?: Task[];
  agents?: Agent[];
}

export function TaskKanban({ refreshSignal, onChanged }: TaskKanbanProps) {
  const { t, locale } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<"all" | "running" | "review" | "issues" | "has_sop" | "completed">("all");
  const [selectedAgent, setSelectedAgent] = useState<string>("all");
  const [selectedRisk, setSelectedRisk] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedTimeRange, setSelectedTimeRange] = useState<"all" | "today" | "24h" | "7d" | "30d">("all");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await fetchTasks();
      setTasks(data as Task[]);
    } catch (err) {
      if (err instanceof Error && err.message !== "Unauthorized") {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUpdated = useCallback(() => {
    load();
    onChanged?.();
  }, [load, onChanged]);

  // Initial load
  useEffect(() => {
    load();
  }, [load]);

  // Re-fetch whenever parent signals a WS event
  useEffect(() => {
    if (refreshSignal !== undefined) load();
  }, [refreshSignal, load]);

  // Extract unique agents from tasks list
  const uniqueAgents = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => {
      if (t.assignedTo && t.assignedTo.trim()) set.add(t.assignedTo.trim());
    });
    return Array.from(set).sort();
  }, [tasks]);

  // Calculate quick metrics for filter badges
  const metrics = useMemo(() => {
    let running = 0;
    let review = 0;
    let issues = 0;
    let hasSop = 0;
    let completed = 0;

    tasks.forEach((t) => {
      if (t.status === "RUNNING") running++;
      if (t.status === "AWAITING_INTERNAL_REVIEW" || t.status === "AWAITING_APPROVAL") review++;
      if (t.status === "BLOCKED" || t.status === "ESCALATED") issues++;
      if (cleanDeliverableText(t.result)?.trim()) hasSop++;
      if (t.status === "COMPLETED") completed++;
    });

    return { running, review, issues, hasSop, completed };
  }, [tasks]);

  // Check if any filter is active
  const isFilterActive =
    searchQuery.trim().length > 0 ||
    quickFilter !== "all" ||
    selectedAgent !== "all" ||
    selectedRisk !== "all" ||
    selectedStatus !== "all" ||
    selectedTimeRange !== "all";

  const handleResetFilters = () => {
    setSearchQuery("");
    setQuickFilter("all");
    setSelectedAgent("all");
    setSelectedRisk("all");
    setSelectedStatus("all");
    setSelectedTimeRange("all");
  };

  // Helper to check if a single task matches all criteria
  const checkTaskMatch = useCallback(
    (t: Task): boolean => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const qClean = q.replace(/^[#@]/, "");
        const matchTitle = t.title.toLowerCase().includes(q);
        const matchObj = t.objective.toLowerCase().includes(q);
        const matchAssigned = (t.assignedTo || "").toLowerCase().includes(qClean);
        const matchId = t.id.toLowerCase().includes(qClean);
        const matchCreated = (t.createdBy || "").toLowerCase().includes(qClean);
        const delivText = cleanDeliverableText(t.result);
        const matchDeliverable = delivText ? delivText.toLowerCase().includes(q) : false;

        if (!matchTitle && !matchObj && !matchAssigned && !matchId && !matchCreated && !matchDeliverable) {
          return false;
        }
      }

      // 2. Quick Filter
      if (quickFilter === "running" && t.status !== "RUNNING") return false;
      if (
        quickFilter === "review" &&
        t.status !== "AWAITING_INTERNAL_REVIEW" &&
        t.status !== "AWAITING_APPROVAL"
      )
        return false;
      if (quickFilter === "issues" && t.status !== "BLOCKED" && t.status !== "ESCALATED") return false;
      if (quickFilter === "has_sop") {
        const deliv = cleanDeliverableText(t.result);
        if (!deliv || deliv.trim().length === 0) return false;
      }
      if (quickFilter === "completed" && t.status !== "COMPLETED") return false;

      // 3. Agent Filter
      if (selectedAgent !== "all" && t.assignedTo !== selectedAgent) return false;

      // 4. Risk Filter
      if (selectedRisk !== "all" && t.riskLevel !== selectedRisk) return false;

      // 5. Status Filter
      if (selectedStatus !== "all" && t.status !== selectedStatus) return false;

      // 6. Time Range Filter (createdAt)
      if (selectedTimeRange !== "all" && t.createdAt) {
        const taskTime = new Date(t.createdAt).getTime();
        const now = Date.now();
        if (isNaN(taskTime)) return false;

        if (selectedTimeRange === "today") {
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          if (taskTime < startOfToday.getTime()) return false;
        } else if (selectedTimeRange === "24h") {
          if (taskTime < now - 24 * 60 * 60 * 1000) return false;
        } else if (selectedTimeRange === "7d") {
          if (taskTime < now - 7 * 24 * 60 * 60 * 1000) return false;
        } else if (selectedTimeRange === "30d") {
          if (taskTime < now - 30 * 24 * 60 * 60 * 1000) return false;
        }
      }

      return true;
    },
    [searchQuery, quickFilter, selectedAgent, selectedRisk, selectedStatus, selectedTimeRange]
  );

  // Raw maps
  const rootTasks = useMemo(() => tasks.filter((t) => !t.parentTaskId), [tasks]);
  const rawChildMap = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks
      .filter((t) => t.parentTaskId)
      .forEach((t) => {
        const sibs = map.get(t.parentTaskId!) ?? [];
        sibs.push(t);
        map.set(t.parentTaskId!, sibs);
      });
    return map;
  }, [tasks]);

  // Filtered root tasks & child map
  const { filteredRootTasks, filteredChildMap, totalDisplayedCount } = useMemo(() => {
    if (!isFilterActive) {
      return {
        filteredRootTasks: rootTasks,
        filteredChildMap: rawChildMap,
        totalDisplayedCount: tasks.length,
      };
    }

    const filteredRoots: Task[] = [];
    const childMapResult = new Map<string, Task[]>();
    let count = 0;

    rootTasks.forEach((root) => {
      const children = rawChildMap.get(root.id) ?? [];
      const matchingChildren = children.filter(checkTaskMatch);
      const rootMatches = checkTaskMatch(root);

      if (rootMatches || matchingChildren.length > 0) {
        filteredRoots.push(root);
        if (rootMatches) count++;
        count += matchingChildren.length;

        childMapResult.set(
          root.id,
          matchingChildren.length > 0 ? matchingChildren : children
        );
      }
    });

    return {
      filteredRootTasks: filteredRoots,
      filteredChildMap: childMapResult,
      totalDisplayedCount: count,
    };
  }, [isFilterActive, rootTasks, rawChildMap, tasks.length, checkTaskMatch]);

  // Group filtered root tasks by status
  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const status of COLUMN_ORDER) map.set(status, []);
    for (const task of filteredRootTasks) {
      const col = map.get(task.status as TaskStatus);
      if (col) col.push(task);
    }
    return map;
  }, [filteredRootTasks]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin text-accent" />
        {t.common.loading}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
        <span>{error}</span>
        <button type="button" onClick={load} className="ml-3 shrink-0 hover:opacity-80 cursor-pointer">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-panel/40 p-8 text-center text-sm text-zinc-500">
        <p className="font-medium text-zinc-300">{t.kanban.emptyBoard.title}</p>
        <p className="mt-1 text-xs text-zinc-500">
          {locale === "vi" ? (
            <>
              Nhấn <kbd className="rounded bg-white/10 px-1.5 py-0.5">⌘K</kbd> và gõ{" "}
              <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-accent">/goal</code> hoặc{" "}
              <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-accent">/do</code> để bắt đầu.
            </>
          ) : (
            <>
              Press <kbd className="rounded bg-white/10 px-1.5 py-0.5">⌘K</kbd> and type{" "}
              <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-accent">/goal</code> or{" "}
              <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-accent">/do</code> to get started.
            </>
          )}
        </p>
      </div>
    );
  }

  const activeColumns = COLUMN_ORDER.filter((s) => (byStatus.get(s)?.length ?? 0) > 0);

  return (
    <>
      {/* Search & Filter Toolbar */}
      <div className="mb-4 space-y-3 rounded-2xl border border-border/80 bg-canvas/70 p-3.5 backdrop-blur-md shadow-sm">
        {/* Top Row: Search input + Counter badge + Reset */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.kanban.searchPlaceholder}
              className="w-full rounded-xl border border-border/70 bg-panel/90 py-2 pl-9 pr-9 text-xs text-zinc-100 placeholder-zinc-500 outline-none transition-all focus:border-accent focus:ring-1 focus:ring-accent"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-200"
                title={t.kanban.clearSearch}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-panel/60 px-3 py-1.5 text-xs text-zinc-300 font-mono">
              <span className="text-zinc-500">{t.kanban.displaying}</span>
              <strong className="text-accent">{totalDisplayedCount}</strong>
              <span className="text-zinc-500">/ {tasks.length}</span>
            </span>

            {isFilterActive && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition-all cursor-pointer shadow-sm"
                title={t.kanban.emptyState.resetBtn}
              >
                <RotateCcw className="h-3.5 w-3.5 text-rose-400" />
                <span>{t.kanban.clearFilter}</span>
              </button>
            )}
          </div>
        </div>

        {/* Middle Row: 1-Click Quick Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2.5">
          <button
            type="button"
            onClick={() => setQuickFilter("all")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer border ${
              quickFilter === "all"
                ? "border-accent bg-accent/15 text-accent shadow-sm"
                : "border-border/60 bg-panel/40 text-zinc-400 hover:bg-panel hover:text-zinc-200"
            }`}
          >
            <Zap className="h-3 w-3" />
            <span>{t.kanban.quickFilters.all}</span>
            <span className="rounded-full bg-black/30 px-1.5 py-0.2 text-[10px] font-mono">{tasks.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "running" ? "all" : "running")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer border ${
              quickFilter === "running"
                ? "border-accent bg-accent/20 text-accent font-semibold shadow-sm"
                : "border-accent/30 bg-accent/5 text-accent/80 hover:bg-accent/10 hover:text-accent"
            }`}
          >
            <PlayCircle className="h-3 w-3 animate-pulse" />
            <span>{t.kanban.quickFilters.running}</span>
            <span className="rounded-full bg-accent/20 px-1.5 py-0.2 text-[10px] font-mono text-accent">
              {metrics.running}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "review" ? "all" : "review")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer border ${
              quickFilter === "review"
                ? "border-purple-500/60 bg-purple-500/25 text-purple-200 font-semibold shadow-sm"
                : "border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/15 hover:text-purple-200"
            }`}
          >
            <Shield className="h-3 w-3" />
            <span>{t.kanban.quickFilters.review}</span>
            <span className="rounded-full bg-purple-500/20 px-1.5 py-0.2 text-[10px] font-mono text-purple-300">
              {metrics.review}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "issues" ? "all" : "issues")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer border ${
              quickFilter === "issues"
                ? "border-rose-500/60 bg-rose-500/25 text-rose-200 font-semibold shadow-sm"
                : "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
            }`}
          >
            <AlertTriangle className="h-3 w-3" />
            <span>{t.kanban.quickFilters.issues}</span>
            <span className="rounded-full bg-rose-500/20 px-1.5 py-0.2 text-[10px] font-mono text-rose-300">
              {metrics.issues}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "has_sop" ? "all" : "has_sop")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer border ${
              quickFilter === "has_sop"
                ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-200 font-semibold shadow-sm"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200"
            }`}
          >
            <Sparkles className="h-3 w-3" />
            <span>{t.kanban.quickFilters.hasSop}</span>
            <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[10px] font-mono text-emerald-300">
              {metrics.hasSop}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "completed" ? "all" : "completed")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer border ${
              quickFilter === "completed"
                ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-200 font-semibold shadow-sm"
                : "border-border/60 bg-panel/40 text-zinc-400 hover:bg-panel hover:text-zinc-200"
            }`}
          >
            <CheckCircle2 className="h-3 w-3" />
            <span>{t.kanban.quickFilters.completed}</span>
            <span className="rounded-full bg-black/30 px-1.5 py-0.2 text-[10px] font-mono">{metrics.completed}</span>
          </button>
        </div>

        {/* Bottom Row: Advanced Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2.5 text-xs">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-[11px] font-medium text-zinc-400">{t.kanban.detailFilters.label}</span>
          </div>

          {/* Agent Filter */}
          <div className="relative">
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className={`rounded-lg border bg-panel px-2.5 py-1 text-xs outline-none transition-all cursor-pointer ${
                selectedAgent !== "all"
                  ? "border-accent text-accent font-medium bg-accent/5"
                  : "border-border/70 text-zinc-300 hover:border-zinc-500"
              }`}
            >
              <option value="all">🤖 {t.nav.orgChart} ({uniqueAgents.length})</option>
              {uniqueAgents.map((ag) => (
                <option key={ag} value={ag}>
                  @{ag}
                </option>
              ))}
            </select>
          </div>

          {/* Risk Level Filter */}
          <div className="relative">
            <select
              value={selectedRisk}
              onChange={(e) => setSelectedRisk(e.target.value)}
              className={`rounded-lg border bg-panel px-2.5 py-1 text-xs outline-none transition-all cursor-pointer ${
                selectedRisk !== "all"
                  ? "border-amber-400 text-amber-300 font-medium bg-amber-400/5"
                  : "border-border/70 text-zinc-300 hover:border-zinc-500"
              }`}
            >
              <option value="all">{t.kanban.detailFilters.allRisks}</option>
              <option value="R0">{t.kanban.risks.R0}</option>
              <option value="R1">{t.kanban.risks.R1}</option>
              <option value="R2">{t.kanban.risks.R2}</option>
              <option value="R3">{t.kanban.risks.R3}</option>
              <option value="R4">{t.kanban.risks.R4}</option>
            </select>
          </div>

          {/* Detailed Status Filter */}
          <div className="relative">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className={`rounded-lg border bg-panel px-2.5 py-1 text-xs outline-none transition-all cursor-pointer ${
                selectedStatus !== "all"
                  ? "border-sky-400 text-sky-300 font-medium bg-sky-400/5"
                  : "border-border/70 text-zinc-300 hover:border-zinc-500"
              }`}
            >
              <option value="all">{t.kanban.detailFilters.allStatuses}</option>
              {COLUMN_ORDER.map((st) => (
                <option key={st} value={st}>
                  {t.kanban.statuses[st] || st}
                </option>
              ))}
            </select>
          </div>

          {/* Time Range Filter */}
          <div className="relative">
            <select
              value={selectedTimeRange}
              onChange={(e) => setSelectedTimeRange(e.target.value as any)}
              className={`rounded-lg border bg-panel px-2.5 py-1 text-xs outline-none transition-all cursor-pointer ${
                selectedTimeRange !== "all"
                  ? "border-emerald-400 text-emerald-300 font-medium bg-emerald-400/5"
                  : "border-border/70 text-zinc-300 hover:border-zinc-500"
              }`}
            >
              <option value="all">{t.kanban.detailFilters.timeRange}</option>
              <option value="today">{t.kanban.detailFilters.today}</option>
              <option value="24h">{t.kanban.detailFilters.last24h}</option>
              <option value="7d">{t.kanban.detailFilters.last7d}</option>
              <option value="30d">{t.kanban.detailFilters.last30d}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Empty State when 0 tasks match current filter */}
      {filteredRootTasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/80 bg-panel/30 p-10 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-zinc-400 border border-white/10">
            <Search className="h-6 w-6 text-zinc-500" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-zinc-200">{t.kanban.emptyState.title}</p>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto">
              {t.kanban.emptyState.desc}
            </p>
          </div>
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black hover:bg-accent/90 transition-all cursor-pointer shadow-md shadow-accent/20"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{t.kanban.emptyState.resetBtn}</span>
          </button>
        </div>
      ) : (
        /* Kanban Board Columns */
        <div className="overflow-x-auto">
          <div className="flex min-w-max gap-3 pb-1">
            {activeColumns.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                tasks={byStatus.get(status) ?? []}
                childMap={filteredChildMap}
                onSelect={(t) => setSelectedTask(t)}
                onRequeued={handleUpdated}
              />
            ))}
          </div>
        </div>
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          allTasks={tasks}
          onClose={() => setSelectedTask(null)}
          onSelectTask={(t) => setSelectedTask(t)}
          onTaskUpdated={handleUpdated}
        />
      )}
    </>
  );
}
