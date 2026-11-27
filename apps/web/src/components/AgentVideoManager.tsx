"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Film,
  Plus,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Archive,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Terminal,
  Clapperboard,
} from "lucide-react";
import type { VideoAsset, VideoStatus } from "@ai-opc/shared";
import {
  archiveVideoAsset,
  createVideoAsset,
  fetchVideoStats,
  fetchVideos,
  setVideoAssetStatus,
  type VideoStats,
} from "@/lib/api";
import { useCompanySocket } from "@/hooks/useCompanySocket";
import { useI18n } from "@/context/I18nContext";

const STATUS_ORDER: VideoStatus[] = [
  "IDEA",
  "SCRIPTED",
  "GENERATING",
  "REVIEW",
  "APPROVED",
  "PUBLISHED",
  "REJECTED",
  "FAILED",
  "ARCHIVED",
];

const STATUS_STYLE: Record<VideoStatus, string> = {
  IDEA: "border-zinc-600/50 bg-zinc-500/10 text-zinc-300",
  SCRIPTED: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  GENERATING: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  REVIEW: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  APPROVED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  PUBLISHED: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  REJECTED: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  FAILED: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  ARCHIVED: "border-zinc-700/60 bg-zinc-800/40 text-zinc-500",
};

const PLATFORMS = ["youtube", "tiktok", "facebook", "instagram", "zalo", "website", "internal"];
const RATIOS = ["16:9", "9:16", "1:1", "4:5"];

const inputCls =
  "w-full rounded-xl border border-border/80 bg-canvas/90 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent focus:ring-1 focus:ring-accent";

function StatusBadge({ status }: { status: VideoStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${STATUS_STYLE[status]}`}>
      {status}
    </span>
  );
}

export function AgentVideoManager({ readOnly = false }: { readOnly?: boolean }) {
  const { locale } = useI18n();
  const L = (vi: string, en: string) => (locale === "vi" ? vi : en);
  const { lastEvent } = useCompanySocket();

  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [stats, setStats] = useState<VideoStats | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    brief: "",
    script: "",
    platform: "",
    aspectRatio: "16:9",
    durationSec: "",
    tags: "",
  });

  const load = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([
        fetchVideos({ status: statusFilter || undefined, q: query.trim() || undefined }),
        fetchVideoStats(),
      ]);
      setVideos(list);
      setStats(st);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, query]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 300 : 0); // debounce khi gõ tìm kiếm
    return () => clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    if (lastEvent?.type === "VIDEO_UPDATED") load();
  }, [lastEvent, load]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e?.message || "Error");
    } finally {
      setBusyId(null);
    }
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await createVideoAsset({
        title: form.title.trim(),
        brief: form.brief.trim() || null,
        script: form.script.trim() || null,
        platform: form.platform || null,
        aspectRatio: form.aspectRatio,
        durationSec: form.durationSec ? Number(form.durationSec) : null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      setForm({ title: "", brief: "", script: "", platform: "", aspectRatio: "16:9", durationSec: "", tags: "" });
      setShowForm(false);
      await load();
    } catch (e: any) {
      setError(e?.message || "Error");
    } finally {
      setSaving(false);
    }
  }

  const statusChips = useMemo(
    () => STATUS_ORDER.filter((s) => (stats?.byStatus[s] ?? 0) > 0),
    [stats]
  );

  return (
    <div className="rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <Film className="h-4 w-4 text-violet-400" />
          {L("Thư viện video", "Video Library")}
          {stats && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
              {stats.total}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            title={L("Làm mới", "Refresh")}
            className="flex items-center gap-1.5 rounded-lg border border-border/80 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-200 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          {!readOnly && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black hover:bg-accent/90 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              {L("Tạo video", "New video")}
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="flex flex-wrap items-center gap-2">
          {statusChips.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-all cursor-pointer ${
                statusFilter === s ? STATUS_STYLE[s] : "border-border/80 bg-white/5 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span className="font-mono">{s}</span>
              <span className="font-semibold">{stats.byStatus[s]}</span>
            </button>
          ))}
          <span className="ml-auto text-[11px] text-zinc-500">
            {L("Chi phí sinh video", "Generation cost")}: ${stats.totalCostUsd.toFixed(2)}
          </span>
        </div>
      )}

      {/* Create form */}
      {showForm && !readOnly && (
        <form onSubmit={submitForm} className="space-y-3 rounded-xl border border-border/80 bg-canvas/60 p-4">
          <input
            required
            maxLength={300}
            placeholder={L("Tiêu đề video *", "Video title *")}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className={inputCls}
          />
          <textarea
            rows={2}
            placeholder={L("Brief / ý tưởng", "Brief / idea")}
            value={form.brief}
            onChange={(e) => setForm({ ...form, brief: e.target.value })}
            className={inputCls}
          />
          <textarea
            rows={4}
            placeholder={L("Kịch bản (Hook → Nội dung → CTA). Có script thì video vào SCRIPTED.", "Script (Hook → Body → CTA). With a script the video becomes SCRIPTED.")}
            value={form.script}
            onChange={(e) => setForm({ ...form, script: e.target.value })}
            className={inputCls}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} className={inputCls}>
              <option value="">{L("Nền tảng…", "Platform…")}</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select value={form.aspectRatio} onChange={(e) => setForm({ ...form, aspectRatio: e.target.value })} className={inputCls}>
              {RATIOS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={3600}
              placeholder={L("Thời lượng (giây)", "Duration (s)")}
              value={form.durationSec}
              onChange={(e) => setForm({ ...form, durationSec: e.target.value })}
              className={inputCls}
            />
            <input
              placeholder={L("Tags, cách nhau dấu phẩy", "Tags, comma separated")}
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              className={inputCls}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-border/80 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer">
              {L("Hủy", "Cancel")}
            </button>
            <button type="submit" disabled={saving} className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-1.5 text-xs font-semibold text-black disabled:opacity-60 cursor-pointer">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {L("Lưu", "Save")}
            </button>
          </div>
        </form>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          placeholder={L("Tìm theo tiêu đề, brief, tag…", "Search title, brief, tags…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${inputCls} pl-9`}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : videos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 py-8 text-center text-xs text-zinc-500">
          {L("Chưa có video nào.", "No videos yet.")}
        </div>
      ) : (
        <ul className="space-y-2">
          {videos.map((v) => {
            const open = expanded === v.id;
            const busy = busyId === v.id;
            return (
              <li key={v.id} className="rounded-xl border border-border/80 bg-canvas/60">
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <button
                    onClick={() => setExpanded(open ? null : v.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
                  >
                    {open ? <ChevronUp className="h-4 w-4 shrink-0 text-zinc-500" /> : <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-100">{v.title}</p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">
                        {v.id.slice(0, 12)} · {v.platform ?? "—"} · {v.aspectRatio}
                        {v.durationSec ? ` · ${v.durationSec}s` : ""}
                        {v.costUsd > 0 ? ` · $${v.costUsd.toFixed(2)}` : ""}
                      </p>
                    </div>
                  </button>
                  <StatusBadge status={v.status} />
                  {!readOnly && (
                    <div className="flex items-center gap-1.5">
                      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
                      {v.status === "REVIEW" && (
                        <>
                          <button
                            disabled={busy}
                            onClick={() => act(v.id, () => setVideoAssetStatus(v.id, "APPROVED"))}
                            className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 cursor-pointer"
                          >
                            <Check className="h-3 w-3" /> {L("Duyệt", "Approve")}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => act(v.id, () => setVideoAssetStatus(v.id, "REJECTED"))}
                            className="flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
                          >
                            <X className="h-3 w-3" /> {L("Từ chối", "Reject")}
                          </button>
                        </>
                      )}
                      {v.status !== "PUBLISHED" && v.status !== "ARCHIVED" && (
                        <button
                          disabled={busy}
                          title={L("Lưu trữ", "Archive")}
                          onClick={() => act(v.id, () => archiveVideoAsset(v.id))}
                          className="rounded-lg border border-border/80 p-1.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-50 cursor-pointer"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {v.status === "ARCHIVED" && (
                        <button
                          disabled={busy}
                          onClick={() => act(v.id, () => setVideoAssetStatus(v.id, "IDEA", "Khôi phục"))}
                          className="rounded-lg border border-border/80 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-50 cursor-pointer"
                        >
                          {L("Khôi phục", "Restore")}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {open && (
                  <div className="space-y-3 border-t border-border/80 p-4 text-xs text-zinc-300">
                    {v.brief && (
                      <div>
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Brief</p>
                        <p className="whitespace-pre-wrap">{v.brief}</p>
                      </div>
                    )}
                    {v.script && (
                      <div>
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Script</p>
                        <pre className="whitespace-pre-wrap rounded-lg bg-black/30 p-3 font-sans leading-relaxed">{v.script}</pre>
                      </div>
                    )}
                    {v.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {v.tags.map((t) => (
                          <span key={t} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-zinc-400">#{t}</span>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-4">
                      <Link href={`/studio?id=${encodeURIComponent(v.id)}`} className="flex items-center gap-1 font-semibold text-violet-300 hover:underline">
                        <Clapperboard className="h-3 w-3" /> {L("Mở Studio dựng video", "Open Video Studio")}{v.hasTimeline ? "" : L(" (chưa có timeline)", " (no timeline yet)")}
                      </Link>
                      {v.assetUrl ? (
                        <a href={v.assetUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 text-accent hover:underline">
                          <ExternalLink className="h-3 w-3" /> {L("Mở file video", "Open video file")}
                        </a>
                      ) : (
                        <span className="text-zinc-500">{L("Chưa có file video (assetUrl trống).", "No video file yet (empty assetUrl).")}</span>
                      )}
                      {v.publishedUrl && (
                        <a href={v.publishedUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 text-cyan-300 hover:underline">
                          <ExternalLink className="h-3 w-3" /> {L("Bản đã xuất bản", "Published link")}
                        </a>
                      )}
                      {v.provider && <span className="text-zinc-500">provider: {v.provider}</span>}
                    </div>
                    {v.notes && (
                      <pre className="whitespace-pre-wrap rounded-lg border border-border/60 p-3 font-sans text-[11px] text-zinc-400">{v.notes}</pre>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Hint: how to delegate */}
      <div className="flex items-start gap-2 rounded-xl border border-border/80 bg-canvas/50 p-3 text-[11px] leading-relaxed text-zinc-500">
        <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {L(
            "Giao việc cho agent bằng lệnh, ví dụ: ",
            "Delegate to the agent with a command, e.g. "
          )}
          <code className="rounded bg-white/5 px-1 py-0.5 text-zinc-300">/do @video Viết kịch bản video TikTok 30s giới thiệu sản phẩm X</code>
          {L(
            ". Xuất bản luôn cần Founder duyệt trong mục Chờ phê duyệt.",
            ". Publishing always requires Founder approval in the pending-decisions column."
          )}
        </span>
      </div>
    </div>
  );
}
