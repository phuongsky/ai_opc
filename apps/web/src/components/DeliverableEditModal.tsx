"use client";

import { useState, useEffect } from "react";
import {
  X,
  Sparkles,
  Save,
  Loader2,
  AlertTriangle,
  Check,
  FileText,
  Eye,
  Code2,
  Copy,
  Layers,
} from "lucide-react";
import type { Task } from "@ai-opc/shared";
import { updateTaskDeliverable } from "@/lib/api";

interface DeliverableEditModalProps {
  task: Task | null;
  initialText: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (newText: string) => void;
}

export function DeliverableEditModal({
  task,
  initialText,
  isOpen,
  onClose,
  onSaved,
}: DeliverableEditModalProps) {
  const [content, setContent] = useState("");
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setContent(initialText || "");
      setActiveTab("edit");
      setErrorMsg("");
      setSaveSuccess(false);
      setCopied(false);
    }
  }, [isOpen, initialText]);

  // Keyboard shortcut: Ctrl/Cmd + S to save, Esc to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, content, task]);

  if (!isOpen || !task) return null;

  const handleSave = async () => {
    if (!task) return;
    setIsSaving(true);
    setErrorMsg("");
    try {
      await updateTaskDeliverable(task.id, content);
      setSaveSuccess(true);
      onSaved(content);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 700);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Lưu thay đổi kết quả bàn giao thất bại."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lineCount = content ? content.split("\n").length : 0;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl border border-border/80 bg-zinc-900/95 shadow-2xl shadow-black/80 overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/70 bg-zinc-900/80">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-100">
                  Chỉnh sửa Kết quả bàn giao (Agent Output)
                </h2>
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-zinc-400 border border-border/60">
                  #{task.id.slice(0, 8)}
                </span>
              </div>
              <p className="text-xs text-zinc-400 truncate max-w-xl">
                {task.title}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopy}
              title="Sao chép nội dung"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border/70 bg-white/5 text-xs text-zinc-300 hover:bg-white/10 hover:text-zinc-100 transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-400 text-[11px]">Đã chép</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-[11px]">Sao chép</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Đóng modal (Esc)"
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Toolbar & Tab Switcher */}
        <div className="flex flex-wrap items-center justify-between px-5 py-2.5 border-b border-border/50 bg-zinc-950/60 text-xs">
          <div className="flex items-center gap-1 bg-zinc-900/80 p-0.5 rounded-lg border border-border/60">
            <button
              type="button"
              onClick={() => setActiveTab("edit")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                activeTab === "edit"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              <span>Soạn thảo Markdown</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("preview")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                activeTab === "preview"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Xem trước</span>
            </button>
          </div>

          <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-400">
            <span>{lineCount} dòng</span>
            <span>·</span>
            <span>{wordCount} từ</span>
            <span>·</span>
            <span>{charCount} ký tự</span>
          </div>
        </div>

        {/* Error / Success Notifications */}
        {errorMsg && (
          <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/20 px-3.5 py-2 text-xs text-rose-300 animate-in fade-in duration-150">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {saveSuccess && (
          <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 px-3.5 py-2 text-xs text-emerald-300 animate-in fade-in duration-150">
            <Check className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>Đã lưu kết quả bàn giao thành công!</span>
          </div>
        )}

        {/* Editor / Preview Content Area */}
        <div className="flex-1 p-5 min-h-[380px] max-h-[60vh] overflow-hidden flex flex-col">
          {activeTab === "edit" ? (
            <div className="flex-1 flex flex-col relative h-full">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Nhập nội dung văn bản bàn giao / tài liệu SOP tại đây (hỗ trợ Markdown chuẩn)..."
                className="w-full flex-1 h-full min-h-[340px] resize-none rounded-xl bg-zinc-950 p-4 font-mono text-xs text-zinc-100 placeholder-zinc-500 border border-border/80 focus:border-emerald-500/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 leading-relaxed selection:bg-emerald-500/30 shadow-inner overflow-y-auto"
                autoFocus
              />
            </div>
          ) : (
            <div className="w-full flex-1 min-h-[340px] overflow-y-auto rounded-xl bg-zinc-950/80 p-4 font-sans text-xs text-zinc-200 leading-relaxed border border-border/80 whitespace-pre-wrap selection:bg-emerald-500/30">
              {content ? (
                content
              ) : (
                <p className="text-zinc-500 italic">Chưa có nội dung văn bản bàn giao để xem trước.</p>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-border/70 bg-zinc-900/90">
          <p className="text-[11px] text-zinc-500 hidden sm:block">
            Mẹo: Nhấn <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono text-zinc-300">Ctrl + S</kbd> để lưu nhanh, <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono text-zinc-300">Esc</kbd> để thoát.
          </p>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-xl border border-border/80 bg-white/5 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/10 hover:text-zinc-100 transition-colors cursor-pointer disabled:opacity-50"
            >
              Hủy bỏ
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-950/50 transition-all cursor-pointer disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Đang lưu...</span>
                </>
              ) : saveSuccess ? (
                <>
                  <Check className="h-4 w-4 text-emerald-200" />
                  <span>Đã lưu!</span>
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  <span>Lưu thay đổi</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
