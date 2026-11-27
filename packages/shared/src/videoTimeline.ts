/**
 * Video Timeline — mô hình dựng video kiểu NLE (non-linear editor) dùng chung
 * cho Web (Video Studio), API (lưu/validate) và Agent (tạo từ script).
 *
 * Quy ước theo các trình dựng phổ biến (Premiere / CapCut / DaVinci):
 *  - Dự án = nhiều TRACK xếp chồng; track ĐẦU danh sách nằm TRÊN CÙNG (vẽ sau cùng).
 *  - Mỗi track chứa các CLIP đặt theo thời gian (giây), KHÔNG chồng nhau trong cùng 1 track.
 *  - Clip có start + duration, fade in/out, vị trí (x,y là tâm, 0–1) và thuộc tính theo loại.
 *
 * Toàn bộ hàm ở đây là thuần (không phụ thuộc DOM) nên test được bằng Node.
 */
import { z } from "zod";

export const TIMELINE_VERSION = 1;
export const MAX_TIMELINE_SECONDS = 600;
export const MAX_TIMELINE_TRACKS = 12;
export const MAX_TIMELINE_CLIPS = 500;
export const MIN_CLIP_SECONDS = 0.1;
/** Giới hạn ảnh nhúng (data URL) ~2MB để JSON timeline không phình quá mức. */
export const MAX_IMAGE_DATA_URL_CHARS = 2_800_000;

export const TIMELINE_ASPECTS = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 720, height: 720 },
  "4:5": { width: 720, height: 900 },
} as const;
export type TimelineAspect = keyof typeof TIMELINE_ASPECTS;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Màu phải dạng #RRGGBB");

const imageSrc = z
  .string()
  .max(MAX_IMAGE_DATA_URL_CHARS)
  .refine(
    (s) => /^https:\/\//i.test(s) || /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s),
    "Ảnh phải là URL https:// hoặc data:image (png/jpeg/webp/gif) base64"
  );

export const clipSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(["text", "image", "color"]),
  start: z.number().min(0).max(MAX_TIMELINE_SECONDS),
  duration: z.number().min(MIN_CLIP_SECONDS).max(MAX_TIMELINE_SECONDS),
  text: z.string().max(2000).optional(),
  src: imageSrc.optional(),
  color: hex.optional(), // clip "color": màu nền
  textColor: hex.optional(),
  fontSize: z.number().min(8).max(400).optional(), // px theo chiều cao project
  fontWeight: z.enum(["normal", "bold"]).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  x: z.number().min(0).max(1).optional(), // tâm, tỉ lệ theo chiều rộng
  y: z.number().min(0).max(1).optional(), // tâm, tỉ lệ theo chiều cao
  scale: z.number().min(0.05).max(3).optional(), // ảnh: chiều rộng / chiều rộng khung
  fadeIn: z.number().min(0).max(10).optional(),
  fadeOut: z.number().min(0).max(10).optional(),
});
export type TimelineClip = z.infer<typeof clipSchema>;

export const trackSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  clips: z.array(clipSchema),
});
export type TimelineTrack = z.infer<typeof trackSchema>;

export const videoTimelineSchema = z
  .object({
    version: z.literal(TIMELINE_VERSION),
    width: z.number().int().min(160).max(3840),
    height: z.number().int().min(160).max(3840),
    fps: z.number().int().min(1).max(60),
    background: hex,
    tracks: z.array(trackSchema).max(MAX_TIMELINE_TRACKS),
  })
  .superRefine((tl, ctx) => {
    let total = 0;
    const ids = new Set<string>();
    for (const [ti, track] of tl.tracks.entries()) {
      total += track.clips.length;
      const sorted = [...track.clips].sort((a, b) => a.start - b.start);
      for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i];
        if (ids.has(c.id)) ctx.addIssue({ code: "custom", message: `Trùng id clip: ${c.id}`, path: ["tracks", ti] });
        ids.add(c.id);
        if (c.start + c.duration > MAX_TIMELINE_SECONDS + 1e-6)
          ctx.addIssue({ code: "custom", message: `Clip ${c.id} vượt quá ${MAX_TIMELINE_SECONDS}s`, path: ["tracks", ti] });
        if (c.type === "image" && !c.src)
          ctx.addIssue({ code: "custom", message: `Clip ảnh ${c.id} thiếu src`, path: ["tracks", ti] });
        if (i > 0 && sorted[i - 1].start + sorted[i - 1].duration > c.start + 1e-6)
          ctx.addIssue({ code: "custom", message: `Clip ${sorted[i - 1].id} và ${c.id} chồng nhau trong track "${track.name}"`, path: ["tracks", ti] });
      }
    }
    if (total > MAX_TIMELINE_CLIPS)
      ctx.addIssue({ code: "custom", message: `Tối đa ${MAX_TIMELINE_CLIPS} clip` });
  });
export type VideoTimeline = z.infer<typeof videoTimelineSchema>;

// ---- Helpers -----------------------------------------------------------------

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const EPS = 1e-6;

export function newClipId(prefix = "c"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function aspectToSize(aspect: string): { width: number; height: number } {
  return (TIMELINE_ASPECTS as Record<string, { width: number; height: number }>)[aspect] ?? TIMELINE_ASPECTS["16:9"];
}

export function sizeToAspect(width: number, height: number): string {
  for (const [k, v] of Object.entries(TIMELINE_ASPECTS)) if (v.width === width && v.height === height) return k;
  return "16:9";
}

export function createEmptyTimeline(aspect = "16:9"): VideoTimeline {
  const { width, height } = aspectToSize(aspect);
  return {
    version: TIMELINE_VERSION,
    width,
    height,
    fps: 30,
    background: "#000000",
    tracks: [
      { id: newClipId("t"), name: "Chữ", clips: [] },
      { id: newClipId("t"), name: "Nền", clips: [] },
    ],
  };
}

export function timelineDuration(tl: VideoTimeline): number {
  let max = 0;
  for (const t of tl.tracks) for (const c of t.clips) max = Math.max(max, c.start + c.duration);
  return r3(max);
}

export function findClip(tl: VideoTimeline, clipId: string): { track: TimelineTrack; clip: TimelineClip } | null {
  for (const track of tl.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** Trả về bản sao mới (immutable) — an toàn cho React state. */
function clone(tl: VideoTimeline): VideoTimeline {
  return JSON.parse(JSON.stringify(tl));
}

/**
 * Tìm vị trí start gần `desired` nhất mà clip dài `duration` không chồng clip nào trong `clips`.
 */
export function findFreeStart(clips: TimelineClip[], duration: number, desired: number): number {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.start - cursor >= duration - EPS) gaps.push([cursor, c.start]);
    cursor = Math.max(cursor, c.start + c.duration);
  }
  gaps.push([cursor, Infinity]);
  let best = Infinity;
  let bestDist = Infinity;
  for (const [a, b] of gaps) {
    const cand = Math.min(Math.max(desired, a), b - duration);
    const dist = Math.abs(cand - desired);
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
    }
  }
  return r3(Math.max(0, best));
}

/** Đặt (thêm hoặc di chuyển) clip vào track, tự né chồng lấn. */
export function placeClip(tl: VideoTimeline, clip: TimelineClip, trackId: string, desiredStart: number): VideoTimeline {
  const next = clone(tl);
  for (const t of next.tracks) t.clips = t.clips.filter((c) => c.id !== clip.id);
  const target = next.tracks.find((t) => t.id === trackId) ?? next.tracks[0];
  if (!target) return next;
  const start = findFreeStart(target.clips, clip.duration, desiredStart);
  target.clips.push({ ...clip, start });
  target.clips.sort((a, b) => a.start - b.start);
  return next;
}

/** Kéo mép trái/phải của clip (trim), không lấn clip kề và không nhỏ hơn MIN_CLIP_SECONDS. */
export function resizeClip(tl: VideoTimeline, clipId: string, edge: "left" | "right", time: number): VideoTimeline {
  const next = clone(tl);
  const hit = findClip(next, clipId);
  if (!hit) return next;
  const { track, clip } = hit;
  const others = track.clips.filter((c) => c.id !== clipId);
  const prevEnd = Math.max(0, ...others.filter((c) => c.start + c.duration <= clip.start + EPS).map((c) => c.start + c.duration));
  const nextStart = Math.min(
    Infinity,
    ...others.filter((c) => c.start >= clip.start + clip.duration - EPS).map((c) => c.start)
  );
  const end = clip.start + clip.duration;
  if (edge === "left") {
    const s = Math.min(Math.max(time, prevEnd), end - MIN_CLIP_SECONDS);
    clip.start = r3(s);
    clip.duration = r3(end - s);
  } else {
    const e = Math.min(Math.max(time, clip.start + MIN_CLIP_SECONDS), Math.min(nextStart, clip.start + MAX_TIMELINE_SECONDS));
    clip.duration = r3(e - clip.start);
  }
  return next;
}

/** Cắt clip tại thời điểm t (phím S). Không làm gì nếu t sát mép. */
export function splitClipAt(tl: VideoTimeline, clipId: string, t: number): VideoTimeline {
  const hit = findClip(tl, clipId);
  if (!hit) return tl;
  const { clip } = hit;
  if (t <= clip.start + MIN_CLIP_SECONDS || t >= clip.start + clip.duration - MIN_CLIP_SECONDS) return tl;
  const next = clone(tl);
  const h = findClip(next, clipId)!;
  const firstDur = r3(t - clip.start);
  const second: TimelineClip = {
    ...h.clip,
    id: newClipId(),
    start: r3(t),
    duration: r3(clip.start + clip.duration - t),
    fadeIn: 0,
  };
  h.clip.duration = firstDur;
  h.clip.fadeOut = 0;
  h.track.clips.push(second);
  h.track.clips.sort((a, b) => a.start - b.start);
  return next;
}

export function removeClip(tl: VideoTimeline, clipId: string): VideoTimeline {
  const next = clone(tl);
  for (const t of next.tracks) t.clips = t.clips.filter((c) => c.id !== clipId);
  return next;
}

export function updateClip(tl: VideoTimeline, clipId: string, patch: Partial<TimelineClip>): VideoTimeline {
  const next = clone(tl);
  const hit = findClip(next, clipId);
  if (!hit) return next;
  const { track, clip } = hit;
  Object.assign(clip, patch);
  // đổi start/duration bằng ô nhập → vẫn phải né chồng lấn
  if (patch.start !== undefined || patch.duration !== undefined) {
    clip.duration = r3(Math.max(MIN_CLIP_SECONDS, Math.min(clip.duration, MAX_TIMELINE_SECONDS)));
    return placeClip(next, clip, track.id, Math.max(0, clip.start));
  }
  return next;
}

export function duplicateClip(tl: VideoTimeline, clipId: string): { timeline: VideoTimeline; newId: string | null } {
  const hit = findClip(tl, clipId);
  if (!hit) return { timeline: tl, newId: null };
  const copy: TimelineClip = { ...hit.clip, id: newClipId() };
  return { timeline: placeClip(tl, copy, hit.track.id, hit.clip.start + hit.clip.duration), newId: copy.id };
}

export function addTrack(tl: VideoTimeline, name?: string): VideoTimeline {
  if (tl.tracks.length >= MAX_TIMELINE_TRACKS) return tl;
  const next = clone(tl);
  next.tracks.unshift({ id: newClipId("t"), name: name ?? `Track ${next.tracks.length + 1}`, clips: [] });
  return next;
}

export function validateTimeline(
  input: unknown
): { ok: true; timeline: VideoTimeline } | { ok: false; error: string } {
  const parsed = videoTimelineSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".") || "timeline"}: ${issue.message}` };
  }
  const tl = clone(parsed.data);
  for (const t of tl.tracks)
    for (const c of t.clips) {
      c.start = r3(c.start);
      c.duration = r3(c.duration);
    }
  return { ok: true, timeline: tl };
}

// ---- Script → Timeline ---------------------------------------------------------

const SCENE_COLORS = ["#0F172A", "#1E1B4B", "#052E16", "#431407", "#172554", "#3B0764"];

/**
 * Chuyển script (mỗi dòng/đoạn = 1 cảnh; chấp nhận tiền tố "Hook:", "Nội dung:", "CTA:") thành timeline:
 * track "Chữ" (text) + track "Nền" (màu luân phiên). Thời lượng mỗi cảnh theo số từ (≈2.5 từ/giây,
 * 2–8s); nếu có `targetSeconds` thì co giãn toàn bộ cho khớp.
 */
export function scriptToTimeline(
  script: string,
  opts: { aspectRatio?: string; targetSeconds?: number | null } = {}
): VideoTimeline {
  const tl = createEmptyTimeline(opts.aspectRatio ?? "16:9");
  const scenes = script
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•]\s*)?(?:hook|nội dung|noi dung|body|cta|cảnh\s*\d+|scene\s*\d+)\s*[:：-]\s*/i, "").trim())
    .filter(Boolean)
    .slice(0, 60);
  if (scenes.length === 0) return tl;

  let durations = scenes.map((s) => Math.min(8, Math.max(2, s.split(/\s+/).length / 2.5)));
  const sum = durations.reduce((a, b) => a + b, 0);
  const target = opts.targetSeconds && opts.targetSeconds > 0 ? Math.min(opts.targetSeconds, MAX_TIMELINE_SECONDS) : null;
  if (target) durations = durations.map((d) => Math.max(MIN_CLIP_SECONDS, (d / sum) * target));

  const [textTrack, bgTrack] = tl.tracks;
  const portrait = tl.height > tl.width;
  let t = 0;
  scenes.forEach((text, i) => {
    const d = r3(durations[i]);
    bgTrack.clips.push({
      id: newClipId(),
      type: "color",
      start: r3(t),
      duration: d,
      color: SCENE_COLORS[i % SCENE_COLORS.length],
    });
    textTrack.clips.push({
      id: newClipId(),
      type: "text",
      start: r3(t),
      duration: d,
      text,
      textColor: "#FFFFFF",
      fontSize: portrait ? 56 : 52,
      fontWeight: "bold",
      align: "center",
      x: 0.5,
      y: 0.5,
      fadeIn: Math.min(0.4, d / 4),
      fadeOut: Math.min(0.4, d / 4),
    });
    t += d;
  });
  return tl;
}

/** Tóm tắt ngắn (cho LLM / log) — không kèm dữ liệu ảnh base64. */
export function summarizeTimeline(tl: VideoTimeline) {
  return {
    size: `${tl.width}x${tl.height}`,
    fps: tl.fps,
    durationSec: timelineDuration(tl),
    tracks: tl.tracks.map((t) => ({ name: t.name, clips: t.clips.length })),
  };
}
