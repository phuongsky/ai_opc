"use client";

import { useState, useMemo } from "react";
import {
  Sparkles,
  CheckCircle2,
  Wrench,
  Clock,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Search,
  Copy,
  Check,
  Code2,
  Layers,
  Shield,
  FileText,
} from "lucide-react";
import type { AuditLogEntry, RiskLevel } from "@ai-opc/shared";
import { cleanDeliverableText } from "@ai-opc/shared";

// ---- Formatting Helpers ----------------------------------------------------

interface ParsedModelCost {
  isModelCost: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  rawText: string;
}

function parseModelCostSummary(text?: string | null): ParsedModelCost {
  if (!text) return { isModelCost: false, rawText: "" };

  const tokenMatch = text.match(/(\d+)\s*input\s*\+\s*(\d+)\s*output\s*token/i);
  const costMatch = text.match(/≈\s*\$?([\d.]+)/i);

  if (tokenMatch || costMatch) {
    const inTok = tokenMatch ? parseInt(tokenMatch[1], 10) : undefined;
    const outTok = tokenMatch ? parseInt(tokenMatch[2], 10) : undefined;
    const total = inTok !== undefined && outTok !== undefined ? inTok + outTok : undefined;
    const cost = costMatch ? parseFloat(costMatch[1]) : undefined;
    return {
      isModelCost: true,
      inputTokens: inTok,
      outputTokens: outTok,
      totalTokens: total,
      costUsd: cost,
      rawText: text,
    };
  }

  return { isModelCost: false, rawText: text };
}

function cleanMarkdownPreview(text?: string | null): string {
  if (!text) return "-";
  const cleaned = cleanDeliverableText(text);
  return cleaned
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/#+\s+/g, "")
    .replace(/`{1,3}(.*?)`{1,3}/g, "$1")
    .replace(/\n+/g, " ")
    .trim();
}

function formatTime(iso: string) {
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

// ---- Risk Badges -----------------------------------------------------------

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

// ---- Action Types & Visuals ------------------------------------------------

function getActionMeta(action: string) {
  const upper = action.toUpperCase();

  if (upper === "MODEL_CALL_COST" || upper.includes("COST") || upper.includes("TOKEN")) {
    return {
      label: "AI Inference / Token",
      category: "AI_COST",
      icon: <Sparkles className="h-3.5 w-3.5 text-purple-400 shrink-0" />,
      badgeClass: "bg-purple-500/10 text-purple-300 border-purple-500/20",
    };
  }

  if (
    upper === "COMPLETED_NO_TOOL" ||
    upper === "COMPLETED" ||
    upper === "SUCCESS" ||
    upper.includes("FINISH")
  ) {
    return {
      label: "Hoàn tất nhiệm vụ",
      category: "COMPLETED",
      icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />,
      badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    };
  }

  if (upper.includes("TOOL") || upper === "EXECUTE_TOOL") {
    return {
      label: "Thực thi Tool",
      category: "TOOL",
      icon: <Wrench className="h-3.5 w-3.5 text-sky-400 shrink-0" />,
      badgeClass: "bg-sky-500/10 text-sky-300 border-sky-500/20",
    };
  }

  if (upper === "AWAITING_APPROVAL" || upper.includes("APPROVAL")) {
    return {
      label: "Chờ Founder duyệt",
      category: "WARNING",
      icon: <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />,
      badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    };
  }

  if (upper.includes("BLOCKED") || upper.includes("DENIED") || upper.includes("FAIL")) {
    return {
      label: "Từ chối / Chặn",
      category: "WARNING",
      icon: <ShieldAlert className="h-3.5 w-3.5 text-rose-400 shrink-0" />,
      badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    };
  }

  return {
    label: action.replace(/_/g, " "),
    category: "OTHER",
    icon: <FileText className="h-3.5 w-3.5 text-zinc-400 shrink-0" />,
    badgeClass: "bg-zinc-800/80 text-zinc-300 border-zinc-700/50",
  };
}

// ---- Main Component --------------------------------------------------------

type FilterCategory = "ALL" | "AI_COST" | "TOOL" | "COMPLETED" | "WARNING";

export function AgentAuditLogViewer({ logs }: { logs: AuditLogEntry[] }) {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterCategory>("ALL");
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Thống kê nhanh
  const stats = useMemo(() => {
    let totalCost = 0;
    let totalTokens = 0;
    let toolCalls = 0;
    let warnings = 0;

    for (const l of logs) {
      const parsed = parseModelCostSummary(l.resultSummary);
      if (parsed.costUsd) totalCost += parsed.costUsd;
      if (parsed.totalTokens) totalTokens += parsed.totalTokens;
      if (l.toolId || l.action.toUpperCase().includes("TOOL")) toolCalls++;
      if (
        l.riskLevel === "R3" ||
        l.riskLevel === "R4" ||
        l.action.toUpperCase().includes("BLOCKED") ||
        l.action.toUpperCase().includes("APPROVAL")
      ) {
        warnings++;
      }
    }

    return { totalCost, totalTokens, toolCalls, warnings };
  }, [logs]);

  // Bộ lọc dữ liệu
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const meta = getActionMeta(log.action);

      // Lọc theo danh mục
      if (activeFilter !== "ALL") {
        if (activeFilter === "AI_COST" && meta.category !== "AI_COST") return false;
        if (activeFilter === "TOOL" && meta.category !== "TOOL" && !log.toolId) return false;
        if (activeFilter === "COMPLETED" && meta.category !== "COMPLETED") return false;
        if (activeFilter === "WARNING" && meta.category !== "WARNING") return false;
      }

      // Lọc theo tìm kiếm từ khóa
      if (search.trim()) {
        const q = search.toLowerCase();
        const actionMatch = log.action.toLowerCase().includes(q);
        const metaLabelMatch = meta.label.toLowerCase().includes(q);
        const toolMatch = log.toolId?.toLowerCase().includes(q) ?? false;
        const resultMatch = log.resultSummary?.toLowerCase().includes(q) ?? false;
        const taskMatch = log.taskId?.toLowerCase().includes(q) ?? false;
        const riskMatch = log.riskLevel?.toLowerCase().includes(q) ?? false;
        if (!actionMatch && !metaLabelMatch && !toolMatch && !resultMatch && !taskMatch && !riskMatch) {
          return false;
        }
      }

      return true;
    });
  }, [logs, activeFilter, search]);

  const toggleExpand = (id: number) => {
    setExpandedRowId((prev) => (prev === id ? null : id));
  };

  const handleCopy = (log: AuditLogEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const content = log.inputPayload
      ? JSON.stringify(log.inputPayload, null, 2)
      : log.resultSummary || "";
    navigator.clipboard.writeText(content);
    setCopiedId(log.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="space-y-4">
      {/* Quick Stats Toolbar */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="flex items-center gap-3 rounded-xl border border-border/80 bg-canvas/40 px-3.5 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-zinc-400">
            <Layers className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-zinc-500">Tổng sự kiện</p>
            <p className="font-mono text-sm font-semibold text-zinc-200">{logs.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-purple-500/20 bg-purple-500/5 px-3.5 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-purple-300/70">Tokens / Chi phí AI</p>
            <p className="font-mono text-sm font-semibold text-purple-200">
              {stats.totalTokens.toLocaleString()} tok{" "}
              <span className="text-[11px] text-purple-400 font-normal">
                (${stats.totalCost.toFixed(4)})
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3.5 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
            <Wrench className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-sky-300/70">Lần gọi Tool</p>
            <p className="font-mono text-sm font-semibold text-sky-200">{stats.toolCalls}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
            <Shield className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-amber-300/70">Cảnh báo / Chờ duyệt</p>
            <p className="font-mono text-sm font-semibold text-amber-200">{stats.warnings}</p>
          </div>
        </div>
      </div>

      {/* Filter Chips & Search Bar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        {/* Category Filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setActiveFilter("ALL")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
              activeFilter === "ALL"
                ? "bg-zinc-200 text-zinc-900 shadow-sm"
                : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
            }`}
          >
            Tất cả
            <span className="rounded-full bg-black/20 px-1.5 py-0.2 text-[10px] font-mono">
              {logs.length}
            </span>
          </button>

          <button
            onClick={() => setActiveFilter("AI_COST")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
              activeFilter === "AI_COST"
                ? "bg-purple-500 text-white shadow-sm"
                : "bg-purple-500/10 text-purple-300 hover:bg-purple-500/20"
            }`}
          >
            <Sparkles className="h-3 w-3" />
            Chi phí AI
          </button>

          <button
            onClick={() => setActiveFilter("TOOL")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
              activeFilter === "TOOL"
                ? "bg-sky-500 text-white shadow-sm"
                : "bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"
            }`}
          >
            <Wrench className="h-3 w-3" />
            Tool Gateway
          </button>

          <button
            onClick={() => setActiveFilter("COMPLETED")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
              activeFilter === "COMPLETED"
                ? "bg-emerald-500 text-white shadow-sm"
                : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
            }`}
          >
            <CheckCircle2 className="h-3 w-3" />
            Hoàn tất
          </button>

          <button
            onClick={() => setActiveFilter("WARNING")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
              activeFilter === "WARNING"
                ? "bg-amber-500 text-black shadow-sm"
                : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            }`}
          >
            <ShieldAlert className="h-3 w-3" />
            Cảnh báo
          </button>
        </div>

        {/* Search Box */}
        <div className="relative min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo action, tool, kết quả..."
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

      {/* Main Audit Log Table / Stream */}
      <div className="overflow-hidden rounded-xl border border-border/80 bg-panel shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border/80 bg-zinc-900/60 text-[11px] font-medium text-zinc-400">
              <tr>
                <th className="w-32 px-3.5 py-3">Thời gian</th>
                <th className="w-48 px-3.5 py-3">Sự kiện & Risk</th>
                <th className="w-28 px-3.5 py-3">Công cụ</th>
                <th className="px-3.5 py-3">Nội dung tóm tắt</th>
                <th className="w-20 px-3.5 py-3 text-right">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredLogs.map((log) => {
                const { time, date } = formatTime(log.timestamp);
                const meta = getActionMeta(log.action);
                const isExpanded = expandedRowId === log.id;
                const risk = log.riskLevel ? RISK_BADGES[log.riskLevel] : null;
                const modelCost = parseModelCostSummary(log.resultSummary);

                return (
                  <tr
                    key={log.id}
                    onClick={() => toggleExpand(log.id)}
                    className={`group cursor-pointer transition-colors hover:bg-white/[0.03] ${
                      isExpanded ? "bg-white/[0.02]" : ""
                    }`}
                  >
                    <td className="px-3.5 py-3 align-top">
                      <div className="font-mono font-medium text-zinc-200">{time}</div>
                      <div className="text-[10px] text-zinc-500">{date}</div>
                    </td>

                    <td className="px-3.5 py-3 align-top">
                      <div className="flex flex-col items-start gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.badgeClass}`}
                        >
                          {meta.icon}
                          <span>{meta.label}</span>
                        </span>

                        {risk ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.2 font-mono text-[10px] ${risk.badgeClass}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${risk.dotClass}`} />
                            {risk.label}
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-600 font-mono">Risk: R0</span>
                        )}
                      </div>
                    </td>

                    <td className="px-3.5 py-3 align-top">
                      {log.toolId ? (
                        <span className="inline-flex items-center gap-1 rounded border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 font-mono text-[11px] text-sky-300">
                          <Wrench className="h-3 w-3" />
                          {log.toolId}
                        </span>
                      ) : (
                        <span className="text-zinc-600 font-mono text-[11px]">—</span>
                      )}
                    </td>

                    <td className="px-3.5 py-3 align-top">
                      {modelCost.isModelCost ? (
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {modelCost.totalTokens !== undefined && (
                              <span className="rounded bg-purple-500/15 px-1.5 py-0.5 font-mono text-[11px] text-purple-300 border border-purple-500/20">
                                {modelCost.inputTokens ?? 0} in + {modelCost.outputTokens ?? 0} out (
                                {modelCost.totalTokens} tokens)
                              </span>
                            )}
                            {modelCost.costUsd !== undefined && (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[11px] text-emerald-400 border border-emerald-500/20 font-medium">
                                ≈ ${modelCost.costUsd.toFixed(4)}
                              </span>
                            )}
                          </div>
                          <p className="line-clamp-1 text-[11px] text-zinc-400">
                            {cleanMarkdownPreview(log.resultSummary)}
                          </p>
                        </div>
                      ) : (
                        <div className="line-clamp-2 text-zinc-300 leading-relaxed">
                          {cleanMarkdownPreview(log.resultSummary)}
                        </div>
                      )}

                      {/* Expandable Content Drawer */}
                      {isExpanded && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="mt-3 space-y-3 rounded-lg border border-border/80 bg-canvas/80 p-3.5 text-xs animate-in fade-in duration-150"
                        >
                          {/* Full Result Text */}
                          {log.resultSummary && (
                            <div>
                              <div className="flex items-center justify-between pb-1.5 text-[11px] font-medium text-zinc-400 border-b border-border/40">
                                <span className="flex items-center gap-1.5">
                                  <FileText className="h-3.5 w-3.5 text-zinc-400" />
                                  Nội dung đầy đủ
                                </span>
                                <button
                                  onClick={(e) => handleCopy(log, e)}
                                  className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                                >
                                  {copiedId === log.id ? (
                                    <>
                                      <Check className="h-3 w-3 text-emerald-400" />
                                      <span className="text-emerald-400">Đã copy</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" />
                                      <span>Copy</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              <div className="mt-2 whitespace-pre-wrap rounded-md bg-zinc-950/60 p-3 font-sans text-xs text-zinc-200 leading-relaxed border border-border/40 max-h-60 overflow-y-auto">
                                {cleanDeliverableText(log.resultSummary)}
                              </div>
                            </div>
                          )}

                          {/* JSON Payload Viewer */}
                          {log.inputPayload && (
                            <div>
                              <div className="flex items-center justify-between pb-1.5 text-[11px] font-medium text-zinc-400 border-b border-border/40">
                                <span className="flex items-center gap-1.5">
                                  <Code2 className="h-3.5 w-3.5 text-sky-400" />
                                  Input Payload (JSON)
                                </span>
                              </div>
                              <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-950/80 p-3 font-mono text-[11px] text-emerald-300 border border-border/40 max-h-48">
                                {JSON.stringify(log.inputPayload, null, 2)}
                              </pre>
                            </div>
                          )}

                          {/* Metadata Bar */}
                          <div className="flex flex-wrap items-center gap-3 pt-1 text-[10px] font-mono text-zinc-500 border-t border-border/40">
                            <span>ID: #{log.id}</span>
                            {log.taskId && <span>Task: {log.taskId}</span>}
                            {log.agentId && <span>Agent: {log.agentId}</span>}
                            <span>Raw Action: {log.action}</span>
                            <span>Timestamp: {new Date(log.timestamp).toISOString()}</span>
                          </div>
                        </div>
                      )}
                    </td>

                    <td className="px-3.5 py-3 text-right align-top">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(log.id);
                        }}
                        title={isExpanded ? "Thu gọn" : "Xem chi tiết"}
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
        {filteredLogs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-zinc-500">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <p className="mt-2 text-sm font-medium text-zinc-300">
              {search || activeFilter !== "ALL"
                ? "Không tìm thấy dòng log phù hợp"
                : "Chưa có sự kiện audit log nào"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500 max-w-sm">
              {search || activeFilter !== "ALL"
                ? "Hãy thử đổi từ khóa tìm kiếm hoặc chọn bộ lọc 'Tất cả'."
                : "Mọi hành động gọi tool, hoàn tất task, hoặc chi phí AI sẽ được ghi nhận tại đây."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
