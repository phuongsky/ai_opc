"use client";

import { useState, useEffect } from "react";
import {
  Wrench,
  Plus,
  Shield,
  Trash2,
  Edit2,
  X,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Info,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import {
  fetchTools,
  createTool,
  setAgentToolPermission,
  removeAgentToolPermission,
} from "@/lib/api";

export interface ToolItem {
  id: string;
  name: string;
  description: string | null;
  riskLevel: string;
  requiresApproval: boolean;
  _count?: { permissions: number };
}

export interface ToolPermissionRow {
  toolId: string;
  permissionLevel: string;
  tool: ToolItem;
}

const PERMISSION_LEVELS: {
  level: string;
  name: string;
  desc: string;
  color: string;
  badge: string;
  needsApprovalDefault: boolean;
}[] = [
  {
    level: "L0",
    name: "L0 · Không có quyền",
    desc: "Bị chặn truy cập hoàn toàn.",
    color: "text-zinc-500",
    badge: "bg-zinc-800 text-zinc-400 border-zinc-700",
    needsApprovalDefault: false,
  },
  {
    level: "L1",
    name: "L1 · Đọc công khai (Public Read)",
    desc: "Chỉ đọc dữ liệu công khai trên Internet (Web search, cào dữ liệu).",
    color: "text-blue-400",
    badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    needsApprovalDefault: false,
  },
  {
    level: "L2",
    name: "L2 · Đọc nội bộ (Internal Read)",
    desc: "Đọc dữ liệu nội bộ không nhạy cảm (DB Read, Knowledge Base).",
    color: "text-sky-400",
    badge: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    needsApprovalDefault: false,
  },
  {
    level: "L3",
    name: "L3 · Bản nháp (Draft / Staging)",
    desc: "Tạo bản nháp, lưu trữ sandbox, không ảnh hưởng Production.",
    color: "text-cyan-400",
    badge: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    needsApprovalDefault: false,
  },
  {
    level: "L4",
    name: "L4 · Ghi an toàn (Low-Risk Write)",
    desc: "Ghi dữ liệu thật nhưng trong phạm vi an toàn / mẫu đã duyệt.",
    color: "text-emerald-400",
    badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    needsApprovalDefault: false,
  },
  {
    level: "L5",
    name: "L5 · Ghi rủi ro cao (High-Risk Write)",
    desc: "Sửa đổi DB trực tiếp — Luôn cần Founder phê duyệt trước khi chạy.",
    color: "text-amber-400",
    badge: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    needsApprovalDefault: true,
  },
  {
    level: "L6",
    name: "L6 · Nghiêm trọng / Tài chính (Critical)",
    desc: "Chuyển tiền, Deploy Production, xóa DB — Luôn cần Founder duyệt + 2FA.",
    color: "text-rose-400",
    badge: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    needsApprovalDefault: true,
  },
];

const RISK_CONFIG: Record<
  string,
  { label: string; badge: string; dot: string; desc: string }
> = {
  R0: {
    label: "R0 · An toàn",
    badge: "bg-zinc-800 text-zinc-400 border-zinc-700",
    dot: "bg-zinc-400",
    desc: "Không tác dụng phụ",
  },
  R1: {
    label: "R1 · Thấp",
    badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    dot: "bg-blue-400",
    desc: "Đọc thông tin",
  },
  R2: {
    label: "R2 · Trung bình",
    badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dot: "bg-amber-400",
    desc: "Ghi dữ liệu nhẹ",
  },
  R3: {
    label: "R3 · Cao (Cần duyệt)",
    badge: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    dot: "bg-orange-400",
    desc: "Cần Founder duyệt",
  },
  R4: {
    label: "R4 · Nghiêm trọng (2FA)",
    badge: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    dot: "bg-rose-400",
    desc: "Tài chính / Hạ tầng / 2FA",
  },
};

export function AgentToolPermissionManager({
  agentId,
  agentName,
  permissions,
  onUpdated,
}: {
  agentId: string;
  agentName: string;
  permissions: ToolPermissionRow[];
  onUpdated: () => void;
}) {
  const [allTools, setAllTools] = useState<ToolItem[]>([]);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Grant Modal state
  const [selectedToolId, setSelectedToolId] = useState("");
  const [selectedLevel, setSelectedLevel] = useState("L2");
  const [submittingGrant, setSubmittingGrant] = useState(false);
  const [grantError, setGrantError] = useState("");

  // Create Tool Modal state
  const [newToolId, setNewToolId] = useState("");
  const [newToolName, setNewToolName] = useState("");
  const [newToolDesc, setNewToolDesc] = useState("");
  const [newToolRisk, setNewToolRisk] = useState("R2");
  const [newToolRequiresApproval, setNewToolRequiresApproval] = useState(false);
  const [autoGrantNewTool, setAutoGrantNewTool] = useState(true);
  const [newToolGrantLevel, setNewToolGrantLevel] = useState("L4");
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [createError, setCreateError] = useState("");

  const loadAllTools = async () => {
    try {
      const data = await fetchTools();
      setAllTools(data as ToolItem[]);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadAllTools();
  }, []);

  const openGrantModalForTool = (toolId?: string, defaultLevel = "L2") => {
    setGrantError("");
    const available = allTools.find((t) => t.id === toolId) || allTools[0];
    setSelectedToolId(toolId || available?.id || "");
    setSelectedLevel(defaultLevel);
    setShowGrantModal(true);
  };

  const handleGrantPermission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedToolId) {
      setGrantError("Vui lòng chọn công cụ");
      return;
    }
    setSubmittingGrant(true);
    setGrantError("");
    try {
      await setAgentToolPermission(agentId, selectedToolId, selectedLevel);
      setShowGrantModal(false);
      onUpdated();
    } catch (err) {
      setGrantError(err instanceof Error ? err.message : "Cấp quyền thất bại");
    } finally {
      setSubmittingGrant(false);
    }
  };

  const handleRemovePermission = async (toolId: string, toolName: string) => {
    if (!window.confirm(`Bạn có chắc muốn gỡ quyền sử dụng "${toolName}" khỏi Agent "${agentName}"?`)) {
      return;
    }
    try {
      await removeAgentToolPermission(agentId, toolId);
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gỡ quyền thất bại");
    }
  };

  const handleCreateTool = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingCreate(true);
    setCreateError("");
    try {
      const tool = (await createTool({
        id: newToolId.trim(),
        name: newToolName.trim(),
        description: newToolDesc.trim() || undefined,
        riskLevel: newToolRisk,
        requiresApproval: newToolRequiresApproval,
      })) as ToolItem;

      await loadAllTools();

      // Tự động cấp quyền cho Agent hiện tại nếu được chọn
      if (autoGrantNewTool) {
        await setAgentToolPermission(agentId, tool.id, newToolGrantLevel);
      }

      setShowCreateModal(false);
      // Reset form
      setNewToolId("");
      setNewToolName("");
      setNewToolDesc("");
      setNewToolRisk("R2");
      setNewToolRequiresApproval(false);
      onUpdated();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Tạo tool thất bại");
    } finally {
      setSubmittingCreate(false);
    }
  };

  // Preview whether the selected grant triggers Founder approval
  const selectedToolObj = allTools.find((t) => t.id === selectedToolId);
  const isLevelL5L6 = selectedLevel === "L5" || selectedLevel === "L6";
  const isRiskR3R4 = selectedToolObj?.riskLevel === "R3" || selectedToolObj?.riskLevel === "R4";
  const isApprovalMandatory = isLevelL5L6 || isRiskR3R4 || !!selectedToolObj?.requiresApproval;

  return (
    <div className="rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-accent/10 p-2 text-accent">
            <Wrench className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Quyền sử dụng Tool (Permission Matrix)</h2>
            <p className="text-xs text-zinc-500">
              Quản lý các công cụ và cấp độ quyền hạn (L0 - L6) cho Agent {agentName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCreateError("");
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/80 bg-canvas/80 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-600 hover:bg-white/5 transition-all cursor-pointer shadow-sm"
          >
            <Plus className="h-3.5 w-3.5 text-accent" />
            <span>Tạo Tool Mới</span>
          </button>

          <button
            type="button"
            onClick={() => openGrantModalForTool()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-1.5 text-xs font-semibold text-black hover:bg-accent/90 transition-all cursor-pointer shadow-sm"
          >
            <Shield className="h-3.5 w-3.5" />
            <span>+ Cấp Quyền Tool</span>
          </button>
        </div>
      </div>

      {/* Permissions List */}
      {permissions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-canvas/40 p-6 text-center text-xs text-zinc-500 space-y-2">
          <p className="text-zinc-400 font-medium">Agent này chưa được cấp quyền sử dụng công cụ nào.</p>
          <p className="text-zinc-500">
            Theo nguyên tắc <em>Least Privilege</em>, Agent chỉ có thể gọi Tool khi được Founder cấp quyền từ L1 đến L6.
          </p>
          <button
            type="button"
            onClick={() => openGrantModalForTool()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1 text-xs text-zinc-200 hover:bg-white/20 transition-colors"
          >
            <Plus className="h-3 w-3 text-accent" /> Cấp quyền ngay
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {permissions.map((p) => {
            const risk = RISK_CONFIG[p.tool.riskLevel] ?? RISK_CONFIG.R1;
            const perm = PERMISSION_LEVELS.find((l) => l.level === p.permissionLevel) ?? PERMISSION_LEVELS[1];
            const willRequireApproval =
              p.permissionLevel === "L5" ||
              p.permissionLevel === "L6" ||
              p.tool.riskLevel === "R3" ||
              p.tool.riskLevel === "R4" ||
              p.tool.requiresApproval;

            return (
              <div
                key={p.toolId}
                className="group relative flex flex-col justify-between rounded-xl border border-border/80 bg-canvas/70 p-3.5 text-xs transition-all hover:border-zinc-600/80 hover:bg-canvas shadow-sm space-y-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-zinc-200 truncate group-hover:text-zinc-100">
                        {p.tool.name}
                      </p>
                      <p className="font-mono text-[10px] text-zinc-500 truncate">{p.toolId}</p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => openGrantModalForTool(p.toolId, p.permissionLevel)}
                        title="Chỉnh sửa quyền"
                        className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 transition-colors cursor-pointer"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemovePermission(p.toolId, p.tool.name)}
                        title="Gỡ quyền khỏi Agent"
                        className="rounded p-1 text-zinc-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {p.tool.description && (
                    <p className="line-clamp-2 text-[11px] text-zinc-400 leading-relaxed">
                      {p.tool.description}
                    </p>
                  )}
                </div>

                {/* Badges footer */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-border/40 pt-2 text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono font-medium ${perm.badge}`}>
                      {perm.level}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono ${risk.badge}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${risk.dot}`} />
                      {p.tool.riskLevel}
                    </span>
                  </div>

                  {willRequireApproval ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] text-amber-400 border border-amber-500/20">
                      <Shield className="h-2.5 w-2.5" /> Duyệt Founder
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="h-2.5 w-2.5" /> Tự động
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: Cấp / Sửa Quyền Tool */}
      {showGrantModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowGrantModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-panel shadow-2xl p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border/60 pb-3">
              <div className="space-y-0.5">
                <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-accent" />
                  Cấp Quyền Tool Cho Agent: {agentName}
                </h3>
                <p className="text-xs text-zinc-400">
                  Thiết lập cấp độ quyền hạn theo Rulebook Governance L0 - L6
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGrantModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleGrantPermission} className="space-y-4">
              {/* Chọn Tool */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-zinc-300 font-medium">
                  <label>Chọn Công cụ (Tool)</label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowGrantModal(false);
                      setShowCreateModal(true);
                    }}
                    className="text-accent hover:underline text-[11px] flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" /> Tạo tool mới
                  </button>
                </div>
                <select
                  value={selectedToolId}
                  onChange={(e) => setSelectedToolId(e.target.value)}
                  className="w-full rounded-xl border border-border/80 bg-canvas/90 p-2.5 text-xs text-zinc-100 outline-none focus:border-accent"
                >
                  {allTools.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.id}) — [{t.riskLevel}] {t.requiresApproval ? "(Buộc duyệt)" : ""}
                    </option>
                  ))}
                </select>
                {selectedToolObj?.description && (
                  <p className="text-[11px] text-zinc-500 pl-1">{selectedToolObj.description}</p>
                )}
              </div>

              {/* Chọn Permission Level */}
              <div className="space-y-2">
                <label className="text-xs text-zinc-300 font-medium block">
                  Cấp độ Quyền hạn (Permission Level)
                </label>
                <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
                  {PERMISSION_LEVELS.map((lvl) => (
                    <label
                      key={lvl.level}
                      onClick={() => setSelectedLevel(lvl.level)}
                      className={`flex items-start gap-3 rounded-xl border p-2.5 text-xs cursor-pointer transition-all ${
                        selectedLevel === lvl.level
                          ? "border-accent bg-accent/10 text-zinc-100"
                          : "border-border/60 bg-canvas/40 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      <input
                        type="radio"
                        name="permissionLevel"
                        value={lvl.level}
                        checked={selectedLevel === lvl.level}
                        onChange={() => setSelectedLevel(lvl.level)}
                        className="mt-0.5 accent-accent"
                      />
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold ${lvl.color}`}>{lvl.name}</span>
                          {lvl.needsApprovalDefault && (
                            <span className="rounded bg-amber-500/15 px-1.5 py-0.2 font-mono text-[9px] text-amber-400 border border-amber-500/30">
                              Duyệt Founder
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-400">{lvl.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Approval Warning Banner */}
              {isApprovalMandatory ? (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                  <Shield className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                  <p className="text-[11px] leading-relaxed">
                    <strong>Lưu ý:</strong> Khi Agent gọi tool này, hệ thống sẽ tự động tạo một <em>Decision Package</em> ở trạng thái <code>PENDING</code> và tạm dừng task để chờ Founder phê duyệt.
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                  <p className="text-[11px] leading-relaxed">
                    Quyền này cho phép Agent thực thi công cụ tự động không cần qua bước phê duyệt thủ công.
                  </p>
                </div>
              )}

              {grantError && <p className="text-xs text-danger font-medium">{grantError}</p>}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setShowGrantModal(false)}
                  className="rounded-xl border border-border/80 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/5 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submittingGrant}
                  className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black hover:bg-accent/90 disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {submittingGrant ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
                  Lưu Quyền Hạn
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Tạo Tool Mới */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-panel shadow-2xl p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border/60 pb-3">
              <div className="space-y-0.5">
                <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-accent" />
                  Định Nghĩa Tool Mới
                </h3>
                <p className="text-xs text-zinc-400">
                  Thêm một công cụ mới vào Tool Registry của AI-OPC
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTool} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-zinc-300 font-medium block">
                    Tool ID (mã định danh duy nhất) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="vd: tool_crm_sync"
                    value={newToolId}
                    onChange={(e) => setNewToolId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                    className="w-full rounded-xl border border-border/80 bg-canvas/90 p-2.5 font-mono text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent"
                  />
                  <p className="text-[10px] text-zinc-500">Chữ thường, số và gạch dưới.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-zinc-300 font-medium block">Tên Công Cụ *</label>
                  <input
                    type="text"
                    required
                    placeholder="vd: Đồng bộ khách hàng vào CRM"
                    value={newToolName}
                    onChange={(e) => setNewToolName(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-canvas/90 p-2.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-zinc-300 font-medium block">Mô Tả Chức Năng</label>
                <textarea
                  rows={2}
                  placeholder="vd: Cập nhật lead từ website vào CRM nội bộ qua API"
                  value={newToolDesc}
                  onChange={(e) => setNewToolDesc(e.target.value)}
                  className="w-full rounded-xl border border-border/80 bg-canvas/90 p-2.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent"
                />
              </div>

              {/* Mức rủi ro Risk Level */}
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-300 font-medium block">Mức Rủi Ro (Risk Level)</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Object.entries(RISK_CONFIG).map(([key, val]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setNewToolRisk(key)}
                      className={`flex flex-col items-start rounded-xl border p-2 text-left text-xs transition-all cursor-pointer ${
                        newToolRisk === key
                          ? "border-accent bg-accent/10"
                          : "border-border/60 bg-canvas/40 hover:border-zinc-700"
                      }`}
                    >
                      <span className="font-semibold text-zinc-200">{val.label}</span>
                      <span className="text-[10px] text-zinc-400 mt-0.5">{val.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Checkbox requiresApproval */}
              <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-canvas/40 p-3">
                <input
                  type="checkbox"
                  id="reqApp"
                  checked={newToolRequiresApproval}
                  onChange={(e) => setNewToolRequiresApproval(e.target.checked)}
                  className="h-4 w-4 accent-accent rounded"
                />
                <label htmlFor="reqApp" className="text-xs text-zinc-300 cursor-pointer select-none">
                  <span className="font-medium">Luôn yêu cầu Founder duyệt trước khi chạy</span>
                  <p className="text-[11px] text-zinc-500">
                    Bật tùy chọn này nếu tool có tác động thay đổi hệ thống quan trọng.
                  </p>
                </label>
              </div>

              {/* Auto-grant to current agent checkbox */}
              <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="autoGrant"
                    checked={autoGrantNewTool}
                    onChange={(e) => setAutoGrantNewTool(e.target.checked)}
                    className="h-4 w-4 accent-accent rounded"
                  />
                  <label htmlFor="autoGrant" className="text-xs text-zinc-200 font-medium cursor-pointer select-none">
                    Cấp quyền sử dụng tool này ngay cho Agent {agentName}
                  </label>
                </div>
                {autoGrantNewTool && (
                  <div className="pl-6 flex items-center gap-2 text-xs">
                    <span className="text-zinc-400">Với quyền:</span>
                    <select
                      value={newToolGrantLevel}
                      onChange={(e) => setNewToolGrantLevel(e.target.value)}
                      className="rounded-lg border border-border bg-canvas px-2 py-1 text-xs text-zinc-200 outline-none"
                    >
                      {PERMISSION_LEVELS.map((lvl) => (
                        <option key={lvl.level} value={lvl.level}>
                          {lvl.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {createError && <p className="text-xs text-danger font-medium">{createError}</p>}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-border/80 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/5 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submittingCreate}
                  className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black hover:bg-accent/90 disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {submittingCreate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Tạo & Đăng Ký Tool
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
