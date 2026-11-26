"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  DollarSign,
  ListChecks,
  ShieldCheck,
  Activity,
  RotateCcw,
  ShieldAlert,
  Save,
  CheckCircle2,
  Edit3,
  UserX,
  UserCheck,
  Building2,
  Users,
  X,
  AlertTriangle,
  Layers,
  Sparkles,
  Eye,
} from "lucide-react";
import type { Agent, AuditLogEntry, Task } from "@ai-opc/shared";
import {
  fetchAgentAuditLogs,
  fetchAgentDetail,
  fetchAgentTasks,
  resetAgentCost,
  setAgentBudgetCap,
  updateAgent,
  fireAgent,
  rehireAgent,
  fetchDepartments,
  fetchAgents,
} from "@/lib/api";
import { useCompanySocket } from "@/hooks/useCompanySocket";
import { AgentAuditLogViewer } from "@/components/AgentAuditLogViewer";
import { AgentTaskHistory } from "@/components/AgentTaskHistory";
import { AgentToolPermissionManager, type ToolPermissionRow } from "@/components/AgentToolPermissionManager";
import { AgentVideoManager } from "@/components/AgentVideoManager";
import { useI18n } from "@/context/I18nContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface AgentDetail extends Agent {
  department?: { id: string; name: string } | null;
  toolPermissions: ToolPermissionRow[];
  budgetCapUsd: number | null;
  suspendedReason: string | null;
  stats: {
    tasksByStatus: Record<string, number>;
    auditByAction: Record<string, number>;
    totalAuditEntries: number;
  };
}

const STATUS_LABEL: Record<string, string> = {
  READY: "Sẵn sàng",
  RUNNING: "Đang chạy",
  WAITING: "Đang chờ",
  BLOCKED: "Bị chặn",
  ESCALATED: "Cần leo thang",
  AWAITING_APPROVAL: "Chờ Founder duyệt",
  AWAITING_INTERNAL_REVIEW: "Chờ đánh giá nội bộ",
  SUSPENDED: "Đã tạm dừng",
};

const SUSPEND_REASON_LABEL: Record<string, string> = {
  BUDGET_CAP_EXCEEDED: "Vượt trần ngân sách riêng của Agent",
  COMPANY_BUDGET_CAP_EXCEEDED: "Vượt trần ngân sách toàn công ty",
  FIRED_BY_FOUNDER: "Đã bị sa thải bởi Founder",
};

const STATUS_COLOR: Record<string, string> = {
  READY: "text-zinc-400 border-zinc-700 bg-zinc-800/40",
  RUNNING: "text-accent border-accent/40 bg-accent/10",
  WAITING: "text-warn border-warn/40 bg-warn/10",
  BLOCKED: "text-danger border-danger/40 bg-danger/10",
  ESCALATED: "text-danger border-danger/40 bg-danger/10",
  AWAITING_APPROVAL: "text-warn border-warn/40 bg-warn/10",
  AWAITING_INTERNAL_REVIEW: "text-purple-400 border-purple-500/40 bg-purple-500/10",
  SUSPENDED: "text-danger border-danger/40 bg-danger/10",
};

const AUTONOMY_LEVELS = [
  { level: 1, title: "L1 - Đề xuất & Chờ duyệt", desc: "Chỉ lập kế hoạch, mọi hành động cần phê duyệt." },
  { level: 2, title: "L2 - Hỗ trợ có giám sát", desc: "Được tự động chạy các tool an toàn R0/R1." },
  { level: 3, title: "L3 - Tự chủ có điều kiện", desc: "Tự động thực thi trong hạn mức ngân sách và tool." },
  { level: 4, title: "L4 - Tự chủ tác chiến", desc: "Tự quyết định chuỗi hành động, thông báo sau khi xong." },
  { level: 5, title: "L5 - Quyền hạn cao", desc: "Được phép ra quyết định nghiệp vụ phức tạp." },
  { level: 6, title: "L6 - Tự trị hoàn toàn", desc: "Mức tự chủ tối đa của Agent cấp điều hành." },
];

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border/80 bg-panel/90 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 text-xl font-bold text-zinc-100">{value}</p>
    </div>
  );
}

export default function AgentDetailClient({ agentId }: { agentId: string }) {
  const { t, locale } = useI18n();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [tab, setTab] = useState<"tasks" | "logs">("tasks");
  const [budgetInput, setBudgetInput] = useState("");
  const [savingBudget, setSavingBudget] = useState(false);
  const [budgetSuccessMsg, setBudgetSuccessMsg] = useState(false);
  const { lastEvent } = useCompanySocket();

  // Edit State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDepartmentId, setEditDepartmentId] = useState("");
  const [editReportsTo, setEditReportsTo] = useState("");
  const [editMission, setEditMission] = useState("");
  const [editAutonomyLevel, setEditAutonomyLevel] = useState(1);
  const [savingEdit, setSavingEdit] = useState(false);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [managerAgents, setManagerAgents] = useState<Agent[]>([]);

  // Fire / Rehire State
  const [showFireConfirm, setShowFireConfirm] = useState(false);
  const [processingFire, setProcessingFire] = useState(false);
  const [forbiddenError, setForbiddenError] = useState(false);

  async function refresh() {
    if (!agentId) return;
    try {
      const [a, t, l] = await Promise.all([
        fetchAgentDetail(agentId),
        fetchAgentTasks(agentId),
        fetchAgentAuditLogs(agentId),
      ]);
      setAgent(a);
      setBudgetInput(a.budgetCapUsd != null ? String(a.budgetCapUsd) : "");
      setTasks(t);
      setLogs(l);
      setForbiddenError(false);
    } catch (err: any) {
      if (err?.message?.includes("403") || err?.message?.toLowerCase().includes("forbidden")) {
        setForbiddenError(true);
      }
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  useEffect(() => {
    if (!lastEvent || !agentId) return;
    const payload = lastEvent.payload as { agentId?: string; assignedTo?: string; id?: string };
    if (payload?.agentId === agentId || payload?.assignedTo === agentId || payload?.id === agentId) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent, agentId]);

  if (forbiddenError) {
    return (
      <main className="mx-auto max-w-2xl p-8 mt-12 text-center">
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-8 shadow-2xl backdrop-blur-md">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/20 text-rose-400 mb-4">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-bold text-zinc-100 mb-2">
            {locale === "vi" ? "Không có quyền truy cập Agent" : "Access Denied"}
          </h2>
          <p className="text-sm text-zinc-400 mb-6 max-w-md mx-auto">
            {locale === "vi"
              ? "Tài khoản của bạn không được phân quyền xem hoặc quản trị AI Agent này theo cấu hình RBAC."
              : "Your account is not permitted to view or manage this AI Agent under current RBAC settings."}
          </p>
          <div className="flex justify-center gap-3">
            <Link
              href="/agents"
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-black transition-all hover:bg-accent/90"
            >
              <Users className="h-4 w-4" />
              <span>{locale === "vi" ? "Danh sách AI Agents được cấp quyền" : "Allowed Agents"}</span>
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-white/5 px-4 py-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>{t.nav.backToDashboard}</span>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!agent) {
    return <main className="p-6 text-sm text-zinc-500">{t.common.loading}</main>;
  }

  const canControl = agent.canControl !== false;
  const isFired = agent.active === false;
  const isCoo = agent.id === "ai_coo";
  const totalTasks = Object.values(agent.stats.tasksByStatus).reduce((a, b) => a + b, 0);
  const completedTasks = agent.stats.tasksByStatus["COMPLETED"] ?? 0;
  const successRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const modelCallCount = agent.stats.auditByAction["MODEL_CALL_COST"] ?? 0;
  const isBudgetSuspended = agent.status === "SUSPENDED" && agent.suspendedReason === "BUDGET_CAP_EXCEEDED";

  async function handleResetCost() {
    if (!window.confirm(locale === "vi" ? `Reset chi phí tích luỹ của ${agent!.name} về $0? (sẽ tự mở lại Agent nếu đang bị khoá do vượt ngân sách riêng)` : `Reset accumulated cost for ${agent!.name} to $0?`)) return;
    await resetAgentCost(agentId);
    await refresh();
  }

  async function handleSaveBudget(e: React.FormEvent) {
    e.preventDefault();
    setSavingBudget(true);
    setBudgetSuccessMsg(false);
    try {
      const value = budgetInput.trim() === "" ? null : Number(budgetInput);
      await setAgentBudgetCap(agentId, value);
      setBudgetSuccessMsg(true);
      setTimeout(() => setBudgetSuccessMsg(false), 3000);
      await refresh();
    } finally {
      setSavingBudget(false);
    }
  }

  async function openEditModal() {
    const [depts, agts] = await Promise.all([
      fetchDepartments().catch(() => []),
      fetchAgents({ includeInactive: true }).catch(() => []),
    ]);
    setDepartments(depts);
    setManagerAgents(agts);
    setEditName(agent!.name);
    setEditTitle(agent!.title);
    setEditDepartmentId(agent!.departmentId || "");
    setEditReportsTo(agent!.reportsTo || "ai_coo");
    setEditMission(agent!.mission);
    setEditAutonomyLevel(agent!.autonomyLevel ?? 1);
    setShowEditModal(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    setSavingEdit(true);
    try {
      await updateAgent(agentId, {
        name: editName.trim(),
        title: editTitle.trim(),
        departmentId: editDepartmentId.trim() || null,
        reportsTo: editReportsTo.trim() || null,
        mission: editMission.trim(),
        autonomyLevel: editAutonomyLevel,
      });
      setShowEditModal(false);
      await refresh();
    } catch (err: any) {
      alert(err.message || (locale === "vi" ? "Lỗi cập nhật thông tin Agent" : "Failed to update Agent"));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleFireAgent() {
    setProcessingFire(true);
    try {
      await fireAgent(agentId);
      setShowFireConfirm(false);
      await refresh();
    } catch (err: any) {
      alert(err.message || (locale === "vi" ? "Lỗi sa thải Agent" : "Failed to terminate Agent"));
    } finally {
      setProcessingFire(false);
    }
  }

  async function handleRehireAgent() {
    if (!window.confirm(locale === "vi" ? `Bạn có chắc chắn muốn tuyển dụng lại Agent "${agent!.name}"?` : `Reactivate Agent "${agent!.name}"?`)) return;
    setProcessingFire(true);
    try {
      await rehireAgent(agentId);
      await refresh();
    } catch (err: any) {
      alert(err.message || (locale === "vi" ? "Lỗi tuyển dụng lại Agent" : "Failed to reactivate Agent"));
    } finally {
      setProcessingFire(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          <Link href="/" className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200">
            <ArrowLeft className="h-4 w-4" /> {t.nav.backToDashboard}
          </Link>
          <span className="text-zinc-600">/</span>
          <Link href="/agents" className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-accent">
            <Users className="h-3.5 w-3.5 text-accent" />
            <span>{locale === "vi" ? "Quản trị AI Agents" : "AI Agents Hub"}</span>
          </Link>
        </div>
        <LanguageSwitcher />
      </div>

      {/* Inactive / Fired Banner */}
      {isFired && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 text-sm text-rose-300 shadow-xl backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <UserX className="h-6 w-6 shrink-0 text-rose-400" />
            <div>
              <p className="font-semibold text-rose-200">
                {locale === "vi" ? "Agent này đã bị Sa Thải (Vô hiệu hóa)" : "This Agent has been Terminated (Deactivated)"}
              </p>
              <p className="text-xs text-rose-300/80">
                {locale === "vi" ? "Toàn bộ lịch sử Task và Audit Log được lưu trữ bất biến. AI-COO sẽ không giao thêm task mới cho Agent này." : "All task history and audit logs remain immutable. AI-COO will not assign new tasks to this agent."}
              </p>
            </div>
          </div>
          {canControl && (
            <button
              onClick={handleRehireAgent}
              disabled={processingFire}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg hover:bg-emerald-500 transition-all disabled:opacity-60 cursor-pointer"
            >
              <UserCheck className="h-4 w-4" />
              <span>{processingFire ? t.common.loading : t.agents.rehireBtn}</span>
            </button>
          )}
        </div>
      )}

      {/* Header */}
      <div className="rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl backdrop-blur-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-zinc-100">{agent.name}</h1>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_COLOR[agent.status] || "text-zinc-400"}`}>
                {STATUS_LABEL[agent.status] ?? agent.status}
              </span>
              {isFired ? (
                <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-400">
                  {t.agents.firedStatus}
                </span>
              ) : (
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                  {t.agents.activeStatus}
                </span>
              )}
              {!canControl && (
                <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-400 flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  <span>{locale === "vi" ? "Chỉ xem (Read-only)" : "Read-only"}</span>
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              {agent.title}
              {agent.department && ` · ${agent.department.name}`}
              {agent.autonomyLevel && ` · ${locale === "vi" ? "Tự chủ" : "Autonomy"} L${agent.autonomyLevel}`}
            </p>
          </div>

          {canControl && (
            <div className="flex items-center gap-2">
              <button
                onClick={openEditModal}
                className="flex items-center gap-1.5 rounded-xl border border-border/80 bg-white/5 px-3.5 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10 hover:border-zinc-700 cursor-pointer"
              >
                <Edit3 className="h-3.5 w-3.5 text-accent" />
                <span>{t.agents.editBtn}</span>
              </button>

              {!isCoo && !isFired && (
                <button
                  onClick={() => setShowFireConfirm(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-medium text-rose-400 transition-colors hover:bg-rose-500/20 hover:border-rose-500/50 cursor-pointer"
                >
                  <UserX className="h-3.5 w-3.5" />
                  <span>{t.agents.fireBtn}</span>
                </button>
              )}
            </div>
          )}
        </div>

        <p className="mt-3 text-sm text-zinc-300 leading-relaxed">{agent.mission}</p>

        {isBudgetSuspended && (
          <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">
            <ShieldAlert className="h-5 w-5 shrink-0 text-rose-400" />
            <div className="space-y-0.5">
              <p className="font-semibold text-rose-200">
                {locale === "vi" ? "Agent đang bị tạm dừng tự động:" : "Agent automatically suspended:"} {SUSPEND_REASON_LABEL[agent.suspendedReason!] ?? agent.suspendedReason}
              </p>
              <p className="text-xs text-rose-300/80">
                {locale === "vi" ? "Tăng trần ngân sách bên dưới hoặc bấm nút reset chi phí để mở lại trạng thái hoạt động cho Agent." : "Increase budget cap below or click reset cost to reactivate this Agent."}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border/80 bg-panel/90 p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-emerald-400" /> {locale === "vi" ? "Chi phí tích luỹ" : "Accumulated Cost"}
            </span>
            {canControl && (
              <button
                onClick={handleResetCost}
                title="Reset về $0"
                className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-100 transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="mt-1.5 text-2xl font-bold text-zinc-100">${Number(agent.monthlyCostUsd).toFixed(4)}</p>
          <p className="mt-1 text-[11px] text-zinc-500">{modelCallCount} {locale === "vi" ? "lần gọi model" : "model calls"}</p>
        </div>
        <StatCard icon={<ListChecks className="h-3.5 w-3.5 text-cyan-400" />} label={locale === "vi" ? "Tổng task" : "Total Tasks"} value={totalTasks} />
        <StatCard icon={<Activity className="h-3.5 w-3.5 text-emerald-400" />} label={locale === "vi" ? "Tỉ lệ hoàn thành" : "Completion Rate"} value={`${successRate}%`} />
        <StatCard
          icon={<ShieldCheck className="h-3.5 w-3.5 text-purple-400" />}
          label={locale === "vi" ? "Dòng audit log" : "Audit Log Entries"}
          value={agent.stats.totalAuditEntries}
        />
      </div>

      {/* Budget Guardrail Card */}
      <div className="rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <ShieldAlert className="h-4 w-4 text-amber-400" /> Budget Guardrail — {locale === "vi" ? "Trần chi tiêu riêng cho Agent" : "Agent Specific Budget Cap"}
          </h2>
          {budgetSuccessMsg && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> {t.common.success}
            </span>
          )}
        </div>
        <form onSubmit={handleSaveBudget} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="mb-1 block text-xs text-zinc-400">
              {locale === "vi" ? "Trần chi tiêu AI/tháng (USD) — để trống = không giới hạn" : "Monthly AI Budget Cap (USD) — empty = unlimited"}
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">$</span>
              <input
                type="number"
                step="0.001"
                min="0"
                disabled={!canControl}
                placeholder="e.g.: 5.00"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-8 pr-4 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
          </div>
          {canControl ? (
            <button
              type="submit"
              disabled={savingBudget}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-60 cursor-pointer"
            >
              <Save className="h-4 w-4" />
              <span>{savingBudget ? t.common.saving : t.common.save}</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800/40 px-3.5 py-2 text-xs text-zinc-400">
              <Eye className="h-3.5 w-3.5 text-zinc-400" />
              <span>{locale === "vi" ? "Chế độ xem" : "Read-only"}</span>
            </div>
          )}
        </form>
        <p className="text-xs text-zinc-500 leading-relaxed">
          {locale === "vi"
            ? "Khi chi phí tích luỹ của riêng Agent này vượt trần, nó sẽ tự động chuyển sang SUSPENDED và toàn bộ task chưa hoàn thành sẽ bị chuyển sang BLOCKED để bảo vệ ngân sách."
            : "When this Agent's spent exceeds its individual cap, it is automatically SUSPENDED and unfinished tasks are BLOCKED."}
        </p>
      </div>

      {/* Tool Permission Manager */}
      <AgentToolPermissionManager
        agentId={agent.id}
        agentName={agent.name}
        permissions={agent.toolPermissions}
        onUpdated={refresh}
        readOnly={!canControl}
      />

      {/* Video Library — chỉ hiện cho agent quản lý video */}
      {agent.id === "agent_create_video_ai" && <AgentVideoManager readOnly={!canControl} />}

      {/* Tabs: Task history / Audit log */}
      <div className="rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-4">
          <div className="flex items-center gap-1 rounded-xl border border-border/80 bg-canvas/80 p-1 backdrop-blur-md">
            <button
              onClick={() => setTab("tasks")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                tab === "tasks"
                  ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/60"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <ListChecks className={`h-4 w-4 ${tab === "tasks" ? "text-emerald-400" : "text-zinc-500"}`} />
              <span>{locale === "vi" ? "Lịch sử Task" : "Task History"}</span>
              <span
                className={`rounded-full px-2 py-0.2 font-mono text-[10px] ${
                  tab === "tasks"
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold"
                    : "bg-white/5 text-zinc-500"
                }`}
              >
                {tasks.length}
              </span>
            </button>

            <button
              onClick={() => setTab("logs")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                tab === "logs"
                  ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/60"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <ShieldCheck className={`h-4 w-4 ${tab === "logs" ? "text-cyan-400" : "text-zinc-500"}`} />
              <span>Audit Log</span>
              <span
                className={`rounded-full px-2 py-0.2 font-mono text-[10px] ${
                  tab === "logs"
                    ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 font-semibold"
                    : "bg-white/5 text-zinc-500"
                }`}
              >
                {logs.length}
              </span>
            </button>
          </div>

          <button
            onClick={refresh}
            title={t.common.refresh}
            className="flex items-center gap-1.5 rounded-lg border border-border/80 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t.common.refresh}</span>
          </button>
        </div>

        {tab === "tasks" ? (
          <AgentTaskHistory tasks={tasks} onRefresh={refresh} />
        ) : (
          <AgentAuditLogViewer logs={logs} />
        )}
      </div>

      {/* Edit Agent Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-panel p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-base font-bold text-zinc-100">
                <Edit3 className="h-5 w-5 text-accent" />
                <span>{locale === "vi" ? `Chỉnh sửa thông tin Agent: ${agent.name}` : `Edit Agent Profile: ${agent.name}`}</span>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-300">{locale === "vi" ? "Tên Agent" : "Agent Name"}</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full rounded-xl border border-border bg-canvas px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-300">{t.agents.role}</label>
                  <input
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded-xl border border-border bg-canvas px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-300">{t.agents.department}</label>
                  <select
                    value={editDepartmentId}
                    onChange={(e) => setEditDepartmentId(e.target.value)}
                    className="w-full rounded-xl border border-border bg-canvas px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
                  >
                    <option value="">{locale === "vi" ? "-- Không thuộc phòng ban --" : "-- No Department --"}</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.id})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-300">{locale === "vi" ? "Báo cáo cho" : "Reports To"}</label>
                  <select
                    value={editReportsTo}
                    onChange={(e) => setEditReportsTo(e.target.value)}
                    className="w-full rounded-xl border border-border bg-canvas px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
                  >
                    <option value="ai_coo">AI-COO</option>
                    {managerAgents
                      .filter((a) => a.id !== agent.id && a.id !== "ai_coo")
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.title})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-300">{locale === "vi" ? "Sứ mệnh / Nhiệm vụ cốt lõi (Mission)" : "Mission / Core Objective"}</label>
                <textarea
                  rows={4}
                  required
                  value={editMission}
                  onChange={(e) => setEditMission(e.target.value)}
                  className="w-full rounded-xl border border-border bg-canvas p-3 text-sm text-zinc-100 outline-none focus:border-accent leading-relaxed"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-300">{locale === "vi" ? "Mức độ tự chủ (Autonomy Level)" : "Autonomy Level"}</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {AUTONOMY_LEVELS.map((al) => (
                    <div
                      key={al.level}
                      onClick={() => setEditAutonomyLevel(al.level)}
                      className={`cursor-pointer rounded-xl border p-2.5 text-xs transition-all ${
                        editAutonomyLevel === al.level
                          ? "border-accent bg-accent/10 font-medium text-zinc-100 ring-1 ring-accent/40"
                          : "border-border bg-canvas/60 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      <span className="font-bold text-accent">{al.title}</span>
                      <p className="mt-0.5 text-[11px] text-zinc-400">{al.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/5 cursor-pointer"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-black hover:bg-accent/90 disabled:opacity-60 cursor-pointer"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{savingEdit ? t.common.saving : t.common.save}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Fire Confirm Modal */}
      {showFireConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-panel p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 border border-rose-500/30">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-100">{locale === "vi" ? "Xác nhận Sa Thải Agent" : "Confirm Agent Termination"}</h3>
                <p className="text-xs text-rose-400">{locale === "vi" ? "Hành động soft-delete có thể đảo ngược" : "Reversible soft-delete action"}</p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              {locale === "vi"
                ? <>Bạn có chắc chắn muốn sa thải Agent <strong className="text-zinc-100 font-bold">{agent.name}</strong> ({agent.title})?</>
                : <>Are you sure you want to terminate Agent <strong className="text-zinc-100 font-bold">{agent.name}</strong> ({agent.title})?</>}
            </p>
            <div className="rounded-xl border border-border/80 bg-canvas/80 p-3 text-[11px] text-zinc-400 space-y-1">
              <p>• {locale === "vi" ? <>Agent sẽ được đánh dấu <strong>active = false</strong> và trạng thái chuyển sang <code>SUSPENDED</code>.</> : <>Agent will be set to <strong>active = false</strong> and status set to <code>SUSPENDED</code>.</>}</p>
              <p>• {locale === "vi" ? <>Toàn bộ lịch sử Task, Audit Log và cấu hình quyền Tool được <strong>bảo lưu bất biến</strong>.</> : <>All task history, audit log, and tool permission configs are <strong>preserved immutably</strong>.</>}</p>
              <p>• {locale === "vi" ? <>Bạn có thể bấm <strong>"Tuyển dụng lại"</strong> bất cứ lúc nào.</> : <>You can click <strong>"Rehire"</strong> at any time.</>}</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowFireConfirm(false)}
                className="rounded-xl border border-border px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/5 cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                disabled={processingFire}
                onClick={handleFireAgent}
                className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-60 shadow-lg shadow-rose-600/20 cursor-pointer"
              >
                <UserX className="h-3.5 w-3.5" />
                <span>{processingFire ? t.common.loading : t.agents.fireBtn}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
