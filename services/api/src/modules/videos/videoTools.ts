/**
 * Tool drivers cho Agent quản lý video. Chỉ được gọi qua ToolGateway
 * (permission → risk/approval → audit). Xem videoAgent.ts cho ma trận quyền.
 */
import { registerToolDriver } from "../governance/toolGateway";
import {
  VideoError,
  createVideo,
  getVideo,
  getVideoStats,
  listVideos,
  publishVideo,
  recordGeneration,
  setVideoStatus,
  updateVideo,
  type VideoInput,
} from "./videoService";
import { getVideoProvider } from "./videoProvider";

const AGENT = { actor: "agent" as const };

function str(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}

function requireId(params: Record<string, unknown>): string {
  const id = str(params.id ?? params.videoId)?.trim();
  if (!id) throw new VideoError("Tham số 'id' (vd: vid_...) là bắt buộc.");
  return id;
}

/** LLM đôi khi đặt các trường ngoài "data" — gộp cả hai để chịu lỗi. */
function pickInput(params: Record<string, unknown>): VideoInput {
  const src = { ...params, ...((params.data as Record<string, unknown>) ?? {}) };
  const out: VideoInput = {};
  for (const key of ["title", "brief", "script", "platform", "aspectRatio", "notes", "thumbnailUrl", "assetUrl"] as const) {
    if (src[key] !== undefined) (out as Record<string, unknown>)[key] = src[key];
  }
  if (src.durationSec !== undefined) out.durationSec = src.durationSec === null ? null : Number(src.durationSec);
  if (src.tags !== undefined) {
    out.tags = Array.isArray(src.tags) ? src.tags.map(String) : String(src.tags).split(",");
  }
  return out;
}

function brief(v: Awaited<ReturnType<typeof getVideo>>) {
  return {
    id: v.id,
    title: v.title,
    status: v.status,
    platform: v.platform,
    aspectRatio: v.aspectRatio,
    durationSec: v.durationSec,
    hasScript: Boolean(v.script),
    assetUrl: v.assetUrl,
    publishedUrl: v.publishedUrl,
    costUsd: v.costUsd,
    updatedAt: v.updatedAt,
  };
}

export function registerVideoToolDrivers(): void {
  // 1. Tra cứu (R0)
  registerToolDriver("tool_video_search", async (params) => {
    const op = (str(params.operation) ?? (params.id ? "get" : "list")).toLowerCase();
    if (op === "stats") return getVideoStats();
    if (op === "get") return getVideo(requireId(params));
    const videos = await listVideos({
      status: str(params.status),
      platform: str(params.platform),
      q: str(params.q ?? params.query),
      limit: params.limit ? Number(params.limit) : 50,
    });
    return { count: videos.length, videos: videos.map(brief) };
  });

  // 2. Bản nháp (R1)
  registerToolDriver("tool_video_draft", async (params) => {
    const op = (str(params.operation) ?? (params.id ? "update" : "create")).toLowerCase();
    const input = pickInput(params);
    if (op === "create") {
      if (!input.title) throw new VideoError("Tạo video cần 'data.title'.");
      return brief(await createVideo({ ...input, title: input.title }, AGENT));
    }
    if (op === "update") return brief(await updateVideo(requireId(params), input, AGENT));
    throw new VideoError(`operation không hợp lệ: "${op}" (create | update).`);
  });

  // 3. Chuyển trạng thái (R1)
  registerToolDriver("tool_video_set_status", async (params) => {
    const status = str(params.status);
    if (!status) throw new VideoError("Tham số 'status' là bắt buộc.");
    return brief(await setVideoStatus(requireId(params), status, AGENT, str(params.note)));
  });

  // 4. Sinh video (R2)
  registerToolDriver("tool_video_generate", async (params) => {
    const id = requireId(params);
    const op = (str(params.operation) ?? "submit").toLowerCase();
    const provider = getVideoProvider();
    const video = await getVideo(id);

    if (op === "refresh") {
      if (video.status !== "GENERATING" || !video.providerJobId) {
        throw new VideoError(`Chỉ refresh được video đang GENERATING có job (hiện tại: ${video.status}).`);
      }
      const r = await provider.refresh(video.providerJobId);
      if (r.status === "PROCESSING") return { ...brief(video), job: r.jobId, jobStatus: r.status };
      const done = await recordGeneration(
        id,
        {
          status: r.status === "DONE" ? "REVIEW" : "FAILED",
          provider: r.provider,
          providerJobId: r.jobId,
          assetUrl: r.assetUrl,
          thumbnailUrl: r.thumbnailUrl,
          costUsd: r.costUsd,
          note: r.status === "FAILED" ? `Provider lỗi: ${r.error ?? "không rõ"}` : "Provider hoàn tất.",
        },
        AGENT
      );
      return { ...brief(done), job: r.jobId, jobStatus: r.status };
    }

    if (op !== "submit") throw new VideoError(`operation không hợp lệ: "${op}" (submit | refresh).`);

    // Kiểm tra điều kiện + chuyển sang GENERATING (ném lỗi nếu thiếu script / sai trạng thái)
    await setVideoStatus(id, "GENERATING", AGENT, "Gửi job sinh video");
    try {
      const r = await provider.submit({
        videoId: id,
        prompt: str(params.prompt) ?? video.script ?? video.brief ?? video.title,
        script: video.script,
        durationSec: video.durationSec,
        aspectRatio: video.aspectRatio,
      });
      const next = r.status === "DONE" ? "REVIEW" : r.status === "FAILED" ? "FAILED" : "GENERATING";
      const out = await recordGeneration(
        id,
        {
          status: next,
          provider: r.provider,
          providerJobId: r.jobId,
          assetUrl: r.assetUrl,
          thumbnailUrl: r.thumbnailUrl,
          costUsd: r.costUsd,
          note: r.simulated
            ? "Provider MÔ PHỎNG — chưa có file video thật (đặt VIDEO_GEN_API_URL để dùng provider thật)."
            : r.status === "FAILED"
              ? `Provider lỗi: ${r.error ?? "không rõ"}`
              : null,
        },
        AGENT
      );
      return { ...brief(out), job: r.jobId, jobStatus: r.status, simulated: Boolean(r.simulated) };
    } catch (err) {
      await recordGeneration(
        id,
        { status: "FAILED", provider: provider.name, note: `Gửi job thất bại: ${err instanceof Error ? err.message : String(err)}` },
        AGENT
      );
      throw err;
    }
  });

  // 5. Xuất bản (R3 — Gateway đã chặn bằng Decision Package trước khi tới đây)
  registerToolDriver("tool_video_publish", async (params) => {
    const out = await publishVideo(
      requireId(params),
      { platform: str(params.platform), publishedUrl: str(params.publishedUrl ?? params.url) },
      AGENT
    );
    return brief(out);
  });
}
