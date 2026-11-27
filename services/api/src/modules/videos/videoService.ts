/**
 * VideoService — nghiệp vụ quản lý video cho Agent `agent_create_video_ai`.
 *
 * Vòng đời (state machine) — Rule 5: AI recommend, Founder decide:
 *
 *   IDEA → SCRIPTED → GENERATING → REVIEW → APPROVED → PUBLISHED
 *            ↑            │           │  └→ REJECTED
 *            └────────────┴─ FAILED ──┘
 *   (mọi trạng thái trừ PUBLISHED có thể → ARCHIVED; ARCHIVED → IDEA để khôi phục)
 *
 * - Actor "agent" KHÔNG được tự chuyển sang APPROVED / REJECTED (chỉ Founder).
 * - PUBLISHED chỉ đạt được qua publishVideo(), được gọi bởi tool_video_publish
 *   (R3 → luôn đi qua Decision Package của Founder trong Tool Gateway).
 */
import { randomUUID } from "crypto";
import { db } from "../../db/client";
import { logAudit } from "../audit/auditLogger";
import { broadcastCompanyEvent } from "../../ws/gateway";
import { VIDEO_AGENT_ID } from "./videoAgent";
import {
  scriptToTimeline,
  sizeToAspect,
  summarizeTimeline,
  timelineDuration,
  validateTimeline,
  type VideoAsset,
  type VideoStatus,
  type VideoTimeline,
} from "@ai-opc/shared";

export { VIDEO_AGENT_ID };

export const VIDEO_STATUSES: VideoStatus[] = [
  "IDEA",
  "SCRIPTED",
  "GENERATING",
  "REVIEW",
  "APPROVED",
  "REJECTED",
  "PUBLISHED",
  "FAILED",
  "ARCHIVED",
];

export const VIDEO_PLATFORMS = ["youtube", "tiktok", "facebook", "instagram", "zalo", "website", "internal"] as const;
export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:5"] as const;

export type VideoActor = "agent" | "founder" | "system";

const TRANSITIONS: Record<VideoStatus, VideoStatus[]> = {
  IDEA: ["SCRIPTED", "ARCHIVED"],
  SCRIPTED: ["IDEA", "GENERATING", "ARCHIVED"],
  GENERATING: ["REVIEW", "FAILED", "SCRIPTED", "ARCHIVED"],
  REVIEW: ["APPROVED", "REJECTED", "SCRIPTED", "GENERATING", "ARCHIVED"],
  APPROVED: ["PUBLISHED", "REVIEW", "ARCHIVED"],
  REJECTED: ["SCRIPTED", "ARCHIVED"],
  PUBLISHED: [], // trạng thái cuối — chỉ lưu trữ bằng cách tạo video mới
  FAILED: ["SCRIPTED", "GENERATING", "ARCHIVED"],
  ARCHIVED: ["IDEA"],
};

/** Các trạng thái chỉ Founder (người) được đặt. */
const FOUNDER_ONLY: VideoStatus[] = ["APPROVED", "REJECTED"];
/** Chỉ đạt được qua hàm chuyên biệt có kiểm soát, không qua setVideoStatus. */
const VIA_PUBLISH_ONLY: VideoStatus[] = ["PUBLISHED"];

export class VideoError extends Error {
  constructor(message: string, public readonly code: "NOT_FOUND" | "INVALID" | "FORBIDDEN" = "INVALID") {
    super(message);
  }
}

// ---- Helpers ---------------------------------------------------------------

interface VideoRow {
  id: string;
  title: string;
  brief: string | null;
  script: string | null;
  status: string;
  platform: string | null;
  aspectRatio: string;
  durationSec: number | null;
  tags: string | null;
  timeline: string | null;
  assetUrl: string | null;
  thumbnailUrl: string | null;
  provider: string | null;
  providerJobId: string | null;
  publishedUrl: string | null;
  costUsd: number;
  notes: string | null;
  agentId: string;
  taskId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function parseTimeline(raw: string | null): VideoTimeline | null {
  if (!raw) return null;
  try {
    const r = validateTimeline(JSON.parse(raw));
    return r.ok ? r.timeline : null;
  } catch {
    return null;
  }
}

/** `withTimeline`: chỉ kèm toàn bộ timeline khi lấy 1 video (getVideo) — danh sách chỉ có cờ hasTimeline. */
export function serializeVideo(row: VideoRow, withTimeline = false): VideoAsset {
  return {
    hasTimeline: Boolean(row.timeline),
    ...(withTimeline ? { timeline: parseTimeline(row.timeline) } : {}),
    id: row.id,
    title: row.title,
    brief: row.brief,
    script: row.script,
    status: row.status as VideoStatus,
    platform: row.platform,
    aspectRatio: row.aspectRatio,
    durationSec: row.durationSec,
    tags: parseTags(row.tags),
    assetUrl: row.assetUrl,
    thumbnailUrl: row.thumbnailUrl,
    provider: row.provider,
    providerJobId: row.providerJobId,
    publishedUrl: row.publishedUrl,
    costUsd: row.costUsd,
    notes: row.notes,
    agentId: row.agentId,
    taskId: row.taskId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  };
}

function emit(video: VideoAsset): void {
  broadcastCompanyEvent({
    type: "VIDEO_UPDATED",
    payload: { id: video.id, agentId: video.agentId, status: video.status },
  });
}

function assertStatus(value: string): VideoStatus {
  if (!VIDEO_STATUSES.includes(value as VideoStatus)) {
    throw new VideoError(`Trạng thái video không hợp lệ: "${value}". Hợp lệ: ${VIDEO_STATUSES.join(", ")}`);
  }
  return value as VideoStatus;
}

function cleanText(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function cleanUrl(v: unknown): string | null | undefined {
  const s = cleanText(v, 2000);
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) {
    throw new VideoError(`URL phải bắt đầu bằng http:// hoặc https:// (nhận được: "${s.slice(0, 60)}")`);
  }
  return s;
}

export interface VideoInput {
  title?: string;
  brief?: string | null;
  script?: string | null;
  platform?: string | null;
  aspectRatio?: string;
  durationSec?: number | null;
  tags?: string[];
  notes?: string | null;
  thumbnailUrl?: string | null;
  assetUrl?: string | null;
}

function normalizeInput(input: VideoInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const t = cleanText(input.title, 300);
    if (!t) throw new VideoError("Tiêu đề video không được để trống.");
    data.title = t;
  }
  if (input.brief !== undefined) data.brief = cleanText(input.brief, 5000);
  if (input.script !== undefined) data.script = cleanText(input.script, 50000);
  if (input.notes !== undefined) data.notes = cleanText(input.notes, 5000);
  if (input.platform !== undefined) {
    const p = cleanText(input.platform, 30)?.toLowerCase() ?? null;
    if (p && !(VIDEO_PLATFORMS as readonly string[]).includes(p)) {
      throw new VideoError(`Platform không hợp lệ: "${p}". Hợp lệ: ${VIDEO_PLATFORMS.join(", ")}`);
    }
    data.platform = p;
  }
  if (input.aspectRatio !== undefined) {
    if (!(VIDEO_ASPECT_RATIOS as readonly string[]).includes(input.aspectRatio)) {
      throw new VideoError(`Tỷ lệ khung hình không hợp lệ: "${input.aspectRatio}". Hợp lệ: ${VIDEO_ASPECT_RATIOS.join(", ")}`);
    }
    data.aspectRatio = input.aspectRatio;
  }
  if (input.durationSec !== undefined) {
    if (input.durationSec === null) data.durationSec = null;
    else {
      const d = Math.round(Number(input.durationSec));
      if (!Number.isFinite(d) || d <= 0 || d > 3600) throw new VideoError("durationSec phải là số giây trong khoảng 1–3600.");
      data.durationSec = d;
    }
  }
  if (input.tags !== undefined) {
    const tags = Array.from(
      new Set((input.tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))
    ).slice(0, 20);
    data.tags = tags.length ? JSON.stringify(tags) : null;
  }
  if (input.thumbnailUrl !== undefined) data.thumbnailUrl = cleanUrl(input.thumbnailUrl);
  if (input.assetUrl !== undefined) data.assetUrl = cleanUrl(input.assetUrl);
  return data;
}

// ---- Queries ---------------------------------------------------------------

export interface VideoListFilter {
  status?: string;
  platform?: string;
  q?: string;
  limit?: number;
}

export async function listVideos(filter: VideoListFilter = {}): Promise<VideoAsset[]> {
  const where: Record<string, unknown> = {};
  if (filter.status) where.status = assertStatus(filter.status.toUpperCase());
  if (filter.platform) where.platform = filter.platform.toLowerCase();
  const rows: VideoRow[] = await db.video.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(filter.limit ?? 100, 1), 500),
  });
  let videos = rows.map((r) => serializeVideo(r));
  if (filter.q) {
    // Lọc ở tầng ứng dụng để chạy giống nhau trên cả 3 DB (không phụ thuộc collation/LIKE).
    const needle = filter.q.trim().toLowerCase();
    videos = videos.filter((v) =>
      `${v.title} ${v.brief ?? ""} ${v.tags.join(" ")}`.toLowerCase().includes(needle)
    );
  }
  return videos;
}

export async function getVideo(id: string): Promise<VideoAsset> {
  const row: VideoRow | null = await db.video.findUnique({ where: { id } });
  if (!row) throw new VideoError(`Video không tồn tại: ${id}`, "NOT_FOUND");
  return serializeVideo(row, true);
}

export async function getVideoStats(): Promise<{ total: number; byStatus: Record<string, number>; totalCostUsd: number }> {
  const rows: Array<{ status: string; costUsd: number }> = await db.video.findMany({
    select: { status: true, costUsd: true },
  });
  const byStatus: Record<string, number> = {};
  let totalCostUsd = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    totalCostUsd += r.costUsd ?? 0;
  }
  return { total: rows.length, byStatus, totalCostUsd: Math.round(totalCostUsd * 1e6) / 1e6 };
}

// ---- Mutations -------------------------------------------------------------

interface Ctx {
  actor: VideoActor;
  agentId?: string | null;
  taskId?: string | null;
}

async function audit(ctx: Ctx, action: string, video: VideoAsset, extra: Record<string, unknown> = {}) {
  await logAudit({
    agentId: ctx.agentId ?? VIDEO_AGENT_ID,
    taskId: ctx.taskId ?? null,
    action,
    inputPayload: { videoId: video.id, actor: ctx.actor, ...extra },
    resultSummary: `[video ${video.id}] "${video.title}" → ${video.status}`,
    riskLevel: "R1",
  });
}

export async function createVideo(input: VideoInput & { title: string }, ctx: Ctx): Promise<VideoAsset> {
  const data = normalizeInput(input);
  if (!data.title) throw new VideoError("Tiêu đề video không được để trống.");
  const status: VideoStatus = data.script ? "SCRIPTED" : "IDEA";
  const row: VideoRow = await db.video.create({
    data: {
      id: `vid_${randomUUID()}`,
      ...data,
      status,
      agentId: VIDEO_AGENT_ID,
      taskId: ctx.taskId ?? null,
      createdBy: ctx.actor === "founder" ? "FOUNDER" : "AGENT",
    },
  });
  const video = serializeVideo(row);
  await audit(ctx, "VIDEO_CREATED", video);
  emit(video);
  return video;
}

export async function updateVideo(id: string, input: VideoInput, ctx: Ctx): Promise<VideoAsset> {
  const current = await getVideo(id);
  if (current.status === "PUBLISHED" || current.status === "ARCHIVED") {
    throw new VideoError(`Không thể sửa video đang ở trạng thái ${current.status}.`);
  }
  const data = normalizeInput(input);
  if (Object.keys(data).length === 0) throw new VideoError("Không có trường nào để cập nhật.");

  // Có script mới cho video còn ở IDEA → tự động lên SCRIPTED.
  if (data.script && current.status === "IDEA") data.status = "SCRIPTED";

  const row: VideoRow = await db.video.update({ where: { id }, data });
  const video = serializeVideo(row);
  await audit(ctx, "VIDEO_UPDATED", video, { fields: Object.keys(data) });
  emit(video);
  return video;
}

export async function setVideoStatus(
  id: string,
  nextRaw: string,
  ctx: Ctx,
  note?: string | null
): Promise<VideoAsset> {
  const next = assertStatus(String(nextRaw).toUpperCase());
  const current = await getVideo(id);

  if (VIA_PUBLISH_ONLY.includes(next)) {
    throw new VideoError("Trạng thái PUBLISHED chỉ đạt được qua tool_video_publish (cần Founder duyệt).", "FORBIDDEN");
  }
  if (FOUNDER_ONLY.includes(next) && ctx.actor !== "founder") {
    throw new VideoError(`Chỉ Founder được chuyển video sang ${next} (Rule 5).`, "FORBIDDEN");
  }
  if (!TRANSITIONS[current.status].includes(next)) {
    throw new VideoError(
      `Không thể chuyển ${current.status} → ${next}. Cho phép từ ${current.status}: ${TRANSITIONS[current.status].join(", ") || "(không có)"}.`
    );
  }
  if (next === "GENERATING" && !current.script && !current.hasTimeline) {
    throw new VideoError("Cần có script hoặc timeline (Video Studio) trước khi chuyển sang GENERATING.");
  }

  const data: Record<string, unknown> = { status: next };
  if (note) data.notes = [current.notes, `[${new Date().toISOString().slice(0, 16)}] ${note}`].filter(Boolean).join("\n").slice(-5000);
  const row: VideoRow = await db.video.update({ where: { id }, data });
  const video = serializeVideo(row);
  await audit(ctx, "VIDEO_STATUS_CHANGED", video, { from: current.status, to: next, note: note ?? null });
  emit(video);
  return video;
}

/** Ghi nhận kết quả từ provider (dùng bởi tool_video_generate). */
export async function recordGeneration(
  id: string,
  patch: {
    status: Extract<VideoStatus, "GENERATING" | "REVIEW" | "FAILED">;
    provider: string;
    providerJobId?: string | null;
    assetUrl?: string | null;
    thumbnailUrl?: string | null;
    costUsd?: number;
    note?: string | null;
  },
  ctx: Ctx
): Promise<VideoAsset> {
  const current = await getVideo(id);
  const data: Record<string, unknown> = {
    status: patch.status,
    provider: patch.provider,
    providerJobId: patch.providerJobId ?? current.providerJobId,
    costUsd: current.costUsd + Math.max(patch.costUsd ?? 0, 0),
  };
  if (patch.assetUrl !== undefined) data.assetUrl = patch.assetUrl;
  if (patch.thumbnailUrl !== undefined) data.thumbnailUrl = patch.thumbnailUrl;
  if (patch.note) data.notes = [current.notes, `[${new Date().toISOString().slice(0, 16)}] ${patch.note}`].filter(Boolean).join("\n").slice(-5000);
  const row: VideoRow = await db.video.update({ where: { id }, data });
  const video = serializeVideo(row);
  await audit(ctx, "VIDEO_GENERATION", video, { provider: patch.provider, jobId: patch.providerJobId ?? null, status: patch.status });
  emit(video);
  return video;
}

/**
 * Đánh dấu PUBLISHED. CHỈ gọi từ tool_video_publish (R3) — tool này luôn đi
 * qua Decision Package, nên Founder đã duyệt trước khi hàm này chạy.
 * Lưu ý: hàm KHÔNG tự đăng lên nền tảng nào; nó ghi nhận kết quả đăng.
 */
export async function publishVideo(
  id: string,
  input: { platform?: string | null; publishedUrl?: string | null },
  ctx: Ctx
): Promise<VideoAsset> {
  const current = await getVideo(id);
  if (current.status !== "REVIEW" && current.status !== "APPROVED") {
    throw new VideoError(`Chỉ video ở REVIEW/APPROVED mới được publish (hiện tại: ${current.status}).`);
  }
  if (!current.assetUrl && !input.publishedUrl) {
    throw new VideoError("Video chưa có assetUrl hoặc publishedUrl — không có gì để publish.");
  }
  const data: Record<string, unknown> = { status: "PUBLISHED", publishedAt: new Date() };
  const platform = cleanText(input.platform, 30)?.toLowerCase();
  if (platform) {
    if (!(VIDEO_PLATFORMS as readonly string[]).includes(platform)) {
      throw new VideoError(`Platform không hợp lệ: "${platform}".`);
    }
    data.platform = platform;
  }
  const url = cleanUrl(input.publishedUrl);
  if (url) data.publishedUrl = url;
  const row: VideoRow = await db.video.update({ where: { id }, data });
  const video = serializeVideo(row);
  await logAudit({
    agentId: ctx.agentId ?? VIDEO_AGENT_ID,
    taskId: ctx.taskId ?? null,
    action: "VIDEO_PUBLISHED",
    inputPayload: { videoId: id, platform: video.platform, publishedUrl: video.publishedUrl },
    resultSummary: `[video ${id}] "${video.title}" PUBLISHED`,
    riskLevel: "R3",
  });
  emit(video);
  return video;
}

// ---- Timeline (Video Studio) -------------------------------------------------

/** Trạng thái cho phép sửa timeline: chưa/không còn gắn với 1 bản sinh đã duyệt hay đang chạy. */
const TIMELINE_EDITABLE: VideoStatus[] = ["IDEA", "SCRIPTED", "REVIEW", "REJECTED", "FAILED"];

/**
 * Lưu timeline do Video Studio (hoặc Agent) soạn — là CĂN CỨ để sinh/dựng video.
 * Đồng bộ durationSec + aspectRatio theo timeline; video IDEA có clip → SCRIPTED.
 */
export async function saveTimeline(id: string, input: unknown, ctx: Ctx): Promise<VideoAsset> {
  const current = await getVideo(id);
  if (!TIMELINE_EDITABLE.includes(current.status)) {
    throw new VideoError(
      `Không sửa timeline khi video ở ${current.status}` +
        (current.status === "APPROVED" ? " — đưa về REVIEW trước." : "."),
      "INVALID"
    );
  }
  const v = validateTimeline(input);
  if (!v.ok) throw new VideoError(`Timeline không hợp lệ — ${v.error}`);
  const tl = v.timeline;
  const duration = timelineDuration(tl);
  const hasClips = duration > 0;

  const data: Record<string, unknown> = { timeline: JSON.stringify(tl) };
  if (hasClips) data.durationSec = Math.min(3600, Math.max(1, Math.ceil(duration)));
  data.aspectRatio = sizeToAspect(tl.width, tl.height);
  if (hasClips && current.status === "IDEA") data.status = "SCRIPTED";

  const row: VideoRow = await db.video.update({ where: { id }, data });
  const video = serializeVideo(row);
  await audit(ctx, "VIDEO_TIMELINE_SAVED", video, summarizeTimeline(tl));
  emit(video);
  return video;
}

/** Dựng timeline khởi tạo từ script (mỗi dòng = 1 cảnh). Không ghi đè timeline có sẵn trừ khi overwrite. */
export async function buildTimelineFromScript(
  id: string,
  ctx: Ctx,
  opts: { overwrite?: boolean } = {}
): Promise<VideoAsset> {
  const current = await getVideo(id);
  if (!current.script) throw new VideoError("Video chưa có script để dựng timeline.");
  if (current.timeline && timelineDuration(current.timeline) > 0 && !opts.overwrite) {
    throw new VideoError("Video đã có timeline. Dùng overwrite=true nếu muốn dựng lại từ script.");
  }
  const tl = scriptToTimeline(current.script, {
    aspectRatio: current.aspectRatio,
    targetSeconds: current.durationSec,
  });
  if (timelineDuration(tl) === 0) throw new VideoError("Script không có nội dung để tạo cảnh.");
  return saveTimeline(id, tl, ctx);
}
