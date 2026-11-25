"use client";

import { useState, useEffect } from "react";
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  Clock,
  Loader2,
  X,
  ShieldAlert,
  Calendar,
  User,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import type { Task } from "@ai-opc/shared";
import {
  fetchTrashTasks,
  restoreTaskFromTrash,
  permanentlyDeleteTask,
  emptyTrashTasks,
} from "@/lib/api";

function formatDateTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

/** Tính số ngày còn lại trước khi bị xóa tự động (30 ngày từ updatedAt) */
function getRemainingDays(updatedAtStr?: string | null): number {
  if (!updatedAtStr) return 30;
  try {
    const updated = new Date(updatedAtStr).getTime();
    const expiry = updated + 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    return Math.max(0, Math.min(30, diffDays));
  } catch {
    return 30;
  }
}

export function TaskTrashModal({
  isOpen,
  onClose,
  onTasksChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  onTasksChanged?: () => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Action states
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isEmptying, setIsEmptying] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // Confirmation modal states
  const [confirmDeleteTask, setConfirmDeleteTask] = useState<Task | null>(null);
  const [confirmEmptyAll, setConfirmEmptyAll] = useState(false);

  const loadTrash = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchTrashTasks();
      setTasks(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải danh sách thùng rác.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadTrash();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRestore = async (task: Task) => {
    setRestoringId(task.id);
    setSuccessMsg("");
    setError("");
    try {
      await restoreTaskFromTrash(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      setSuccessMsg(`Đã khôi phục thành công tác vụ #${task.id.slice(0, 8)} về bảng Kanban.`);
      setTimeout(() => setSuccessMsg(""), 3500);
      onTasksChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Khôi phục tác vụ thất bại.");
    } finally {
      setRestoringId(null);
    }
  };

  const handlePermanentDelete = async () => {
    if (!confirmDeleteTask) return;
    const task = confirmDeleteTask;
    setDeletingId(task.id);
    setSuccessMsg("");
    setError("");
    try {
      await permanentlyDeleteTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      setSuccessMsg(`Đã xóa vĩnh viễn tác vụ #${task.id.slice(0, 8)} khỏi hệ thống.`);
      setTimeout(() => setSuccessMsg(""), 3500);
      setConfirmDeleteTask(null);
      onTasksChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xóa vĩnh viễn tác vụ thất bại.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleEmptyAll = async () => {
    setIsEmptying(true);
    setSuccessMsg("");
    setError("");
    try {
      const res = await emptyTrashTasks();
      setTasks([]);
      setSuccessMsg(`Đã dọn sạch ${res?.deletedCount ?? 0} tác vụ trong thùng rác.`);
      setTimeout(() => setSuccessMsg(""), 3500);
      setConfirmEmptyAll(false);
      onTasksChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dọn sạch thùng rác thất bại.");
    } finally {
      setIsEmptying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl border border-border bg-panel shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border/80 bg-zinc-900/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-zinc-100">Thùng rác tác vụ</h2>
                <span className="rounded-full bg-rose-500/15 border border-rose-500/30 px-2.5 py-0.5 text-xs font-mono font-medium text-rose-400">
                  {tasks.length} task
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Các tác vụ bị xóa tạm thời sẽ được lưu giữ và{" "}
                <strong className="text-amber-400 font-medium">tự động xóa vĩnh viễn sau 30 ngày</strong>.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {tasks.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmEmptyAll(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition-all cursor-pointer shadow-sm"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Dọn sạch thùng rác</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Notifications Bar */}
        {successMsg && (
          <div className="flex items-center gap-2 border-b border-emerald-500/30 bg-emerald-500/10 px-6 py-2.5 text-xs text-emerald-400 animate-in fade-in duration-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 border-b border-rose-500/30 bg-rose-500/10 px-6 py-2.5 text-xs text-rose-400 animate-in fade-in duration-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Modal Body - Tasks List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <Loader2 className="h-8 w-8 animate-spin text-accent mb-3" />
              <p className="text-sm">Đang tải danh sách tác vụ trong thùng rác...</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 text-zinc-500 mb-3 border border-border/40">
                <Trash2 className="h-8 w-8 opacity-40" />
              </div>
              <p className="text-sm font-medium text-zinc-300">Thùng rác đang rỗng</p>
              <p className="text-xs text-zinc-500 max-w-sm mt-1">
                Không có tác vụ nào đang nằm trong thùng rác. Khi bạn xóa task từ Modal chi tiết, task sẽ xuất hiện tại đây.
              </p>
            </div>
          ) : (
            tasks.map((t) => {
              const remainingDays = getRemainingDays(t.createdAt);
              const isRestoring = restoringId === t.id;
              const isDeleting = deletingId === t.id;

              return (
                <div
                  key={t.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-border/80 bg-zinc-900/40 p-4 hover:border-zinc-700 transition-all group"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-border/50">
                        #{t.id.slice(0, 10)}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                        <Clock className="h-3 w-3" />
                        Tự động xóa sau {remainingDays} ngày
                      </span>
                      {t.assignedTo && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300 border border-border/50">
                          <User className="h-3 w-3 text-zinc-400" />
                          {t.assignedTo}
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-semibold text-zinc-200 line-clamp-1 group-hover:text-zinc-100">
                      {t.title}
                    </h3>
                    <p className="text-xs text-zinc-400 line-clamp-2">{t.objective}</p>
                  </div>

                  {/* Actions: Khôi phục & Xóa ngay */}
                  <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-border/40">
                    <button
                      type="button"
                      onClick={() => handleRestore(t)}
                      disabled={isRestoring || isDeleting}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-all cursor-pointer disabled:opacity-50"
                      title="Khôi phục tác vụ về lại bảng Kanban"
                    >
                      {isRestoring ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      <span>Khôi phục</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmDeleteTask(t)}
                      disabled={isRestoring || isDeleting}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20 transition-all cursor-pointer disabled:opacity-50"
                      title="Xóa vĩnh viễn khỏi cơ sở dữ liệu ngay lập tức"
                    >
                      {isDeleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      <span>Xóa ngay</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-border/80 bg-zinc-900/40 px-6 py-3 text-xs text-zinc-500">
          <span>Hệ thống tự động quét và dọn dẹp các task trong thùng rác mỗi ngày.</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-zinc-300 hover:bg-white/5 transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* Confirmation Dialog: Delete Single Task */}
      {confirmDeleteTask && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setConfirmDeleteTask(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-panel p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-rose-400">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 border border-rose-500/20">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-zinc-100">Xác nhận xóa vĩnh viễn</h3>
                <p className="text-xs text-zinc-400">Hành động này không thể hoàn tác</p>
              </div>
            </div>

            <p className="text-sm text-zinc-300">
              Bạn có chắc chắn muốn xóa vĩnh viễn tác vụ{" "}
              <strong className="text-white font-medium">"{confirmDeleteTask.title}"</strong> (
              <span className="font-mono text-zinc-400">#{confirmDeleteTask.id.slice(0, 8)}</span>)? Toàn bộ dữ
              liệu và quyết định liên quan sẽ bị xóa khỏi cơ sở dữ liệu.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteTask(null)}
                className="rounded-xl border border-border px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/5 transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handlePermanentDelete}
                disabled={!!deletingId}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                {deletingId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                <span>Xóa vĩnh viễn</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Empty All Trash */}
      {confirmEmptyAll && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setConfirmEmptyAll(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-panel p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-rose-400">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 border border-rose-500/20">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-zinc-100">Dọn sạch toàn bộ thùng rác?</h3>
                <p className="text-xs text-zinc-400">Xóa vĩnh viễn tất cả {tasks.length} tác vụ</p>
              </div>
            </div>

            <p className="text-sm text-zinc-300">
              Bạn có chắc chắn muốn dọn sạch tất cả{" "}
              <strong className="text-rose-400 font-semibold">{tasks.length} tác vụ</strong> hiện có trong thùng
              rác? Hành động này sẽ xóa vĩnh viễn toàn bộ dữ liệu và không thể khôi phục.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmEmptyAll(false)}
                className="rounded-xl border border-border px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/5 transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleEmptyAll}
                disabled={isEmptying}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                {isEmptying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                <span>Xác nhận dọn sạch</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
