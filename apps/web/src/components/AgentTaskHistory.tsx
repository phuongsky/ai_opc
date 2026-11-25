"use client";

import { useState, useMemo } from "react";
import {
  ListChecks,
  CheckCircle2,
  PlayCircle,
  Clock,
  AlertTriangle,
  Circle,
  Search,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Calendar,
  Layers,
  Timer,
  FileText,
  User,
  Shield,
  MessageSquare,
  Sparkles,
  Download,
  BookOpen,
  Loader2,
  Send,
  Mail,
  Edit3,
  Save,
  X,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type { Task, TaskStatus, RiskLevel } from "@ai-opc/shared";
import { cleanDeliverableText } from "@ai-opc/shared";
import {
  ingestKnowledgeDoc,
  sendTaskDeliverableNotification,
  updateTaskDeliverable,
  requeueTask,
} from "@/lib/api";
import { DeliverableEditModal } from "./DeliverableEditModal";


// ---- Status Config ---------------------------------------------------------

const STATUS_MAP: Record<
  TaskStatus | string,
  { label: string; icon: React.ReactNode; badgeClass: string; dotClass: string }
> = {
  RUNNING: {
    label: "Đang chạy",
    icon: <PlayCircle className="h-3.5 w-3.5 text-accent animate-pulse" />,
    badgeClass: "bg-accent/10 text-accent border-accent/30",
    dotClass: "bg-accent animate-pulse",
  },
  COMPLETED: {
    label: "Hoàn thành",
    icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    dotClass: "bg-emerald-400",
  },
  AWAITING_APPROVAL: {
    label: "Chờ Founder duyệt",
    icon: <Clock className="h-3.5 w-3.5 text-warn" />,
    badgeClass: "bg-warn/10 text-warn border-warn/30",
    dotClass: "bg-warn",
  },
  AWAITING_INTERNAL_REVIEW: {
    label: "Chờ đánh giá nội bộ",
    icon: <Shield className="h-3.5 w-3.5 text-purple-400" />,
    badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/30",
    dotClass: "bg-purple-400",
  },
  BLOCKED: {
    label: "Bị chặn",
    icon: <AlertTriangle className="h-3.5 w-3.5 text-danger" />,
    badgeClass: "bg-danger/10 text-danger border-danger/30",
    dotClass: "bg-danger",
  },
  ESCALATED: {
    label: "Leo thang",
    icon: <AlertTriangle className="h-3.5 w-3.5 text-danger" />,
    badgeClass: "bg-danger/10 text-danger border-danger/30",
    dotClass: "bg-danger",
  },
  PLANNED: {
    label: "Kế hoạch",
    icon: <Clock className="h-3.5 w-3.5 text-blue-400" />,
    badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    dotClass: "bg-blue-400",
  },
  ASSIGNED: {
    label: "Đã giao",
    icon: <Clock className="h-3.5 w-3.5 text-sky-400" />,
    badgeClass: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    dotClass: "bg-sky-400",
  },
  NEW: {
    label: "Mới",
    icon: <Circle className="h-3.5 w-3.5 text-zinc-400" />,
    badgeClass: "bg-zinc-800 text-zinc-400 border-zinc-700/50",
    dotClass: "bg-zinc-400",
  },
  TRIAGED: {
    label: "Đã phân loại",
    icon: <Circle className="h-3.5 w-3.5 text-zinc-300" />,
    badgeClass: "bg-zinc-800 text-zinc-300 border-zinc-700/50",
    dotClass: "bg-zinc-300",
  },
  VERIFYING: {
    label: "Đang kiểm tra",
    icon: <Clock className="h-3.5 w-3.5 text-cyan-400 animate-spin" />,
    badgeClass: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    dotClass: "bg-cyan-400",
  },
  TRASH: {
    label: "Thùng rác",
    icon: <Trash2 className="h-3.5 w-3.5 text-rose-400" />,
    badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    dotClass: "bg-rose-400",
  },
};

const RISK_BADGES: Record<
  RiskLevel | string,
  { label: string; badgeClass: string; dotClass: string }
> = {
  R0: {
    label: "R0 · An toàn",
    badgeClass: "bg-zinc-800/80 text-zinc-400 border-zinc-700/50",
    dotClass: "bg-zinc-400",
  },
  R1: {
    label: "R1 · Thấp",
    badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    dotClass: "bg-blue-400",
  },
  R2: {
    label: "R2 · Trung bình",
    badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dotClass: "bg-amber-400",
  },
  R3: {
    label: "R3 · Cao",
    badgeClass: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    dotClass: "bg-orange-400",
  },
  R4: {
    label: "R4 · Nghiêm trọng",
    badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    dotClass: "bg-rose-400",
  },
};

function formatTime(iso?: string | null) {
  if (!iso) return { time: "-", date: "" };
  try {
    const d = new Date(iso);
    const time = d.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const date = d.toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    return { time, date };
  } catch {
    return { time: iso, date: "" };
  }
}

function calculateDuration(startIso?: string | null, endIso?: string | null): string | null {
  if (!startIso || !endIso) return null;
  try {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    const diffMs = Math.max(0, end - start);
    if (diffMs < 1000) return `${diffMs}ms`;
    if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`;
    const mins = Math.floor(diffMs / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);
    return `${mins}m ${secs}s`;
  } catch {
    return null;
  }
}

type TaskFilterStatus = "ALL" | "RUNNING" | "COMPLETED" | "INTERNAL_REVIEW" | "APPROVAL_BLOCKED";

export function AgentTaskHistory({ tasks, onRefresh }: { tasks: Task[]; onRefresh?: () => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TaskFilterStatus>("ALL");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);

  // States for Deliverable Actions & Modal Editing
  const [taskOverrides, setTaskOverrides] = useState<{ [id: string]: string }>({});
  const [modalTask, setModalTask] = useState<Task | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const [copiedResultTaskId, setCopiedResultTaskId] = useState<string | null>(null);
  const [savingKbTaskId, setSavingKbTaskId] = useState<string | null>(null);
  const [savedKbSuccessTaskId, setSavedKbSuccessTaskId] = useState<string | null>(null);
  const [kbErrors, setKbErrors] = useState<{ [id: string]: string }>({});

  // States for Notification Actions
  const [sendingNotifyTaskId, setSendingNotifyTaskId] = useState<string | null>(null);
  const [sentNotifySuccess, setSentNotifySuccess] = useState<{ [id: string]: string }>({});
  const [notifyErrors, setNotifyErrors] = useState<{ [id: string]: string }>({});

  // States for Requeue Actions
  const [requeuingTaskId, setRequeuingTaskId] = useState<string | null>(null);
  const [requeueSuccessTaskId, setRequeueSuccessTaskId] = useState<string | null>(null);
  const [requeueErrorTaskId, setRequeueErrorTaskId] = useState<{ [id: string]: string }>({});

  const handleRequeue = async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    setRequeuingTaskId(task.id);
    setRequeueErrorTaskId((prev) => ({ ...prev, [task.id]: "" }));
    try {
      await requeueTask(task.id);
      setRequeueSuccessTaskId(task.id);
      setTimeout(() => setRequeueSuccessTaskId(null), 3500);
      onRefresh?.();
    } catch (err) {
      setRequeueErrorTaskId((prev) => ({
        ...prev,
        [task.id]: err instanceof Error ? err.message : "Chạy lại task thất bại.",
      }));
    } finally {
      setRequeuingTaskId(null);
    }
  };

  const getDeliverableText = (task: Task) => {
    if (taskOverrides[task.id] !== undefined) {
      return taskOverrides[task.id];
    }
    return cleanDeliverableText(task.result);
  };

  const handleOpenEditModal = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    setModalTask(task);
    setIsEditModalOpen(true);
  };


  // Thống kê nhanh
  const stats = useMemo(() => {
    let running = 0;
    let completed = 0;
    let internalReview = 0;
    let approvalOrBlocked = 0;

    for (const t of tasks) {
      if (t.status === "RUNNING") running++;
      else if (t.status === "COMPLETED") completed++;
      else if (t.status === "AWAITING_INTERNAL_REVIEW") internalReview++;
      else if (t.status === "AWAITING_APPROVAL" || t.status === "BLOCKED" || t.status === "ESCALATED") {
        approvalOrBlocked++;
      }
    }

    return { total: tasks.length, running, completed, internalReview, approvalOrBlocked };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // Filter status
      if (filter === "RUNNING" && t.status !== "RUNNING") return false;
      if (filter === "COMPLETED" && t.status !== "COMPLETED") return false;
      if (filter === "INTERNAL_REVIEW" && t.status !== "AWAITING_INTERNAL_REVIEW") return false;
      if (
        filter === "APPROVAL_BLOCKED" &&
        t.status !== "AWAITING_APPROVAL" &&
        t.status !== "BLOCKED" &&
        t.status !== "ESCALATED"
      ) {
        return false;
      }

      // Search keyword
      if (search.trim()) {
        const q = search.toLowerCase();
        const titleMatch = t.title.toLowerCase().includes(q);
        const objMatch = t.objective.toLowerCase().includes(q);
        const cleanRes = getDeliverableText(t);
        const resMatch = cleanRes ? cleanRes.toLowerCase().includes(q) : false;
        const idMatch = t.id.toLowerCase().includes(q);
        const statusMatch = t.status.toLowerCase().includes(q);
        if (!titleMatch && !objMatch && !resMatch && !idMatch && !statusMatch) return false;
      }

      return true;
    });
  }, [tasks, filter, search, taskOverrides]);

  const toggleExpand = (id: string) => {
    setExpandedTaskId((prev) => (prev === id ? null : id));
  };

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedTaskId(id);
    setTimeout(() => setCopiedTaskId(null), 1500);
  };

  const handleCopyResult = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    const deliverable = getDeliverableText(task);
    if (!deliverable) return;
    navigator.clipboard.writeText(deliverable);
    setCopiedResultTaskId(task.id);
    setTimeout(() => setCopiedResultTaskId(null), 2000);
  };

  const handleSaveToKb = async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    const deliverable = getDeliverableText(task);
    if (!deliverable) return;
    setSavingKbTaskId(task.id);
    setKbErrors((prev) => ({ ...prev, [task.id]: "" }));
    try {
      await ingestKnowledgeDoc(
        `[SOP / Deliverable] ${task.title}`,
        deliverable,
        `Task #${task.id.slice(0, 8)} · Phụ trách: ${task.assignedTo || "AI"}`
      );
      setSavedKbSuccessTaskId(task.id);
      setTimeout(() => setSavedKbSuccessTaskId(null), 3500);
    } catch (err) {
      setKbErrors((prev) => ({
        ...prev,
        [task.id]: err instanceof Error ? err.message : "Lưu vào Knowledge Base thất bại.",
      }));
    } finally {
      setSavingKbTaskId(null);
    }
  };

  const handleDownloadMd = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    const deliverable = getDeliverableText(task);
    if (!deliverable) return;
    const safeTitle = task.title
      .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
    const filename = `SOP_${safeTitle || "Document"}_${task.id.slice(0, 8)}.md`;
    const fullContent = `# ${task.title}\n\n` +
      `> **Mã Task:** #${task.id}  \n` +
      `> **Người phụ trách:** ${task.assignedTo || "AI Agent"}  \n` +
      `> **Người giao:** ${task.createdBy || "Founder"}  \n` +
      `> **Thời gian tạo:** ${task.createdAt ? new Date(task.createdAt).toLocaleString("vi-VN") : "-"}  \n` +
      `> **Hoàn tất lúc:** ${task.completedAt ? new Date(task.completedAt).toLocaleString("vi-VN") : "-"}  \n` +
      `> **Mức rủi ro:** ${task.riskLevel || "R0"}\n\n` +
      `---\n\n` +
      `## 📥 Mục Tiêu Công Việc (Objective)\n\n` +
      `${task.objective}\n\n` +
      `---\n\n` +
      `## 📤 Kết Quả Thực Hiện / Văn Bản Bàn Giao (Agent Output)\n\n` +
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

  const handleSendNotification = async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    const deliverable = getDeliverableText(task);
    if (!deliverable) return;
    setSendingNotifyTaskId(task.id);
    setNotifyErrors((prev) => ({ ...prev, [task.id]: "" }));
    try {
      const res = await sendTaskDeliverableNotification(task.id);
      if (res.success) {
        setSentNotifySuccess((prev) => ({
          ...prev,
          [task.id]: res.message || "Đã gửi thông báo kết quả bàn giao qua Telegram & Email thành công!",
        }));
        setTimeout(() => {
          setSentNotifySuccess((prev) => {
            const next = { ...prev };
            delete next[task.id];
            return next;
          });
        }, 5000);
      } else {
        setNotifyErrors((prev) => ({
          ...prev,
          [task.id]: res.message || "Không thể gửi thông báo qua Telegram/Email.",
        }));
      }
    } catch (err) {
      setNotifyErrors((prev) => ({
        ...prev,
        [task.id]: err instanceof Error ? err.message : "Gửi thông báo thất bại.",
      }));
    } finally {
      setSendingNotifyTaskId(null);
    }
  };


  return (
    <div className="space-y-4">
      {/* Quick Stats Toolbar */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="flex items-center gap-3 rounded-xl border border-border/80 bg-canvas/40 px-3.5 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-zinc-400">
            <ListChecks className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-zinc-500">Tổng số task</p>
            <p className="font-mono text-sm font-semibold text-zinc-200">{stats.total}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-emerald-300/70">Đã hoàn thành</p>
            <p className="font-mono text-sm font-semibold text-emerald-200">{stats.completed}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-purple-500/20 bg-purple-500/5 px-3.5 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
            <Shield className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-purple-300/70">Chờ đánh giá</p>
            <p className="font-mono text-sm font-semibold text-purple-300">{stats.internalReview}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-accent/20 bg-accent/5 px-3.5 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <PlayCircle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-accent/70">Đang thực thi</p>
            <p className="font-mono text-sm font-semibold text-accent">{stats.running}</p>
          </div>
        </div>
      </div>

      {/* Filter Chips & Search Bar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setFilter("ALL")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
              filter === "ALL"
                ? "bg-zinc-200 text-zinc-900 shadow-sm"
                : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
            }`}
          >
            Tất cả
            <span className="rounded-full bg-black/20 px-1.5 py-0.2 text-[10px] font-mono">
              {tasks.length}
            </span>
          </button>

          <button
            onClick={() => setFilter("INTERNAL_REVIEW")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
              filter === "INTERNAL_REVIEW"
                ? "bg-purple-600 text-white shadow-sm"
                : "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
            }`}
          >
            <Shield className="h-3 w-3" />
            Chờ đánh giá ({stats.internalReview})
          </button>

          <button
            onClick={() => setFilter("RUNNING")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
              filter === "RUNNING"
                ? "bg-accent text-black shadow-sm"
                : "bg-accent/10 text-accent hover:bg-accent/20"
            }`}
          >
            <PlayCircle className="h-3 w-3" />
            Đang chạy ({stats.running})
          </button>

          <button
            onClick={() => setFilter("COMPLETED")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
              filter === "COMPLETED"
                ? "bg-emerald-500 text-white shadow-sm"
                : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
            }`}
          >
            <CheckCircle2 className="h-3 w-3" />
            Đã hoàn thành ({stats.completed})
          </button>

          <button
            onClick={() => setFilter("APPROVAL_BLOCKED")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
              filter === "APPROVAL_BLOCKED"
                ? "bg-warn text-black shadow-sm"
                : "bg-warn/10 text-warn hover:bg-warn/20"
            }`}
          >
            <Clock className="h-3 w-3" />
            Chờ duyệt Tool / Blocked ({stats.approvalOrBlocked})
          </button>
        </div>

        {/* Search Box */}
        <div className="relative min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên task, mục tiêu, kết quả..."
            className="w-full rounded-lg border border-border/80 bg-canvas/60 py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder-zinc-500 outline-none transition-colors focus:border-zinc-500 focus:bg-canvas"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 hover:text-zinc-300"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Main Task Table / Stream */}
      <div className="overflow-hidden rounded-xl border border-border/80 bg-panel shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border/80 bg-zinc-900/60 text-[11px] font-medium text-zinc-400">
              <tr>
                <th className="px-3.5 py-3">Task & Mục tiêu</th>
                <th className="w-40 px-3.5 py-3">Trạng thái</th>
                <th className="w-28 px-3.5 py-3">Mức rủi ro</th>
                <th className="w-44 px-3.5 py-3">Thời gian & Thời lượng</th>
                <th className="w-20 px-3.5 py-3 text-right">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredTasks.map((t) => {
                const statusCfg = STATUS_MAP[t.status] ?? STATUS_MAP.NEW;
                const risk = RISK_BADGES[t.riskLevel] ?? RISK_BADGES.R0;
                const isExpanded = expandedTaskId === t.id;
                const { time: createTime, date: createDate } = formatTime(t.createdAt);
                const duration = calculateDuration(t.createdAt, t.completedAt);
                const deliverable = getDeliverableText(t);
                const hasDeliverable = Boolean(deliverable && deliverable.trim());

                return (
                  <tr
                    key={t.id}
                    onClick={() => toggleExpand(t.id)}
                    className={`group cursor-pointer transition-colors hover:bg-white/[0.03] ${
                      isExpanded ? "bg-white/[0.02]" : ""
                    }`}
                  >
                    <td className="px-3.5 py-3 align-top">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={(e) => handleCopyId(t.id, e)}
                            title="Sao chép Task ID"
                            className="inline-flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.2 font-mono text-[10px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                          >
                            <span>#{t.id.slice(0, 8)}</span>
                            {copiedTaskId === t.id ? (
                              <Check className="h-2.5 w-2.5 text-emerald-400" />
                            ) : (
                              <Copy className="h-2.5 w-2.5 opacity-60" />
                            )}
                          </button>
                          <h3 className="font-medium text-zinc-200 text-xs">{t.title}</h3>

                          {hasDeliverable && (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.2 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
                              <Sparkles className="h-2.5 w-2.5 text-emerald-400" />
                              Đã bàn giao SOP
                            </span>
                          )}
                        </div>

                        <p className="line-clamp-1 text-[11px] text-zinc-400 leading-relaxed">
                          {t.objective}
                        </p>

                        {/* Expandable 2-Block Parallel Container: Objective (Left) & Output / Deliverable (Right) */}
                        {isExpanded && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="mt-3.5 space-y-3.5 rounded-xl border border-border/80 bg-canvas/90 p-4 text-xs shadow-inner animate-in fade-in duration-150"
                          >
                            {/* 2-Column Parallel Grid */}
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                              {/* Block 1: 📥 Mục tiêu công việc (Objective) */}
                              <div className="flex flex-col rounded-xl border border-border/70 bg-panel/80 p-3.5 shadow-sm">
                                <div className="flex items-center justify-between pb-2 border-b border-border/50">
                                  <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
                                    <span className="flex h-5 w-5 items-center justify-center rounded bg-blue-500/15 text-blue-400">
                                      <FileText className="h-3.5 w-3.5" />
                                    </span>
                                    <span>📥 Mục tiêu công việc (Objective)</span>
                                  </div>
                                  <span className="text-[10px] font-mono text-zinc-500">
                                    Giao bởi: <strong className="text-zinc-300">{t.createdBy}</strong>
                                  </span>
                                </div>

                                <div className="mt-2.5 flex-1 min-h-[160px] max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-950/70 p-3.5 font-sans text-xs text-zinc-200 leading-relaxed border border-border/40 selection:bg-blue-500/30">
                                  {t.objective}
                                </div>
                              </div>

                              {/* Block 2: 📤 Kết quả thực hiện / Văn bản bàn giao (Agent Output) */}
                              <div className="flex flex-col rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3.5 shadow-sm">
                                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-emerald-500/20">
                                  <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
                                    <span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-500/20 text-emerald-400">
                                      <Sparkles className="h-3.5 w-3.5" />
                                    </span>
                                    <span>📤 Kết quả bàn giao (Agent Output)</span>
                                  </div>

                                  {/* Quick Action Buttons */}
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {/* Edit Button: Opens Deliverable Edit Modal */}
                                    {(hasDeliverable || t.status === "COMPLETED") && (
                                      <button
                                        type="button"
                                        onClick={(e) => handleOpenEditModal(t, e)}
                                        title="Chỉnh sửa nội dung kết quả bàn giao trong cửa sổ riêng (Modal)"
                                        className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/25 hover:text-amber-200 transition-all cursor-pointer shadow-sm"
                                      >
                                        <Edit3 className="h-3 w-3 text-amber-400" />
                                        <span>Sửa</span>
                                      </button>
                                    )}

                                    {/* Action Buttons when Deliverable Exists */}
                                    {hasDeliverable && (
                                      <>
                                        {/* Button 1: Copy Entire Script */}
                                        <button
                                          type="button"
                                          onClick={(e) => handleCopyResult(t, e)}
                                          title="Sao chép toàn bộ kịch bản / tài liệu bàn giao"
                                          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer shadow-sm ${
                                            copiedResultTaskId === t.id
                                              ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-300"
                                              : "border-border/80 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-zinc-100"
                                          }`}
                                        >
                                          {copiedResultTaskId === t.id ? (
                                            <>
                                              <Check className="h-3 w-3 text-emerald-400" />
                                              <span>Đã sao chép</span>
                                            </>
                                          ) : (
                                            <>
                                              <Copy className="h-3 w-3 text-zinc-400" />
                                              <span>Sao chép</span>
                                            </>
                                          )}
                                        </button>

                                        {/* Button 2: Save to Company Knowledge Base */}
                                        <button
                                          type="button"
                                          onClick={(e) => handleSaveToKb(t, e)}
                                          disabled={savingKbTaskId === t.id}
                                          title="Lưu vào Company Knowledge Base (/knowledge) để các Agent khác cùng học và tái sử dụng"
                                          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer shadow-sm disabled:opacity-50 ${
                                            savedKbSuccessTaskId === t.id
                                              ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-300"
                                              : "border-purple-500/40 bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 hover:text-purple-200"
                                          }`}
                                        >
                                          {savingKbTaskId === t.id ? (
                                            <>
                                              <Loader2 className="h-3 w-3 animate-spin" />
                                              <span>Đang lưu...</span>
                                            </>
                                          ) : savedKbSuccessTaskId === t.id ? (
                                            <>
                                              <Check className="h-3 w-3 text-emerald-400" />
                                              <span>Đã lưu KB</span>
                                            </>
                                          ) : (
                                            <>
                                              <BookOpen className="h-3 w-3 text-purple-400" />
                                              <span>Lưu KB</span>
                                            </>
                                          )}
                                        </button>

                                        {/* Button 3: Download Markdown / SOP file */}
                                        <button
                                          type="button"
                                          onClick={(e) => handleDownloadMd(t, e)}
                                          title="Tải về dưới dạng file Markdown / SOP document (.md)"
                                          className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/10 hover:text-zinc-100 transition-all cursor-pointer shadow-sm"
                                        >
                                          <Download className="h-3 w-3 text-zinc-400" />
                                          <span>Tải .md</span>
                                        </button>

                                        {/* Button 4: Gửi thông báo Telegram & Email */}
                                        <button
                                          type="button"
                                          onClick={(e) => handleSendNotification(t, e)}
                                          disabled={sendingNotifyTaskId === t.id}
                                          title="Gửi nội dung kết quả bàn giao qua kênh Telegram và Email cho Founder"
                                          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer shadow-sm disabled:opacity-50 ${
                                            sentNotifySuccess[t.id]
                                              ? "border-emerald-500/60 bg-emerald-500/25 text-emerald-300"
                                              : "border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 hover:text-sky-200"
                                          }`}
                                        >
                                          {sendingNotifyTaskId === t.id ? (
                                            <>
                                              <Loader2 className="h-3 w-3 animate-spin" />
                                              <span>Đang gửi...</span>
                                            </>
                                          ) : sentNotifySuccess[t.id] ? (
                                            <>
                                              <Check className="h-3 w-3 text-emerald-400" />
                                              <span>Đã gửi</span>
                                            </>
                                          ) : (
                                            <>
                                              <Send className="h-3 w-3 text-sky-400" />
                                              <span>Gửi thông báo</span>
                                            </>
                                          )}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>

                                {/* KB Error message */}
                                {kbErrors[t.id] && (
                                  <p className="mt-2 text-[11px] text-rose-400 bg-rose-500/10 p-2 rounded border border-rose-500/20">
                                    {kbErrors[t.id]}
                                  </p>
                                )}

                                {/* KB Success toast banner */}
                                {savedKbSuccessTaskId === t.id && (
                                  <p className="mt-2 text-[11px] text-emerald-300 bg-emerald-500/20 p-2 rounded border border-emerald-500/40 flex items-center gap-1.5">
                                    <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                    <span>Đã lưu tài liệu vào <strong>Company Knowledge Base (/knowledge)</strong>! Các AI Agent khác có thể truy vấn và áp dụng ngay.</span>
                                  </p>
                                )}

                                {/* Notification Error message */}
                                {notifyErrors[t.id] && (
                                  <p className="mt-2 text-[11px] text-rose-400 bg-rose-500/10 p-2 rounded border border-rose-500/20 flex items-center gap-1.5">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                                    <span>{notifyErrors[t.id]}</span>
                                  </p>
                                )}

                                {/* Notification Success toast banner */}
                                {sentNotifySuccess[t.id] && (
                                  <p className="mt-2 text-[11px] text-sky-300 bg-sky-500/20 p-2 rounded border border-sky-500/40 flex items-center gap-1.5">
                                    <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                    <span>{sentNotifySuccess[t.id]}</span>
                                  </p>
                                )}

                                {/* Requeue Error message */}
                                {requeueErrorTaskId[t.id] && (
                                  <p className="mt-2 text-[11px] text-rose-400 bg-rose-500/10 p-2 rounded border border-rose-500/20 flex items-center gap-1.5">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                                    <span>{requeueErrorTaskId[t.id]}</span>
                                  </p>
                                )}

                                {/* Requeue Success toast banner */}
                                {requeueSuccessTaskId === t.id && (
                                  <p className="mt-2 text-[11px] text-emerald-300 bg-emerald-500/20 p-2 rounded border border-emerald-500/40 flex items-center gap-1.5">
                                    <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                    <span>Đã gửi lệnh chạy lại (Requeue) thành công! Agent sẽ tiếp tục xử lý.</span>
                                  </p>
                                )}

                                {/* Content Box */}
                                <div className="mt-2.5 flex-1 min-h-[160px] max-h-[420px] overflow-y-auto rounded-lg bg-zinc-950/80 p-3.5 font-sans text-xs text-zinc-200 leading-relaxed border border-emerald-500/20 selection:bg-emerald-500/30">
                                  {hasDeliverable ? (
                                    <div className="whitespace-pre-wrap font-sans text-xs text-zinc-100 leading-relaxed">
                                      {deliverable}
                                    </div>
                                  ) : t.status === "BLOCKED" || t.status === "ESCALATED" ? (
                                    <div className="flex h-full min-h-[140px] flex-col justify-between rounded-lg bg-rose-950/20 border border-rose-500/30 p-3.5">
                                      <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="flex items-center gap-1.5 font-semibold text-rose-400 text-xs">
                                            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                                            Task đang bị chặn (Blocked)
                                          </span>
                                          <span className="font-mono text-[10px] bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded border border-rose-500/30">
                                            {t.riskLevel || "R1"}
                                          </span>
                                        </div>

                                        <div className="rounded bg-black/50 p-2.5 font-mono text-[11px] text-rose-200 border border-rose-500/20 leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto">
                                          <div className="text-[10px] font-sans font-semibold text-rose-300 mb-1 flex items-center gap-1">
                                            <ShieldAlert className="h-3.5 w-3.5" />
                                            Nguyên nhân chi tiết:
                                          </div>
                                          {t.result || "Agent cần thêm thông tin hoặc chưa thể hoàn thành yêu cầu (Xem thêm Audit Log bên dưới)."}
                                        </div>
                                      </div>

                                      <div className="mt-2.5 pt-2.5 border-t border-rose-500/20 flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-[11px] text-zinc-400 italic">
                                          Khắc phục nguyên nhân và bấm chạy lại task:
                                        </p>
                                        <div className="flex items-center gap-1.5">
                                          <button
                                            type="button"
                                            onClick={(e) => handleOpenEditModal(t, e)}
                                            className="inline-flex items-center gap-1 rounded bg-zinc-800 border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
                                          >
                                            <Edit3 className="h-3 w-3" />
                                            <span>Soạn thảo kết quả</span>
                                          </button>
                                          <button
                                            type="button"
                                            disabled={requeuingTaskId === t.id}
                                            onClick={(e) => handleRequeue(t, e)}
                                            className="inline-flex items-center gap-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white px-3 py-1 text-xs font-medium transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                                          >
                                            {requeuingTaskId === t.id ? (
                                              <>
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                                <span>Đang gửi lại...</span>
                                              </>
                                            ) : (
                                              <>
                                                <RotateCcw className="h-3 w-3" />
                                                <span>Chạy lại (Requeue)</span>
                                              </>
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ) : t.status === "COMPLETED" ? (
                                    <div className="flex h-full min-h-[140px] flex-col items-center justify-center text-center text-zinc-500">
                                      <CheckCircle2 className="h-6 w-6 text-emerald-400/60 mb-1.5" />
                                      <p className="text-xs text-zinc-400 font-medium">Task đã hoàn tất thành công.</p>
                                      <p className="text-[11px] text-zinc-500 mt-0.5 mb-2">Chưa có văn bản bàn giao riêng cho task này.</p>
                                      <button
                                        type="button"
                                        onClick={(e) => handleOpenEditModal(t, e)}
                                        className="inline-flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/25 transition-colors cursor-pointer"
                                      >
                                        <Edit3 className="h-3 w-3" />
                                        <span>Soạn thảo kết quả bàn giao</span>
                                      </button>
                                    </div>
                                  ) : t.status === "RUNNING" ? (
                                    <div className="flex h-full min-h-[140px] flex-col items-center justify-center text-center text-accent">
                                      <Loader2 className="h-6 w-6 animate-spin text-accent mb-2" />
                                      <p className="text-xs font-semibold text-accent">Agent đang thực thi và tổng hợp kịch bản...</p>
                                      <p className="text-[11px] text-zinc-500 mt-0.5">Kết quả bàn giao sẽ tự động xuất hiện tại đây khi Agent kết thúc.</p>
                                    </div>
                                  ) : (
                                    <div className="flex h-full min-h-[140px] flex-col items-center justify-center text-center text-zinc-500">
                                      <Clock className="h-6 w-6 text-zinc-600 mb-1.5" />
                                      <p className="text-xs text-zinc-400">Chưa có kết quả bàn giao.</p>
                                      <p className="text-[11px] text-zinc-500 mt-0.5">Trạng thái hiện tại: {statusCfg.label}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Internal Review section if available */}
                            {(t.internalReviewNotes || (t.reviewNeededByRole && t.reviewNeededByRole !== "none")) && (
                              <div className="rounded-lg border border-purple-500/30 bg-purple-950/20 p-3 space-y-1.5">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="flex items-center gap-1.5 font-medium text-purple-300">
                                    <Shield className="h-3.5 w-3.5" />
                                    Đánh giá nội bộ (Internal Review)
                                  </span>
                                  {t.reviewNeededByRole && t.reviewNeededByRole !== "none" && (
                                    <span className="font-mono text-[10px] text-purple-300 bg-purple-500/20 px-2 py-0.5 rounded border border-purple-500/40">
                                      Người duyệt: {t.reviewNeededByRole}
                                    </span>
                                  )}
                                </div>
                                {t.internalReviewNotes ? (
                                  <div className="whitespace-pre-wrap rounded bg-black/40 p-2.5 font-mono text-[11px] text-purple-200 border border-purple-500/20 max-h-32 overflow-y-auto">
                                    {t.internalReviewNotes}
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-zinc-400 italic">
                                    Task cần được {t.reviewNeededByRole} đánh giá và phê duyệt trước khi hoàn tất.
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Meta footer */}
                            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[11px] text-zinc-400 border-t border-border/40">
                              <div className="flex flex-wrap items-center gap-4">
                                <span className="flex items-center gap-1.5">
                                  <User className="h-3 w-3 text-zinc-500" />
                                  Tạo bởi: <strong className="text-zinc-300">{t.createdBy}</strong>
                                </span>
                                {t.assignedTo && (
                                  <span>
                                    Phụ trách: <strong className="text-zinc-300">{t.assignedTo}</strong>
                                  </span>
                                )}
                              </div>
                              {duration && (
                                <span className="flex items-center gap-1 text-emerald-400 font-mono">
                                  <Timer className="h-3 w-3" />
                                  Thời gian xử lý: {duration}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>

                    <td className="px-3.5 py-3 align-top">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.8 text-[11px] font-medium ${statusCfg.badgeClass}`}
                      >
                        {statusCfg.icon}
                        <span>{statusCfg.label}</span>
                      </span>
                    </td>

                    <td className="px-3.5 py-3 align-top">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.8 font-mono text-[11px] ${risk.badgeClass}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${risk.dotClass}`} />
                        {risk.label}
                      </span>
                    </td>

                    <td className="px-3.5 py-3 align-top">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 font-mono text-zinc-300 text-[11px]">
                          <Calendar className="h-3 w-3 text-zinc-500" />
                          <span>{createTime}</span>
                          <span className="text-[10px] text-zinc-500">({createDate})</span>
                        </div>
                        {duration && (
                          <div className="flex items-center gap-1 text-[10px] text-emerald-400/90 font-mono">
                            <Timer className="h-3 w-3" />
                            <span>{duration}</span>
                          </div>
                        )}
                      </div>
                    </td>

                    <td className="px-3.5 py-3 text-right align-top">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(t.id);
                        }}
                        title={isExpanded ? "Thu gọn" : "Xem chi tiết & Kết quả bàn giao"}
                        className="rounded-md border border-border/60 bg-white/5 p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Empty States */}
        {filteredTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-zinc-500">
              <ListChecks className="h-5 w-5" />
            </div>
            <p className="mt-2 text-sm font-medium text-zinc-300">
              {search || filter !== "ALL"
                ? "Không tìm thấy task phù hợp"
                : "Chưa có task nào được giao cho Agent này"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500 max-w-sm">
              {search || filter !== "ALL"
                ? "Hãy thử đổi từ khóa tìm kiếm hoặc chọn bộ lọc 'Tất cả'."
                : "Gửi lệnh qua Founder Command (⌘K) để giao nhiệm vụ mới."}
            </p>
          </div>
        )}
      </div>

      {/* Deliverable Edit Modal */}
      <DeliverableEditModal
        task={modalTask}
        initialText={modalTask ? getDeliverableText(modalTask) : ""}
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setModalTask(null);
        }}
        onSaved={(newText) => {
          if (modalTask) {
            setTaskOverrides((prev) => ({ ...prev, [modalTask.id]: newText }));
          }
        }}
      />
    </div>
  );
}

