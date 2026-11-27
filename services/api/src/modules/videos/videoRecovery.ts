/**
 * Khôi phục quyết định của Agent video khi model chỉ trả PHẦN PARAMS (vd {"operation":"create","data":{...}})
 * mà quên lớp bọc {"action":"CALL_TOOL","toolId":...,"params":...}. Chỉ suy ra tool khi nhận diện rõ ràng;
 * tool suy ra phải nằm trong danh sách tool được cấp quyền (vẫn đi qua Tool Gateway như bình thường).
 */
export type RecoveredVideoDecision = { action: "CALL_TOOL"; toolId: string; params: Record<string, unknown> };
export type RecoveredVideoAction =
  | RecoveredVideoDecision
  | { action: "NONE"; note: string };

const OP_TO_TOOL: Record<string, string> = {
  create: "tool_video_draft",
  update: "tool_video_draft",
  list: "tool_video_search",
  get: "tool_video_search",
  search: "tool_video_search",
  submit: "tool_video_generate",
  refresh: "tool_video_generate",
};

export function recoverVideoDecision(raw: unknown, validToolIds: Set<string>): RecoveredVideoDecision | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  // Đã có phong bì → để normalizeRawDecision xử lý.
  if (o.action || o.toolId || o.tool_id || o.tool) return null;

  const op = typeof o.operation === "string" ? o.operation.trim().toLowerCase() : "";
  let toolId = op ? OP_TO_TOOL[op] : undefined;
  if (!toolId && !op) {
    if (o.data && typeof o.data === "object" && (o.data as Record<string, unknown>).title) toolId = "tool_video_draft";
    else if (typeof o.title === "string" && (o.script || o.brief)) {
      // Model trả thẳng dữ liệu video → coi là tạo bản nháp.
      return validToolIds.has("tool_video_draft")
        ? { action: "CALL_TOOL", toolId: "tool_video_draft", params: { operation: "create", data: { ...o, autoTimeline: true } } }
        : null;
    }
  }
  if (!toolId || !validToolIds.has(toolId)) return null;

  // Chuẩn hóa params cho tool_video_draft: nếu model trả thẳng data ở root hoặc thiếu autoTimeline
  if (toolId === "tool_video_draft") {
    if (op === "create" || op === "update") {
      let data = (o.data && typeof o.data === "object" ? { ...(o.data as Record<string, unknown>) } : null);
      if (!data && o.title) {
        const { operation, ...rest } = o;
        data = rest;
      }
      if (data) {
        if (data.script && data.autoTimeline === undefined) {
          data.autoTimeline = true;
        }
        return { action: "CALL_TOOL", toolId, params: { operation: op || "create", data } };
      }
    }
  }

  return { action: "CALL_TOOL", toolId, params: o };
}

/**
 * Cứu hộ thông minh khi Model trả về văn bản tự do, Markdown kịch bản hoặc câu từ chối.
 * Tự động trích xuất ý định tạo video và tạo bản nháp khởi tạo với timeline hoàn chỉnh.
 */
/**
 * Cứu hộ thông minh khi Model trả về văn bản tự do, Markdown kịch bản, lệnh sinh video hoặc câu từ chối.
 * Tự động nhận diện lệnh sinh/xuất bản hoặc tạo bản nháp khởi tạo với timeline hoàn chỉnh.
 */
export async function recoverVideoIntentFromText(
  rawText: string,
  task: { title: string; objective: string },
  validToolIds: Set<string>
): Promise<RecoveredVideoAction | null> {
  const combined = `${task.title} ${task.objective}`.toLowerCase().trim();

  // 1. Nhận diện lệnh duyệt video (Approve / Duyệt / Phê duyệt / { status: "APPROVED" })
  const isApproveCmd =
    combined.includes("approve") ||
    combined.includes("duyệt") ||
    combined.includes("duyet") ||
    combined.includes("phê duyệt") ||
    combined.includes("phe duyet") ||
    rawText.includes('"status": "APPROVED"') ||
    rawText.includes('"status":"APPROVED"');

  if (isApproveCmd) {
    const idMatch = `${task.title} ${task.objective} ${rawText}`.match(/(vid_[a-zA-Z0-9_-]+)/i);
    let targetId = idMatch ? idMatch[1] : undefined;
    try {
      const { listVideos, setVideoStatus, getVideo } = require("./videoService");
      if (!targetId) {
        const list = await listVideos({ limit: 5 });
        const candidate =
          list.find((v: any) => v.status === "REVIEW") ||
          list.find((v: any) => v.status === "APPROVED") ||
          list[0];
        if (candidate) targetId = candidate.id;
      }
      if (targetId) {
        const video = await getVideo(targetId);
        if (video.status === "REVIEW") {
          await setVideoStatus(targetId, "APPROVED", { actor: "founder" }, "Founder duyệt video qua lệnh chat");
        }
        const platform = video.platform ? video.platform.toUpperCase() : "nền tảng";
        console.log(`[VideoRecovery] Tự động duyệt video ID ${targetId} thành APPROVED`);
        return {
          action: "NONE",
          note:
            `✅ Video **${video.title}** (\`${targetId}\`) đã được phê duyệt thành công (chuyển sang **APPROVED**) — tương đương với thao tác Save/Duyệt tại Video Studio.\n\n` +
            `🚀 **Founder có muốn xuất bản/export video này lên ${platform} ngay bây giờ không?**\n` +
            `- Gõ **"Xuất bản"** (hoặc **"Có"** / **"Export"** / **"Đồng ý"**) để xuất bản tự động (tương đương nút Export).\n` +
            `- Hoặc mở [Video Studio](/studio?id=${targetId}) để tải file WebM về trực tiếp.`,
        };
      }
    } catch (e: any) {
      console.warn("[VideoRecovery] Lỗi khi xử lý lệnh duyệt video:", e);
    }
  }

  // 2. Nhận diện lệnh sinh video (tool_video_generate / sinh video / render video)
  const isGenerateCmd =
    combined.includes("tool_video_generate") ||
    combined.includes("sinh video") ||
    combined.includes("render video") ||
    combined.includes("chạy video") ||
    combined.includes("tao video cho vid_") ||
    combined.includes("tạo video cho vid_") ||
    (combined.startsWith("sinh") && combined.includes("video"));

  if (isGenerateCmd && validToolIds.has("tool_video_generate")) {
    const idMatch = `${task.title} ${task.objective} ${rawText}`.match(/(vid_[a-zA-Z0-9_-]+)/i);
    let targetId = idMatch ? idMatch[1] : undefined;
    if (!targetId) {
      try {
        const { listVideos } = require("./videoService");
        const list = await listVideos({ limit: 5 });
        const candidate =
          list.find((v: any) => v.status === "SCRIPTED") ||
          list.find((v: any) => v.status === "IDEA" && v.hasScript) ||
          list[0];
        if (candidate) targetId = candidate.id;
      } catch {}
    }
    if (targetId) {
      console.log(`[VideoRecovery] Tự động nhận diện lệnh sinh video cho ID: ${targetId}`);
      return {
        action: "CALL_TOOL",
        toolId: "tool_video_generate",
        params: { operation: "submit", id: targetId },
      };
    }
  }

  // 3. Nhận diện lệnh xuất bản video (tool_video_publish / xuất bản video / đăng video / export / có / đồng ý)
  const isPublishCmd =
    combined.includes("tool_video_publish") ||
    combined.includes("xuất bản") ||
    combined.includes("xuat ban") ||
    combined.includes("đăng video") ||
    combined.includes("dang video") ||
    combined.includes("export") ||
    combined.includes("publish") ||
    combined === "có" ||
    combined === "co" ||
    combined === "có chứ" ||
    combined === "đồng ý" ||
    combined === "dong y" ||
    combined === "ok" ||
    combined === "yes" ||
    combined.startsWith("đồng ý") ||
    combined.startsWith("dong y") ||
    combined.startsWith("xuất bản");

  if (isPublishCmd && validToolIds.has("tool_video_publish")) {
    const idMatch = `${task.title} ${task.objective} ${rawText}`.match(/(vid_[a-zA-Z0-9_-]+)/i);
    let targetId = idMatch ? idMatch[1] : undefined;
    if (!targetId) {
      try {
        const { listVideos } = require("./videoService");
        const list = await listVideos({ limit: 5 });
        const candidate =
          list.find((v: any) => v.status === "APPROVED") ||
          list.find((v: any) => v.status === "REVIEW") ||
          list[0];
        if (candidate) targetId = candidate.id;
      } catch {}
    }
    if (targetId) {
      console.log(`[VideoRecovery] Tự động nhận diện lệnh xuất bản video cho ID: ${targetId}`);
      return {
        action: "CALL_TOOL",
        toolId: "tool_video_publish",
        params: { id: targetId },
      };
    }
  }

  // 3. Nhận diện ý định tạo bản nháp video
  if (!validToolIds.has("tool_video_draft")) return null;

  const isVideoCreation =
    combined.includes("video") ||
    combined.includes("clip") ||
    combined.includes("reel") ||
    combined.includes("kịch bản") ||
    combined.includes("dựng");

  if (!isVideoCreation) return null;

  const text = rawText.trim();
  let script = "";
  if (text.includes("Hook") || text.includes("CTA") || text.includes("Kịch bản") || text.split("\n").length >= 3) {
    if (!text.startsWith("{") && !text.includes('"error":')) {
      script = text;
    }
  }

  if (!script) {
    const topic = task.title.replace(/^(hãy\s+)?(tạo|làm|viết)\s+(video|clip|kịch bản)\s*/i, "").trim() || "Giới thiệu Dự án";
    script = [
      `Hook: Bạn đã biết đến giải pháp đột phá ${topic} chưa?`,
      `Nội dung: Trải nghiệm công nghệ AI-Native tối ưu vận hành tự động, tiết kiệm 80% thời gian quản lý.`,
      `CTA: Khám phá ngay hôm nay để đón đầu xu hướng!`,
    ].join("\n");
  }

  const platform = combined.includes("youtube") ? "youtube" : combined.includes("tiktok") ? "tiktok" : "tiktok";
  const aspectRatio = platform === "youtube" ? "16:9" : "9:16";

  console.log(`[VideoRecovery] Tự động khôi phục ý định tạo video từ văn bản cho task: "${task.title}"`);
  return {
    action: "CALL_TOOL",
    toolId: "tool_video_draft",
    params: {
      operation: "create",
      data: {
        title: task.title.slice(0, 80),
        brief: task.objective.slice(0, 200),
        script,
        platform,
        aspectRatio,
        durationSec: 30,
        tags: ["ai", "video", platform],
        autoTimeline: true,
      },
    },
  };
}