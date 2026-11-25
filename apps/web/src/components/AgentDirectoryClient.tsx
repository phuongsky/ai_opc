"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Users,
  UserCheck,
  UserX,
  UserPlus,
  Search,
  Building2,
  DollarSign,
  Shield,
  Activity,
  Layers,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Filter,
  Wrench,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  X,
  Edit3,
  Flame,
  Eye,
} from "lucide-react";
import type { Agent } from "@ai-opc/shared";
import {
  fetchAgents,
  fetchDepartments,
  fireAgent,
  rehireAgent,
  updateAgent,
  fetchMe,
} from "@/lib/api";
import { useCompanySocket } from "@/hooks/useCompanySocket";
import { useI18n } from "@/context/I18nContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface AgentWithDept extends Agent {
  department?: { id: string; name: string } | null;
}

const STATUS_CONFIG: Record<string, { labelVi: string; labelEn: string; badgeClass: string; dotClass: string }> = {
  READY: {
    labelVi: "Sẵn sàng",
    labelEn: "Ready",
    badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    dotClass: "bg-emerald-400",
  },
  RUNNING: {
    labelVi: "Đang chạy",
    labelEn: "Running",
    badgeClass: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20 animate-pulse",
    dotClass: "bg-cyan-400",
  },
  WAITING: {
    labelVi: "Đang chờ",
    labelEn: "Waiting",
    badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dotClass: "bg-amber-400",
  },
  BLOCKED: {
    labelVi: "Bị chặn",
    labelEn: "Blocked",
    badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    dotClass: "bg-rose-400",
  },
  ESCALATED: {
    labelVi: "Leo thang",
    labelEn: "Escalated",
    badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    dotClass: "bg-rose-400",
  },
  AWAITING_APPROVAL: {
    labelVi: "Chờ duyệt",
    labelEn: "Awaiting Approval",
    badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dotClass: "bg-amber-400",
  },
  SUSPENDED: {
    labelVi: "Đã tạm dừng",
    labelEn: "Suspended",
    badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    dotClass: "bg-rose-400",
  },
};

const AUTONOMY_NAMES = [
  "L0 - Không tự chủ",
  "L1 - Đề xuất & Chờ duyệt",
  "L2 - Hỗ trợ có giám sát",
  "L3 - Tự chủ có điều kiện",
  "L4 - Tự chủ tác chiến",
  "L5 - Quyền hạn cao",
  "L6 - Tự trị hoàn toàn",
];

export default function AgentDirectoryClient() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const { lastEvent } = useCompanySocket();

  const [agents, setAgents] = useState<AgentWithDept[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>("founder");

  // Filters & Tabs
  const [activeTab, setActiveTab] = useState<"active" | "fired" | "all">("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDept, setSelectedDept] = useState("ALL");

  // Modals & Action States
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Fire confirm modal
  const [agentToFire, setAgentToFire] = useState<AgentWithDept | null>(null);

  // Edit modal
  const [editingAgent, setEditingAgent] = useState<AgentWithDept | null>(null);
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDeptId, setEditDeptId] = useState("");
  const [editMission, setEditMission] = useState("");
  const [editAutonomy, setEditAutonomy] = useState(1);
  const [savingEdit, setSavingEdit] = useState(false);

  async function loadData() {
    try {
      const [allAgts, depts, me] = await Promise.all([
        fetchAgents({ includeInactive: true }).catch(() => []),
        fetchDepartments().catch(() => []),
        fetchMe().catch(() => null),
      ]);
      setAgents(allAgts);
      setDepartments(depts);
      if (me?.role) {
        setUserRole(me.role);
      }
    } catch (err: any) {
      console.error("Lỗi nạp danh sách Agents:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (lastEvent) {
      loadData();
    }
  }, [lastEvent]);

  function showToast(text: string, type: "success" | "error" = "success") {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 4000);
  }

  // Handle Fire Agent
  async function handleConfirmFire() {
    if (!agentToFire) return;
    setActionLoadingId(agentToFire.id);
    try {
      await fireAgent(agentToFire.id);
      showToast(locale === "vi" ? `Đã sa thải Agent "${agentToFire.name}"` : `Terminated Agent "${agentToFire.name}"`);
      setAgentToFire(null);
      await loadData();
    } catch (err: any) {
      showToast(err.message || (locale === "vi" ? "Lỗi sa thải Agent" : "Failed to fire agent"), "error");
    } finally {
      setActionLoadingId(null);
    }
  }

  // Handle Rehire Agent
  async function handleRehire(a: AgentWithDept) {
    setActionLoadingId(a.id);
    try {
      await rehireAgent(a.id);
      showToast(locale === "vi" ? `Đã tái tuyển dụng Agent "${a.name}" thành công!` : `Reactivated Agent "${a.name}"!`);
      await loadData();
    } catch (err: any) {
      showToast(err.message || (locale === "vi" ? "Lỗi tái tuyển dụng" : "Failed to rehire agent"), "error");
    } finally {
      setActionLoadingId(null);
    }
  }

  // Open Edit Modal
  function openEditModal(a: AgentWithDept) {
    setEditingAgent(a);
    setEditName(a.name);
    setEditTitle(a.title);
    setEditDeptId(a.departmentId || "");
    setEditMission(a.mission);
    setEditAutonomy(a.autonomyLevel ?? 1);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingAgent) return;
    setSavingEdit(true);
    try {
      await updateAgent(editingAgent.id, {
        name: editName.trim(),
        title: editTitle.trim(),
        departmentId: editDeptId.trim() || null,
        mission: editMission.trim(),
        autonomyLevel: editAutonomy,
      });
      showToast(locale === "vi" ? "Đã cập nhật thông tin Agent thành công" : "Agent profile updated");
      setEditingAgent(null);
      await loadData();
    } catch (err: any) {
      showToast(err.message || (locale === "vi" ? "Lỗi lưu thông tin" : "Failed to save edit"), "error");
    } finally {
      setSavingEdit(false);
    }
  }

  // Filtered lists & metrics
  const activeAgentsList = useMemo(() => agents.filter((a) => a.active && a.status !== "SUSPENDED"), [agents]);
  const firedAgentsList = useMemo(() => agents.filter((a) => !a.active || a.status === "SUSPENDED" || a.suspendedReason === "FIRED_BY_FOUNDER"), [agents]);

  const totalMonthlySpend = useMemo(() => agents.reduce((sum, a) => sum + (a.monthlyCostUsd || 0), 0), [agents]);

  const filteredAgents = useMemo(() => {
    return agents.filter((a) => {
      // 1. Tab filter
      const isFired = !a.active || a.status === "SUSPENDED" || a.suspendedReason === "FIRED_BY_FOUNDER";
      if (activeTab === "active" && isFired) return false;
      if (activeTab === "fired" && !isFired) return false;

      // 2. Department filter
      if (selectedDept !== "ALL" && a.departmentId !== selectedDept) return false;

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = a.name.toLowerCase().includes(q);
        const matchId = a.id.toLowerCase().includes(q);
        const matchTitle = a.title.toLowerCase().includes(q);
        const matchMission = a.mission?.toLowerCase().includes(q);
        const matchDept = a.department?.name.toLowerCase().includes(q);
        if (!matchName && !matchId && !matchTitle && !matchMission && !matchDept) {
          return false;
        }
      }

      return true;
    });
  }, [agents, activeTab, selectedDept, searchQuery]);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Toast notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-md transition-all ${
            toastMessage.type === "success"
              ? "bg-emerald-950/90 text-emerald-200 border border-emerald-500/50"
              : "bg-rose-950/90 text-rose-200 border border-rose-500/50"
          }`}
        >
          {toastMessage.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-rose-400" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Top Breadcrumb & Language Switcher */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> {t.nav.backToDashboard}
        </Link>
        <div className="flex items-center gap-3">
          {userRole === "founder" && (
            <Link
              href="/settings"
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-accent border border-border/80 px-3 py-1.5 rounded-lg bg-panel/60 transition-colors"
            >
              <Shield className="h-3.5 w-3.5 text-amber-400" />
              <span>Phân quyền RBAC Matrix</span>
            </Link>
          )}
          <LanguageSwitcher />
        </div>
      </div>

      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-r from-panel via-panel/90 to-accent/5 p-6 shadow-xl backdrop-blur-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 border border-accent/30 text-accent">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-zinc-100">{t.agents.hubTitle}</h1>
                <p className="text-xs sm:text-sm text-zinc-400">{t.agents.hubSubtitle}</p>
              </div>
            </div>
          </div>
          {(userRole === "founder" || userRole === "manager") && (
            <div className="flex items-center gap-2.5 shrink-0">
              <Link
                href="/agents/new"
                className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow-lg shadow-accent/20 hover:bg-accent/90 transition-all cursor-pointer"
              >
                <UserPlus className="h-4 w-4" />
                <span>{t.agents.hireBtn}</span>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* KPI Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border/80 bg-panel/80 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">{t.agents.totalAgents}</span>
            <Users className="h-4 w-4 text-cyan-400" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-zinc-100">{agents.length}</p>
        </div>

        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-400">{t.agents.activeAgents}</span>
            <UserCheck className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-emerald-300">{activeAgentsList.length}</p>
        </div>

        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-rose-400">{t.agents.firedAgents}</span>
            <UserX className="h-4 w-4 text-rose-400" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-rose-300">{firedAgentsList.length}</p>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-amber-400">{t.agents.totalMonthlyCost}</span>
            <DollarSign className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-amber-300">
            ${totalMonthlySpend.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Filter Toolbar & Tab Switcher */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl border border-border/80 bg-panel/90 p-3 shadow-md backdrop-blur-sm">
        {/* Segmented Tabs */}
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-zinc-900/60 p-1">
          <button
            onClick={() => setActiveTab("active")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "active"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <UserCheck className="h-3.5 w-3.5" />
            <span>{t.agents.tabActive}</span>
            <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[10px] text-emerald-300 font-bold">
              {activeAgentsList.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("fired")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "fired"
                ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <UserX className="h-3.5 w-3.5" />
            <span>{t.agents.tabFired}</span>
            <span className="rounded-full bg-rose-500/20 px-1.5 py-0.2 text-[10px] text-rose-300 font-bold">
              {firedAgentsList.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("all")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "all"
                ? "bg-accent/20 text-accent border border-accent/40 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>{t.agents.tabAll}</span>
            <span className="rounded-full bg-accent/20 px-1.5 py-0.2 text-[10px] text-accent font-bold">
              {agents.length}
            </span>
          </button>
        </div>

        {/* Search and Dept Filter */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.agents.searchPlaceholder}
              className="w-full rounded-lg border border-border/70 bg-zinc-900/80 py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder-zinc-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="relative">
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="rounded-lg border border-border/70 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-300 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
            >
              <option value="ALL">{t.agents.allDepartments}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Agents Grid List */}
      {loading ? (
        <div className="py-20 text-center text-sm text-zinc-500">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent mb-2" />
          <p>{t.common.loading}</p>
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Users className="mx-auto h-10 w-10 text-zinc-600 mb-3" />
          <p className="text-base font-semibold text-zinc-300">
            {activeTab === "fired"
              ? t.agents.noFiredAgents
              : activeTab === "active"
              ? t.agents.noActiveAgents
              : t.agents.noAgents}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {searchQuery
              ? "Không tìm thấy Agent nào khớp với từ khóa tìm kiếm."
              : activeTab === "fired"
              ? "Tất cả các Agent hiện đều đang hoạt động tốt hoặc chưa có ai bị sa thải."
              : "Bấm '+ Tuyển Agent mới' để mở rộng đội ngũ AI."}
          </p>
          {activeTab !== "fired" && (userRole === "founder" || userRole === "manager") && (
            <Link
              href="/agents/new"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent/15 border border-accent/40 px-3.5 py-2 text-xs font-semibold text-accent hover:bg-accent/25 transition-all"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>{t.agents.hireBtn}</span>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredAgents.map((a) => {
            const isFired = !a.active || a.status === "SUSPENDED" || a.suspendedReason === "FIRED_BY_FOUNDER";
            const statusMeta = STATUS_CONFIG[a.status] || STATUS_CONFIG.READY;
            const isCOO = a.id === "ai_coo";
            const canControl = a.canControl !== false;

            return (
              <div
                key={a.id}
                className={`relative flex flex-col justify-between rounded-2xl border p-5 shadow-lg backdrop-blur-sm transition-all hover:translate-y-[-2px] ${
                  isFired
                    ? "border-rose-500/40 bg-gradient-to-b from-rose-950/20 via-panel/90 to-panel/80 hover:border-rose-500/60"
                    : "border-border/80 bg-panel/90 hover:border-accent/50"
                }`}
              >
                {/* Card Top: Identity & Status */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border font-bold text-sm shadow-inner ${
                          isFired
                            ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                            : isCOO
                            ? "border-purple-500/40 bg-purple-500/15 text-purple-300"
                            : "border-accent/40 bg-accent/15 text-accent"
                        }`}
                      >
                        {a.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-bold text-zinc-100 hover:text-accent transition-colors">
                            <Link href={`/agents?id=${a.id}`}>{a.name}</Link>
                          </h3>
                        </div>
                        <p className="truncate text-xs text-zinc-400">{a.title}</p>
                        <p className="text-[11px] font-mono text-zinc-500">@{a.id}</p>
                      </div>
                    </div>

                    {/* Status Pill & Read-only badge */}
                    <div className="flex flex-col items-end gap-1">
                      {isFired ? (
                        <span className="shrink-0 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-bold text-rose-400">
                          🔴 {t.agents.firedStatus}
                        </span>
                      ) : (
                        <span
                          className={`shrink-0 flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusMeta.badgeClass}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
                          <span>{locale === "vi" ? statusMeta.labelVi : statusMeta.labelEn}</span>
                        </span>
                      )}
                      {!canControl && (
                        <span className="shrink-0 flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-400">
                          <Eye className="h-2.5 w-2.5" />
                          <span>{locale === "vi" ? "Chỉ xem" : "Read-only"}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Fired Warning Banner inside card */}
                  {isFired && (
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-[11px] text-rose-300">
                      <p className="font-semibold text-rose-200">
                        ⚠️ {a.suspendedReason === "FIRED_BY_FOUNDER" ? "Đã sa thải bởi Founder" : `Tạm dừng: ${a.suspendedReason || "SUSPENDED"}`}
                      </p>
                      <p className="mt-0.5 text-rose-300/80 text-[10px]">
                        Dữ liệu task và audit log được lưu trữ bất biến.
                      </p>
                    </div>
                  )}

                  {/* Badges: Department & Autonomy */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {a.department && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-zinc-900/60 px-2 py-0.5 text-[11px] text-zinc-300">
                        <Building2 className="h-3 w-3 text-zinc-400" />
                        {a.department.name}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-300 font-medium">
                      <Shield className="h-3 w-3 text-cyan-400" />
                      L{a.autonomyLevel ?? 1}
                    </span>
                  </div>

                  {/* Mission */}
                  <p className="line-clamp-2 text-xs text-zinc-400 leading-relaxed bg-zinc-950/40 p-2.5 rounded-lg border border-border/40">
                    {a.mission || "Chưa thiết lập nhiệm vụ cốt lõi."}
                  </p>

                  {/* Monthly Budget Progress */}
                  <div className="space-y-1.5 rounded-lg border border-border/40 bg-zinc-900/40 p-2.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400">Chi phí tháng này:</span>
                      <span className="font-semibold text-zinc-200 font-mono">
                        ${(a.monthlyCostUsd || 0).toFixed(2)}
                        {a.budgetCapUsd ? ` / $${a.budgetCapUsd}` : ""}
                      </span>
                    </div>
                    {a.budgetCapUsd ? (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className={`h-full transition-all ${
                            (a.monthlyCostUsd || 0) >= a.budgetCapUsd
                              ? "bg-rose-500"
                              : (a.monthlyCostUsd || 0) >= a.budgetCapUsd * 0.8
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                          }`}
                          style={{
                            width: `${Math.min(100, ((a.monthlyCostUsd || 0) / a.budgetCapUsd) * 100)}%`,
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {canControl && (
                      <button
                        onClick={() => openEditModal(a)}
                        title={t.agents.editBtn}
                        className="rounded-lg border border-border/80 bg-zinc-800/80 p-2 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {canControl && (
                      <Link
                        href={`/agents?id=${a.id}`}
                        title={t.agents.permissionsBtn}
                        className="rounded-lg border border-border/80 bg-zinc-800/80 p-2 text-zinc-300 hover:border-accent hover:text-accent transition-colors"
                      >
                        <Wrench className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>

                  {/* Primary Action Button based on state */}
                  {isFired ? (
                    canControl ? (
                      <button
                        onClick={() => handleRehire(a)}
                        disabled={actionLoadingId === a.id}
                        className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-md hover:bg-emerald-500 transition-all disabled:opacity-60 cursor-pointer"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        <span>{actionLoadingId === a.id ? t.common.loading : t.agents.rehireBtn}</span>
                      </button>
                    ) : (
                      <Link
                        href={`/agents?id=${a.id}`}
                        className="flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition-colors"
                      >
                        <span>{t.agents.viewDetailsBtn}</span>
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    )
                  ) : (
                    <div className="flex items-center gap-2">
                      {!isCOO && canControl && (
                        <button
                          onClick={() => setAgentToFire(a)}
                          disabled={actionLoadingId === a.id}
                          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer"
                        >
                          {t.agents.fireBtn}
                        </button>
                      )}
                      <Link
                        href={`/agents?id=${a.id}`}
                        className="flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition-colors"
                      >
                        <span>{t.agents.viewDetailsBtn}</span>
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fire Confirmation Modal */}
      {agentToFire && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-zinc-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 text-rose-400">
                <UserX className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-100">
                  {locale === "vi" ? "Xác nhận sa thải AI Agent" : "Confirm Agent Termination"}
                </h3>
                <p className="text-xs text-zinc-400 font-mono">@{agentToFire.id}</p>
              </div>
            </div>

            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300 space-y-1">
              <p className="font-semibold text-rose-200">
                {locale === "vi"
                  ? `Bạn có chắc muốn sa thải Agent "${agentToFire.name}"?`
                  : `Are you sure you want to terminate "${agentToFire.name}"?`}
              </p>
              <p className="text-rose-300/80">
                {locale === "vi"
                  ? "Agent này sẽ ngưng nhận nhiệm vụ mới. Toàn bộ lịch sử Task và Audit Log vẫn được lưu trữ nguyên vẹn và có thể Tái kích hoạt bất cứ lúc nào."
                  : "This agent will stop receiving new tasks. All history remains intact and can be reactivated anytime."}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setAgentToFire(null)}
                className="rounded-xl border border-border px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleConfirmFire}
                disabled={actionLoadingId === agentToFire.id}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 transition-colors disabled:opacity-60 cursor-pointer"
              >
                {actionLoadingId === agentToFire.id ? t.common.loading : t.agents.fireBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Agent Modal */}
      {editingAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border/80 bg-zinc-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-accent" />
                <h3 className="text-base font-bold text-zinc-100">
                  {locale === "vi" ? `Chỉnh sửa Agent: ${editingAgent.name}` : `Edit Agent: ${editingAgent.name}`}
                </h3>
              </div>
              <button
                onClick={() => setEditingAgent(null)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-400">Tên Agent</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full rounded-lg border border-border/80 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 focus:border-accent focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-400">Chức danh</label>
                  <input
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded-lg border border-border/80 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-400">Phòng ban</label>
                  <select
                    value={editDeptId}
                    onChange={(e) => setEditDeptId(e.target.value)}
                    className="w-full rounded-lg border border-border/80 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 focus:border-accent focus:outline-none"
                  >
                    <option value="">(Không trực thuộc)</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-400">Mức tự chủ (Autonomy)</label>
                  <select
                    value={editAutonomy}
                    onChange={(e) => setEditAutonomy(Number(e.target.value))}
                    className="w-full rounded-lg border border-border/80 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 focus:border-accent focus:outline-none"
                  >
                    {AUTONOMY_NAMES.map((name, idx) => (
                      <option key={idx} value={idx}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-400">Sứ mệnh / Nhiệm vụ cốt lõi (Mission)</label>
                <textarea
                  rows={3}
                  required
                  value={editMission}
                  onChange={(e) => setEditMission(e.target.value)}
                  className="w-full rounded-lg border border-border/80 bg-zinc-900 p-2.5 text-xs text-zinc-200 focus:border-accent focus:outline-none leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setEditingAgent(null)}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded-xl bg-accent px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-accent/90 transition-colors disabled:opacity-60"
                >
                  {savingEdit ? t.common.saving : t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
