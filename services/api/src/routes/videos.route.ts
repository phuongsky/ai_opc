/**
 * /api/videos — thư viện video do Agent `agent_create_video_ai` quản lý.
 * Người dùng (Founder) thao tác trực tiếp ở đây có actor = "founder", nên được
 * phép APPROVE/REJECT; Agent chỉ đi qua Tool Gateway (xem modules/videos/videoTools.ts).
 */
import { Router, type Response } from "express";
import { z } from "zod";
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_PLATFORMS,
  VIDEO_STATUSES,
  VideoError,
  createVideo,
  getVideo,
  getVideoStats,
  listVideos,
  saveTimeline,
  buildTimelineFromScript,
  setVideoStatus,
  updateVideo,
  generateVideoWithProvider,
  publishVideo,
} from "../modules/videos/videoService";

export const videosRouter = Router();

const FOUNDER = { actor: "founder" as const };

const fieldsSchema = z.object({
  title: z.string().trim().min(1, "Tiêu đề không được để trống").max(300),
  brief: z.string().max(5000).nullable().optional(),
  script: z.string().max(50000).nullable().optional(),
  platform: z.enum(VIDEO_PLATFORMS).nullable().optional(),
  aspectRatio: z.enum(VIDEO_ASPECT_RATIOS).optional(),
  durationSec: z.number().int().min(1).max(3600).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  notes: z.string().max(5000).nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  assetUrl: z.string().url().nullable().optional(),
});

const statusSchema = z.object({
  status: z.enum(VIDEO_STATUSES as [string, ...string[]]),
  note: z.string().max(500).nullable().optional(),
});

function fail(res: Response, err: unknown) {
  if (err instanceof VideoError) {
    const code = err.code === "NOT_FOUND" ? 404 : err.code === "FORBIDDEN" ? 403 : 400;
    return res.status(code).json({ error: err.message });
  }
  // eslint-disable-next-line no-console
  console.error("[videos.route]", err);
  return res.status(500).json({ error: "Lỗi máy chủ khi xử lý video." });
}

videosRouter.get("/", async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(
      await listVideos({
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        platform: typeof req.query.platform === "string" ? req.query.platform : undefined,
        q: typeof req.query.q === "string" ? req.query.q : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
      })
    );
  } catch (err) {
    fail(res, err);
  }
});

videosRouter.get("/stats", async (_req, res) => {
  try {
    res.json(await getVideoStats());
  } catch (err) {
    fail(res, err);
  }
});

videosRouter.get("/:id", async (req, res) => {
  try {
    res.json(await getVideo(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

videosRouter.post("/", async (req, res) => {
  const parsed = fieldsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dữ liệu không hợp lệ", details: parsed.error.flatten() });
  }
  try {
    res.status(201).json(await createVideo(parsed.data, FOUNDER));
  } catch (err) {
    fail(res, err);
  }
});

videosRouter.patch("/:id", async (req, res) => {
  const parsed = fieldsSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dữ liệu không hợp lệ", details: parsed.error.flatten() });
  }
  try {
    res.json(await updateVideo(req.params.id, parsed.data, FOUNDER));
  } catch (err) {
    fail(res, err);
  }
});

videosRouter.post("/:id/status", async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dữ liệu không hợp lệ", details: parsed.error.flatten() });
  }
  try {
    res.json(await setVideoStatus(req.params.id, parsed.data.status, FOUNDER, parsed.data.note));
  } catch (err) {
    fail(res, err);
  }
});

/** "Xóa" = lưu trữ (ARCHIVED). Không xóa cứng để giữ lịch sử/audit (Rule 10). */
videosRouter.delete("/:id", async (req, res) => {
  try {
    res.json(await setVideoStatus(req.params.id, "ARCHIVED", FOUNDER, "Founder lưu trữ video"));
  } catch (err) {
    fail(res, err);
  }
});

/** Lưu timeline từ Video Studio. Body: { timeline } — validate đầy đủ ở server (không tin client). */
videosRouter.put("/:id/timeline", async (req, res) => {
  try {
    res.json(await saveTimeline(req.params.id, req.body?.timeline, FOUNDER));
  } catch (err) {
    fail(res, err);
  }
});

/** Dựng timeline khởi tạo từ script. Body: { overwrite?: boolean } */
videosRouter.post("/:id/timeline/from-script", async (req, res) => {
  try {
    res.json(await buildTimelineFromScript(req.params.id, FOUNDER, { overwrite: req.body?.overwrite === true }));
  } catch (err) {
    fail(res, err);
  }
});


/** Kích hoạt sinh video (chuyển SCRIPTED -> GENERATING -> REVIEW) */
videosRouter.post("/:id/generate", async (req, res) => {
  try {
    res.json(await generateVideoWithProvider(req.params.id, req.body?.prompt, FOUNDER));
  } catch (err) {
    fail(res, err);
  }
});

/** Xuất bản video (chuyển APPROVED -> PUBLISHED) */
videosRouter.post("/:id/publish", async (req, res) => {
  try {
    res.json(await publishVideo(req.params.id, req.body || {}, FOUNDER));
  } catch (err) {
    fail(res, err);
  }
});
