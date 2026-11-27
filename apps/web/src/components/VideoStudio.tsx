"use client";

/**
 * Video Studio — giao diện dựng video kiểu NLE (bố cục chuẩn của Premiere / CapCut / DaVinci):
 *   Thanh trên: lưu / hoàn tác / xuất · Trái: thêm tài nguyên · Giữa: xem trước (canvas)
 *   Phải: thuộc tính clip (Inspector) · Dưới: timeline nhiều track + ruler + playhead.
 * Timeline được lưu lên server (PUT /api/videos/:id/timeline) và là CĂN CỨ để Agent/provider dựng video.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Scissors,
  SkipBack,
  Square,
  Trash2,
  Type,
  Undo2,
  Wand2,
  ZoomIn,
} from "lucide-react";
import {
  MAX_IMAGE_DATA_URL_CHARS,
  TIMELINE_ASPECTS,
  addTrack,
  aspectToSize,
  createEmptyTimeline,
  duplicateClip,
  findClip,
  newClipId,
  placeClip,
  removeClip,
  resizeClip,
  sizeToAspect,
  splitClipAt,
  timelineDuration,
  updateClip,
  type TimelineClip,
  type VideoAsset,
  type VideoTimeline,
} from "@ai-opc/shared";
import { buildVideoTimelineFromScript, fetchVideo, saveVideoTimeline } from "@/lib/api";
import { exportVideo, preloadImages, renderFrame, type ImageCache } from "@/lib/videoRender";
import { useI18n } from "@/context/I18nContext";

const EDITABLE = ["IDEA", "SCRIPTED", "REVIEW", "REJECTED", "FAILED"];
const LABEL_W = 112;
const ROW_H = 44;
const SNAP_PX = 8;
const AGENT_PAGE = "/agents?id=agent_create_video_ai";

const CLIP_STYLE: Record<TimelineClip["type"], string> = {
  text: "border-sky-400/60 bg-sky-500/25",
  image: "border-amber-400/60 bg-amber-500/25",
  color: "border-violet-400/60 bg-violet-500/25",
};

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
};

const inputCls =
  "w-full rounded-lg border border-border/80 bg-canvas px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-accent disabled:opacity-50";

interface DragState {
  mode: "move" | "left" | "right";
  id: string;
  startX: number;
  origStart: number;
  origDur: number;
  base: VideoTimeline;
  moved: boolean;
}

export default function VideoStudio({ videoId }: { videoId: string }) {
  const { locale } = useI18n();
  const L = (vi: string, en: string) => (locale === "vi" ? vi : en);

  const [video, setVideo] = useState<VideoAsset | null>(null);
  const [tl, setTl] = useState<VideoTimeline | null>(null);
  const tlRef = useRef<VideoTimeline | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(80); // px / giây
  const zoomRef = useRef(80);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [imgUrl, setImgUrl] = useState("");
  const [exportPct, setExportPct] = useState<number | null>(null);
  const exportAbort = useRef<AbortController | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const images = useRef<ImageCache>(new Map());
  const [imgVersion, setImgVersion] = useState(0);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ---- History (undo/redo) ---------------------------------------------------
  const past = useRef<VideoTimeline[]>([]);
  const future = useRef<VideoTimeline[]>([]);
  const lastCommit = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const [, bump] = useState(0);

  const setTlRaw = useCallback((next: VideoTimeline) => {
    tlRef.current = next;
    setTl(next);
  }, []);

  const commit = useCallback(
    (next: VideoTimeline, coalesceKey?: string) => {
      const now = Date.now();
      const same = coalesceKey && lastCommit.current.key === coalesceKey && now - lastCommit.current.at < 800;
      if (!same && tlRef.current) {
        past.current.push(tlRef.current);
        if (past.current.length > 100) past.current.shift();
      }
      lastCommit.current = { key: coalesceKey ?? "", at: now };
      future.current = [];
      setTlRaw(next);
      setDirty(true);
      bump((n) => n + 1);
    },
    [setTlRaw]
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev || !tlRef.current) return;
    future.current.push(tlRef.current);
    setTlRaw(prev);
    setDirty(true);
    bump((n) => n + 1);
  }, [setTlRaw]);

  const redo = useCallback(() => {
    const nxt = future.current.pop();
    if (!nxt || !tlRef.current) return;
    past.current.push(tlRef.current);
    setTlRaw(nxt);
    setDirty(true);
    bump((n) => n + 1);
  }, [setTlRaw]);

  // ---- Load -------------------------------------------------------------------
  const load = useCallback(async () => {
    try {
      const v = await fetchVideo(videoId);
      setVideo(v);
      setTlRaw(v.timeline ?? createEmptyTimeline(v.aspectRatio));
      past.current = [];
      future.current = [];
      setDirty(false);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message || "Error");
    }
  }, [videoId, setTlRaw]);

  useEffect(() => {
    load();
  }, [load]);

  const readOnly = !video || !EDITABLE.includes(video.status);
  const duration = useMemo(() => (tl ? timelineDuration(tl) : 0), [tl]);
  const selected = useMemo(() => (tl && selectedId ? findClip(tl, selectedId) : null), [tl, selectedId]);

  // ---- Images -----------------------------------------------------------------
  useEffect(() => {
    if (!tl) return;
    let alive = true;
    preloadImages(tl, images.current).then((failed) => {
      if (!alive) return;
      setImgVersion((n) => n + 1);
      if (failed.length)
        setNotice({
          kind: "err",
          text: L(
            `${failed.length} ảnh không tải được (URL sai hoặc máy chủ ảnh không cho phép CORS) — sẽ không xuất hiện khi xuất video.`,
            `${failed.length} image(s) failed to load (bad URL or no CORS) — they won't appear in the export.`
          ),
        });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl]);

  // ---- Preview ----------------------------------------------------------------
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !tl) return;
    const ctx = c.getContext("2d");
    if (ctx) renderFrame(ctx, tl, Math.min(t, Math.max(duration - 1e-3, 0)), images.current);
  }, [tl, t, imgVersion, duration]);

  // ---- Playback ---------------------------------------------------------------
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const next = tRef.current + (now - last) / 1000;
      last = now;
      if (next >= duration) {
        tRef.current = Math.max(duration - 1e-3, 0);
        setT(tRef.current);
        setPlaying(false);
        return;
      }
      tRef.current = next;
      setT(next);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  const seek = useCallback((time: number) => {
    const v = Math.max(0, time);
    tRef.current = v;
    setT(v);
  }, []);

  const togglePlay = useCallback(() => {
    if (duration <= 0) return;
    if (!playing && tRef.current >= duration - 0.01) seek(0);
    setPlaying((p) => !p);
  }, [duration, playing, seek]);

  // ---- Actions ----------------------------------------------------------------
  const guard = (fn: () => void) => () => {
    if (readOnly) return;
    fn();
  };

  const addClip = useCallback(
    (kind: TimelineClip["type"], extra: Partial<TimelineClip> = {}) => {
      const cur = tlRef.current;
      if (!cur || readOnly) return;
      const base: TimelineClip = {
        id: newClipId(),
        type: kind,
        start: tRef.current,
        duration: 3,
        ...(kind === "text"
          ? { text: L("Văn bản mới", "New text"), textColor: "#FFFFFF", fontSize: 56, fontWeight: "bold" as const, align: "center" as const, x: 0.5, y: 0.5, fadeIn: 0.3, fadeOut: 0.3 }
          : kind === "color"
            ? { color: "#1E1B4B" }
            : { x: 0.5, y: 0.5, scale: 0.6, fadeIn: 0.3, fadeOut: 0.3 }),
        ...extra,
      };
      const preferred = selected?.track ?? (kind === "color" ? cur.tracks[cur.tracks.length - 1] : cur.tracks[0]);
      commit(placeClip(cur, base, preferred.id, tRef.current));
      setSelectedId(base.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, readOnly, selected, locale]
  );

  const addImageFromUrl = () => {
    const u = imgUrl.trim();
    if (!/^https:\/\//i.test(u)) {
      setNotice({ kind: "err", text: L("URL ảnh phải bắt đầu bằng https://", "Image URL must start with https://") });
      return;
    }
    addClip("image", { src: u });
    setImgUrl("");
  };

  const addImageFromFile = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      setNotice({ kind: "err", text: L("Chỉ hỗ trợ PNG, JPEG, WebP, GIF.", "Only PNG, JPEG, WebP, GIF are supported.") });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result);
      if (data.length > MAX_IMAGE_DATA_URL_CHARS) {
        setNotice({ kind: "err", text: L("Ảnh quá lớn (tối đa ~2MB). Hãy nén ảnh hoặc dùng URL https.", "Image too large (max ~2MB). Compress it or use an https URL.") });
        return;
      }
      addClip("image", { src: data });
    };
    reader.readAsDataURL(file);
  };

  const splitAtPlayhead = useCallback(() => {
    const cur = tlRef.current;
    if (!cur || readOnly) return;
    const time = tRef.current;
    const target =
      (selectedId && findClip(cur, selectedId)?.clip) ||
      cur.tracks.flatMap((tr) => tr.clips).find((c) => time > c.start && time < c.start + c.duration);
    if (!target) return;
    const next = splitClipAt(cur, target.id, time);
    if (next !== cur) commit(next);
  }, [commit, readOnly, selectedId]);

  const deleteSelected = useCallback(() => {
    const cur = tlRef.current;
    if (!cur || !selectedId || readOnly) return;
    commit(removeClip(cur, selectedId));
    setSelectedId(null);
  }, [commit, readOnly, selectedId]);

  const duplicateSelected = useCallback(() => {
    const cur = tlRef.current;
    if (!cur || !selectedId || readOnly) return;
    const r = duplicateClip(cur, selectedId);
    commit(r.timeline);
    if (r.newId) setSelectedId(r.newId);
  }, [commit, readOnly, selectedId]);

  const patchSelected = (patch: Partial<TimelineClip>, key: string) => {
    const cur = tlRef.current;
    if (!cur || !selectedId || readOnly) return;
    commit(updateClip(cur, selectedId, patch), `${selectedId}:${key}`);
  };

  const save = useCallback(async () => {
    const cur = tlRef.current;
    if (!cur || readOnly || saving) return;
    setSaving(true);
    try {
      const v = await saveVideoTimeline(videoId, cur);
      setVideo((old) => (old ? { ...old, ...v, timeline: cur } : v));
      setDirty(false);
      setNotice({ kind: "ok", text: L("Đã lưu timeline.", "Timeline saved.") });
    } catch (e: any) {
      setNotice({ kind: "err", text: e?.message || "Error" });
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, readOnly, saving, locale]);

  const fromScript = async () => {
    if (!video?.script || readOnly) return;
    const hasClips = (tlRef.current ? timelineDuration(tlRef.current) : 0) > 0;
    if (hasClips && !window.confirm(L("Dựng lại từ script sẽ thay toàn bộ timeline hiện tại. Tiếp tục?", "Rebuilding from the script replaces the current timeline. Continue?"))) return;
    try {
      await buildVideoTimelineFromScript(videoId, hasClips);
      await load();
      setNotice({ kind: "ok", text: L("Đã dựng timeline từ script.", "Timeline built from script.") });
    } catch (e: any) {
      setNotice({ kind: "err", text: e?.message || "Error" });
    }
  };

  const doExport = async () => {
    const cur = tlRef.current;
    if (!cur || duration <= 0) return;
    if (exportAbort.current) {
      exportAbort.current.abort();
      return;
    }
    setPlaying(false);
    const ctl = new AbortController();
    exportAbort.current = ctl;
    setExportPct(0);
    try {
      await preloadImages(cur, images.current);
      const { blob, ext } = await exportVideo(cur, images.current, duration, (r) => setExportPct(r), ctl.signal);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(video?.title ?? "video").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60) || "video"}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setNotice({ kind: "ok", text: L("Đã xuất video (chưa có âm thanh).", "Video exported (no audio yet).") });
    } catch (e: any) {
      setNotice({ kind: "err", text: e?.message || "Error" });
    } finally {
      exportAbort.current = null;
      setExportPct(null);
    }
  };

  // ---- Keyboard + unload guard ------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === "s" && !mod) {
        splitAtPlayhead();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "ArrowLeft") {
        seek(tRef.current - 1 / (tlRef.current?.fps ?? 30));
      } else if (e.key === "ArrowRight") {
        seek(tRef.current + 1 / (tlRef.current?.fps ?? 30));
      } else if (e.key === "Home") {
        seek(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo, duplicateSelected, togglePlay, splitAtPlayhead, deleteSelected, seek]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // ---- Timeline dragging (move / trim, có snap) ---------------------------------
  const drag = useRef<DragState | null>(null);

  const snap = (time: number, base: VideoTimeline, skipId: string): number => {
    const pts = [0, tRef.current];
    for (const tr of base.tracks) for (const c of tr.clips) if (c.id !== skipId) pts.push(c.start, c.start + c.duration);
    const tol = SNAP_PX / zoomRef.current;
    let best = time;
    let bestD = tol;
    for (const p of pts) {
      const d = Math.abs(p - time);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };

  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / zoomRef.current;
    if (Math.abs(e.clientX - d.startX) > 2) d.moved = true;
    if (!d.moved) return;
    if (d.mode === "move") {
      let desired = d.origStart + dx;
      const s1 = snap(desired, d.base, d.id);
      const s2 = snap(desired + d.origDur, d.base, d.id) - d.origDur;
      desired = Math.abs(s1 - desired) <= Math.abs(s2 - desired) && s1 !== desired ? s1 : s2 !== desired - 0 && Math.abs(s2 - desired) < Math.abs(s1 - desired) ? s2 : s1;
      let trackId = findClip(d.base, d.id)!.track.id;
      for (const [id, el] of rowRefs.current) {
        const r = el.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY < r.bottom) trackId = id;
      }
      const clip = findClip(d.base, d.id)!.clip;
      setTlRaw(placeClip(d.base, clip, trackId, Math.max(0, desired)));
    } else if (d.mode === "left") {
      setTlRaw(resizeClip(d.base, d.id, "left", snap(d.origStart + dx, d.base, d.id)));
    } else {
      setTlRaw(resizeClip(d.base, d.id, "right", snap(d.origStart + d.origDur + dx, d.base, d.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTlRaw]);

  const onUp = useCallback(() => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const d = drag.current;
    drag.current = null;
    if (d?.moved && tlRef.current && JSON.stringify(tlRef.current) !== JSON.stringify(d.base)) {
      past.current.push(d.base);
      if (past.current.length > 100) past.current.shift();
      future.current = [];
      lastCommit.current = { key: "", at: 0 };
      setDirty(true);
      bump((n) => n + 1);
    }
  }, [onMove]);

  const beginDrag = (e: React.PointerEvent, mode: DragState["mode"], clip: TimelineClip) => {
    e.stopPropagation();
    setSelectedId(clip.id);
    if (readOnly || !tlRef.current) return;
    e.preventDefault();
    drag.current = { mode, id: clip.id, startX: e.clientX, origStart: clip.start, origDur: clip.duration, base: tlRef.current, moved: false };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const at = (ev: { clientX: number }) => seek((ev.clientX - rect.left) / zoomRef.current);
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // ---- Render -----------------------------------------------------------------
  if (loadError)
    return (
      <main className="mx-auto max-w-lg p-10 text-center text-sm text-rose-300">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8" />
        {loadError}
        <div className="mt-4">
          <Link href={AGENT_PAGE} className="text-accent hover:underline">{L("← Về trang Agent", "← Back to agent")}</Link>
        </div>
      </main>
    );
  if (!video || !tl)
    return (
      <main className="flex h-screen items-center justify-center text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </main>
    );

  const totalW = Math.max(duration + 10, 30) * zoom;
  const tickStep = [1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * zoom >= 64) ?? 120;
  const ticks = Array.from({ length: Math.ceil(totalW / zoom / tickStep) + 1 }, (_, i) => i * tickStep);
  const sel = selected?.clip ?? null;

  const btn =
    "flex items-center gap-1.5 rounded-lg border border-border/80 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer";

  return (
    <div className="flex h-screen flex-col bg-canvas text-zinc-200 select-none">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/80 bg-panel px-3">
        <Link href={AGENT_PAGE} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100">
          <ArrowLeft className="h-4 w-4" /> Agent
        </Link>
        <Film className="h-4 w-4 text-violet-400" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-100">{video.title}</p>
        </div>
        <span className="rounded-full border border-border/80 px-2 py-0.5 font-mono text-[10px] text-zinc-400">{video.status}</span>
        {dirty && <span className="text-[11px] text-amber-400">● {L("chưa lưu", "unsaved")}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button className={btn} onClick={undo} disabled={readOnly || past.current.length === 0} title="Ctrl+Z"><Undo2 className="h-3.5 w-3.5" /></button>
          <button className={btn} onClick={redo} disabled={readOnly || future.current.length === 0} title="Ctrl+Shift+Z"><Redo2 className="h-3.5 w-3.5" /></button>
          <button className={btn} onClick={doExport} disabled={duration <= 0 && exportPct === null}>
            {exportPct !== null ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {Math.round(exportPct * 100)}% · {L("Hủy", "Cancel")}</> : <><Download className="h-3.5 w-3.5" /> {L("Xuất video", "Export")}</>}
          </button>
          <button onClick={save} disabled={readOnly || saving || !dirty} title="Ctrl+S" className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40 cursor-pointer">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {L("Lưu", "Save")}
          </button>
        </div>
      </header>

      {(readOnly || notice) && (
        <div className={`flex items-center gap-2 px-4 py-1.5 text-xs ${readOnly ? "bg-amber-500/10 text-amber-300" : notice?.kind === "err" ? "bg-rose-500/10 text-rose-300" : "bg-emerald-500/10 text-emerald-300"}`}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            {readOnly
              ? L(`Video đang ở trạng thái ${video.status} — chế độ chỉ xem. ${video.status === "APPROVED" ? "Đưa về REVIEW để sửa." : ""}`, `Video is ${video.status} — read-only. ${video.status === "APPROVED" ? "Move it back to REVIEW to edit." : ""}`)
              : notice?.text}
          </span>
          {notice && !readOnly && <button className="text-zinc-400 hover:text-zinc-100" onClick={() => setNotice(null)}>✕</button>}
        </div>
      )}

      {/* Middle */}
      <div className="flex min-h-0 flex-1">
        {/* Left: add assets */}
        <aside className="w-56 shrink-0 space-y-3 overflow-y-auto border-r border-border/80 bg-panel p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{L("Thêm vào timeline", "Add to timeline")}</p>
          <div className="grid grid-cols-2 gap-2">
            <button className={btn} disabled={readOnly} onClick={guard(() => addClip("text"))}><Type className="h-3.5 w-3.5" /> {L("Chữ", "Text")}</button>
            <button className={btn} disabled={readOnly} onClick={guard(() => addClip("color"))}><Square className="h-3.5 w-3.5" /> {L("Nền màu", "Color")}</button>
          </div>
          <div className="space-y-1.5">
            <p className="flex items-center gap-1 text-[11px] text-zinc-400"><ImageIcon className="h-3 w-3" /> {L("Ảnh", "Image")}</p>
            <div className="flex gap-1">
              <input className={inputCls} placeholder="https://…" value={imgUrl} onChange={(e) => setImgUrl(e.target.value)} disabled={readOnly} onKeyDown={(e) => e.key === "Enter" && addImageFromUrl()} />
              <button className={btn} disabled={readOnly || !imgUrl} onClick={addImageFromUrl}><Plus className="h-3.5 w-3.5" /></button>
            </div>
            <label className={`${btn} justify-center ${readOnly ? "opacity-40 pointer-events-none" : ""}`}>
              {L("Tải ảnh lên (≤2MB)", "Upload (≤2MB)")}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { addImageFromFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </div>
          <div className="space-y-1.5 border-t border-border/80 pt-3">
            <button className={`${btn} w-full justify-center`} disabled={readOnly} onClick={guard(() => commit(addTrack(tlRef.current!)))}><Plus className="h-3.5 w-3.5" /> {L("Thêm track", "Add track")}</button>
            <button className={`${btn} w-full justify-center`} disabled={readOnly || !video.script} onClick={fromScript} title={video.script ? "" : L("Video chưa có script", "No script yet")}>
              <Wand2 className="h-3.5 w-3.5" /> {L("Dựng từ script", "Build from script")}
            </button>
          </div>
          <div className="border-t border-border/80 pt-3 text-[10px] leading-relaxed text-zinc-500">
            <p className="mb-1 font-semibold uppercase tracking-wide">{L("Phím tắt", "Shortcuts")}</p>
            Space: {L("phát/dừng", "play/pause")}<br />S: {L("cắt tại playhead", "split at playhead")}<br />Del: {L("xóa clip", "delete")} · Ctrl+D: {L("nhân bản", "duplicate")}<br />Ctrl+Z / Shift+Z · Ctrl+S<br />← →: {L("lùi/tiến 1 khung", "step 1 frame")}
          </div>
        </aside>

        {/* Center: preview */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center bg-black/60 p-4">
            <canvas ref={canvasRef} width={tl.width} height={tl.height} className="max-h-full max-w-full rounded shadow-2xl" style={{ aspectRatio: `${tl.width} / ${tl.height}` }} />
          </div>
          <div className="flex h-11 shrink-0 items-center gap-3 border-t border-border/80 bg-panel px-4">
            <button className={btn} onClick={() => seek(0)}><SkipBack className="h-3.5 w-3.5" /></button>
            <button className={btn} onClick={togglePlay} disabled={duration <= 0}>{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</button>
            <span className="font-mono text-xs text-zinc-300">{fmt(Math.min(t, duration))} / {fmt(duration)}</span>
            <span className="ml-auto text-[11px] text-zinc-500">{tl.width}×{tl.height} · {tl.fps}fps</span>
          </div>
        </section>

        {/* Right: inspector */}
        <aside className="w-72 shrink-0 space-y-3 overflow-y-auto border-l border-border/80 bg-panel p-3 text-xs">
          {sel ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{L("Thuộc tính", "Inspector")} · {sel.type}</p>
                <div className="flex gap-1">
                  <button className={btn} disabled={readOnly} onClick={splitAtPlayhead} title="S"><Scissors className="h-3.5 w-3.5" /></button>
                  <button className={btn} disabled={readOnly} onClick={duplicateSelected} title="Ctrl+D"><Copy className="h-3.5 w-3.5" /></button>
                  <button className={`${btn} text-rose-300`} disabled={readOnly} onClick={deleteSelected} title="Del"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              {sel.type === "text" && (
                <>
                  <textarea rows={3} className={inputCls} disabled={readOnly} value={sel.text ?? ""} onChange={(e) => patchSelected({ text: e.target.value }, "text")} />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">{L("Cỡ chữ", "Size")}<input type="number" min={8} max={400} className={inputCls} disabled={readOnly} value={sel.fontSize ?? 48} onChange={(e) => patchSelected({ fontSize: Number(e.target.value) || 48 }, "fs")} /></label>
                    <label className="space-y-1">{L("Màu chữ", "Color")}<input type="color" className={`${inputCls} h-8 p-0.5`} disabled={readOnly} value={sel.textColor ?? "#ffffff"} onChange={(e) => patchSelected({ textColor: e.target.value }, "tc")} /></label>
                    <label className="space-y-1">{L("Căn lề", "Align")}
                      <select className={inputCls} disabled={readOnly} value={sel.align ?? "center"} onChange={(e) => patchSelected({ align: e.target.value as TimelineClip["align"] }, "al")}>
                        <option value="left">{L("Trái", "Left")}</option><option value="center">{L("Giữa", "Center")}</option><option value="right">{L("Phải", "Right")}</option>
                      </select>
                    </label>
                    <label className="space-y-1">{L("Kiểu", "Weight")}
                      <select className={inputCls} disabled={readOnly} value={sel.fontWeight ?? "bold"} onChange={(e) => patchSelected({ fontWeight: e.target.value as TimelineClip["fontWeight"] }, "fw")}>
                        <option value="bold">Bold</option><option value="normal">Normal</option>
                      </select>
                    </label>
                  </div>
                </>
              )}
              {sel.type === "color" && (
                <label className="space-y-1 block">{L("Màu nền", "Color")}<input type="color" className={`${inputCls} h-8 p-0.5`} disabled={readOnly} value={sel.color ?? "#000000"} onChange={(e) => patchSelected({ color: e.target.value }, "col")} /></label>
              )}
              {sel.type === "image" && (
                <label className="space-y-1 block">{L("Kích thước", "Scale")} ({Math.round((sel.scale ?? 1) * 100)}%)<input type="range" min={5} max={300} className="w-full" disabled={readOnly} value={Math.round((sel.scale ?? 1) * 100)} onChange={(e) => patchSelected({ scale: Number(e.target.value) / 100 }, "sc")} /></label>
              )}
              {sel.type !== "color" && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">X ({Math.round((sel.x ?? 0.5) * 100)}%)<input type="range" min={0} max={100} className="w-full" disabled={readOnly} value={Math.round((sel.x ?? 0.5) * 100)} onChange={(e) => patchSelected({ x: Number(e.target.value) / 100 }, "x")} /></label>
                  <label className="space-y-1">Y ({Math.round((sel.y ?? 0.5) * 100)}%)<input type="range" min={0} max={100} className="w-full" disabled={readOnly} value={Math.round((sel.y ?? 0.5) * 100)} onChange={(e) => patchSelected({ y: Number(e.target.value) / 100 }, "y")} /></label>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">{L("Bắt đầu (s)", "Start (s)")}<input type="number" step={0.1} min={0} className={inputCls} disabled={readOnly} value={sel.start} onChange={(e) => patchSelected({ start: Math.max(0, Number(e.target.value) || 0) }, "st")} /></label>
                <label className="space-y-1">{L("Thời lượng (s)", "Duration (s)")}<input type="number" step={0.1} min={0.1} className={inputCls} disabled={readOnly} value={sel.duration} onChange={(e) => patchSelected({ duration: Math.max(0.1, Number(e.target.value) || 0.1) }, "du")} /></label>
                <label className="space-y-1">Fade in (s)<input type="number" step={0.1} min={0} max={10} className={inputCls} disabled={readOnly} value={sel.fadeIn ?? 0} onChange={(e) => patchSelected({ fadeIn: Math.max(0, Number(e.target.value) || 0) }, "fi")} /></label>
                <label className="space-y-1">Fade out (s)<input type="number" step={0.1} min={0} max={10} className={inputCls} disabled={readOnly} value={sel.fadeOut ?? 0} onChange={(e) => patchSelected({ fadeOut: Math.max(0, Number(e.target.value) || 0) }, "fo")} /></label>
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{L("Dự án", "Project")}</p>
              <label className="space-y-1 block">{L("Tỷ lệ khung hình", "Aspect ratio")}
                <select className={inputCls} disabled={readOnly} value={sizeToAspect(tl.width, tl.height)} onChange={(e) => commit({ ...tl, ...aspectToSize(e.target.value) })}>
                  {Object.keys(TIMELINE_ASPECTS).map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">{L("Màu nền", "Background")}<input type="color" className={`${inputCls} h-8 p-0.5`} disabled={readOnly} value={tl.background} onChange={(e) => commit({ ...tl, background: e.target.value }, "bg")} /></label>
                <label className="space-y-1">FPS
                  <select className={inputCls} disabled={readOnly} value={tl.fps} onChange={(e) => commit({ ...tl, fps: Number(e.target.value) })}>
                    {[24, 25, 30, 60].map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">{L("Chọn một clip trên timeline để chỉnh thuộc tính. Timeline đã lưu là căn cứ để Agent dựng video.", "Select a clip on the timeline to edit it. The saved timeline is the basis the agent uses to produce the video.")}</p>
            </>
          )}
        </aside>
      </div>

      {/* Timeline */}
      <section className="h-[272px] shrink-0 border-t border-border/80 bg-panel">
        <div className="flex h-8 items-center gap-3 border-b border-border/80 px-3 text-[11px] text-zinc-400">
          <ZoomIn className="h-3.5 w-3.5" />
          <input type="range" min={20} max={300} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-32" />
          <span>{L("Cắt: S · Kéo mép clip để trim · Kéo clip để di chuyển (tự bắt dính)", "Split: S · Drag clip edges to trim · Drag clips to move (snaps)")}</span>
        </div>
        <div className="flex h-[calc(100%-2rem)] overflow-y-auto">
          <div style={{ width: LABEL_W }} className="shrink-0 border-r border-border/80">
            <div className="h-6 border-b border-border/80" />
            {tl.tracks.map((tr) => (
              <div key={tr.id} style={{ height: ROW_H }} className="flex items-center justify-between border-b border-border/60 px-2 text-[11px] text-zinc-400">
                <span className="truncate">{tr.name}</span>
                {!readOnly && tr.clips.length === 0 && tl.tracks.length > 1 && (
                  <button className="text-zinc-600 hover:text-rose-300" title={L("Xóa track trống", "Remove empty track")} onClick={() => commit({ ...tl, tracks: tl.tracks.filter((x) => x.id !== tr.id) })}>✕</button>
                )}
              </div>
            ))}
          </div>
          <div className="relative min-w-0 flex-1 overflow-x-auto">
            <div style={{ width: totalW }} className="relative">
              <div className="relative h-6 cursor-pointer border-b border-border/80" onPointerDown={scrub}>
                {ticks.map((s) => (
                  <span key={s} style={{ left: s * zoom }} className="absolute top-0 h-full border-l border-border/80 pl-1 text-[10px] text-zinc-500">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>
                ))}
              </div>
              {tl.tracks.map((tr) => (
                <div
                  key={tr.id}
                  ref={(el) => { if (el) rowRefs.current.set(tr.id, el); else rowRefs.current.delete(tr.id); }}
                  style={{ height: ROW_H }}
                  className="relative border-b border-border/60"
                  onPointerDown={(e) => { if (e.target === e.currentTarget) { setSelectedId(null); scrub(e); } }}
                >
                  {tr.clips.map((c) => (
                    <div
                      key={c.id}
                      onPointerDown={(e) => beginDrag(e, "move", c)}
                      style={{ left: c.start * zoom, width: Math.max(c.duration * zoom, 6), top: 4, bottom: 4 }}
                      className={`absolute overflow-hidden rounded-md border text-[10px] ${CLIP_STYLE[c.type]} ${selectedId === c.id ? "ring-2 ring-accent" : ""} ${readOnly ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
                      title={c.type === "text" ? c.text : c.type}
                    >
                      <div onPointerDown={(e) => beginDrag(e, "left", c)} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/20 hover:bg-white/40" />
                      <span className="pointer-events-none block truncate px-3 pt-2 text-zinc-100">
                        {c.type === "text" ? c.text : c.type === "color" ? L("Nền", "Color") : L("Ảnh", "Image")}
                      </span>
                      <div onPointerDown={(e) => beginDrag(e, "right", c)} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/20 hover:bg-white/40" />
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ left: t * zoom }} className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-rose-500">
                <div className="absolute -left-1.5 top-0 h-2.5 w-3 rounded-b bg-rose-500" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
