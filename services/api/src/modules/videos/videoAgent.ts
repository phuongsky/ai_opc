/**
 * Định nghĩa Agent `agent_create_video_ai` (AI-Video), các Tool video và ma
 * trận quyền — dùng chung cho `db/seed.ts` và `ensureVideoAgent()` (bootstrap
 * khi API khởi động, để các bản cài đặt hiện có cũng có agent mà không cần
 * chạy lại seed).
 *
 * Permission Matrix (Rulebook mục 6) áp dụng cho agent này:
 *   tool_video_search      R0  L2  đọc / thống kê thư viện video
 *   tool_video_draft       R1  L3  tạo & sửa bản nháp (ý tưởng, script, metadata)
 *   tool_video_set_status  R1  L4  chuyển trạng thái nội bộ (không gồm APPROVED/REJECTED/PUBLISHED)
 *   tool_video_generate    R2  L4  gọi provider sinh video (có thể tốn chi phí)
 *   tool_video_publish     R3  L5  xuất bản → luôn tạo Decision Package cho Founder duyệt
 */
import { db } from "../../db/client";

export const VIDEO_AGENT_ID = "agent_create_video_ai";

export function isVideoAgent(agentId: string | null | undefined): boolean {
  return agentId === VIDEO_AGENT_ID;
}

export const videoAgentSeed = {
  id: VIDEO_AGENT_ID,
  name: "AI-Video",
  title: "Video Production Manager",
  departmentId: "dept_marketing" as string | null,
  reportsTo: "agent_marketing" as string | null,
  mission:
    "Quản lý toàn bộ vòng đời video của công ty: lên ý tưởng, viết kịch bản, điều phối sinh video bằng AI, " +
    "đưa vào hàng chờ duyệt của Founder và chuẩn bị xuất bản. Không tự xuất bản khi chưa có Founder duyệt.",
  autonomyLevel: 2,
};

export const videoToolsSeed = [
  {
    id: "tool_video_search",
    name: "Video — Tra cứu thư viện",
    description:
      'Params JSON: {"operation":"list"|"get"|"stats","id":"vid_...","status":"IDEA|SCRIPTED|GENERATING|REVIEW|APPROVED|REJECTED|PUBLISHED|FAILED|ARCHIVED","platform":"youtube|tiktok|facebook|instagram|zalo|website|internal","q":"từ khóa","limit":50}. ' +
      '"get" bắt buộc có id. "stats" trả số lượng theo trạng thái và tổng chi phí. Ví dụ: {"operation":"list","status":"REVIEW"}',
    riskLevel: "R0",
    requiresApproval: false,
  },
  {
    id: "tool_video_draft",
    name: "Video — Tạo/sửa bản nháp",
    description:
      'Params JSON — TẠO: {"operation":"create","data":{"title":"...","brief":"...","script":"...","platform":"tiktok","aspectRatio":"9:16","durationSec":30,"tags":["a","b"]}}. ' +
      'SỬA: {"operation":"update","id":"vid_...","data":{...}}. Có script → trạng thái tự là SCRIPTED, chưa có → IDEA. ' +
      'Có thể thêm "autoTimeline":true vào data (dựng timeline Video Studio từ script, mỗi dòng = 1 cảnh) hoặc "timeline":{...}. ' +
      "Founder tinh chỉnh timeline tại Video Studio (/studio?id=...). Không sửa được video đã PUBLISHED/ARCHIVED.",
    riskLevel: "R1",
    requiresApproval: false,
  },
  {
    id: "tool_video_set_status",
    name: "Video — Chuyển trạng thái",
    description:
      'Params JSON: {"id":"vid_...","status":"SCRIPTED|GENERATING|REVIEW|FAILED|ARCHIVED|IDEA","note":"lý do"}. ' +
      "KHÔNG dùng để APPROVED/REJECTED (chỉ Founder) hoặc PUBLISHED (dùng tool_video_publish).",
    riskLevel: "R1",
    requiresApproval: false,
  },
  {
    id: "tool_video_generate",
    name: "Video — Sinh video bằng AI",
    description:
      'Params JSON: {"operation":"submit"|"refresh","id":"vid_...","prompt":"mô tả cảnh quay (tuỳ chọn, mặc định dùng script)"}. ' +
      '"submit" yêu cầu video đã có script (SCRIPTED/REVIEW/FAILED), gửi job tới provider rồi đưa video sang REVIEW khi xong. ' +
      '"refresh" kiểm tra job đang GENERATING. Provider mặc định là mô phỏng (không sinh file thật) cho tới khi cấu hình VIDEO_GEN_API_URL.',
    riskLevel: "R2",
    requiresApproval: false,
  },
  {
    id: "tool_video_publish",
    name: "Video — Xuất bản",
    description:
      'Params JSON: {"id":"vid_...","platform":"youtube|tiktok|facebook|instagram|zalo|website|internal","publishedUrl":"https://... (tuỳ chọn)"}. ' +
      "Chỉ video ở REVIEW/APPROVED. R3: luôn cần Founder duyệt. Chỉ GHI NHẬN trạng thái PUBLISHED — không tự đăng lên nền tảng.",
    riskLevel: "R3",
    requiresApproval: true,
  },
];

export const videoToolPermissionsSeed = [
  { agentId: VIDEO_AGENT_ID, toolId: "tool_video_search", permissionLevel: "L2" },
  { agentId: VIDEO_AGENT_ID, toolId: "tool_video_draft", permissionLevel: "L3" },
  { agentId: VIDEO_AGENT_ID, toolId: "tool_video_set_status", permissionLevel: "L4" },
  { agentId: VIDEO_AGENT_ID, toolId: "tool_video_generate", permissionLevel: "L4" },
  { agentId: VIDEO_AGENT_ID, toolId: "tool_video_publish", permissionLevel: "L5" },
  // AI-Marketing chỉ được xem thư viện video (Least Privilege).
  { agentId: "agent_marketing", toolId: "tool_video_search", permissionLevel: "L2" },
];

/**
 * Idempotent, an toàn khi chạy mỗi lần khởi động:
 *  - Tool: luôn upsert (mô tả/risk theo code mới nhất).
 *  - Agent + quyền: CHỈ tạo khi agent chưa tồn tại — không "hồi sinh" agent đã bị
 *    Founder sa thải/tạm dừng và không ghi đè quyền Founder đã chỉnh.
 */
export async function ensureVideoAgent(): Promise<{ created: boolean }> {
  for (const tool of videoToolsSeed) {
    await db.tool.upsert({
      where: { id: tool.id },
      update: {
        name: tool.name,
        description: tool.description,
        riskLevel: tool.riskLevel,
        requiresApproval: tool.requiresApproval,
      },
      create: tool,
    });
  }

  const existing = await db.agent.findUnique({ where: { id: VIDEO_AGENT_ID } });
  if (existing) return { created: false };

  const dept = videoAgentSeed.departmentId
    ? await db.department.findUnique({ where: { id: videoAgentSeed.departmentId } })
    : null;
  await db.agent.create({
    data: { ...videoAgentSeed, departmentId: dept ? dept.id : null },
  });

  for (const perm of videoToolPermissionsSeed) {
    const agent = await db.agent.findUnique({ where: { id: perm.agentId } });
    if (!agent) continue; // vd: agent_marketing chưa được seed
    await db.agentToolPermission.upsert({
      where: { agentId_toolId: { agentId: perm.agentId, toolId: perm.toolId } },
      update: {},
      create: perm,
    });
  }
  return { created: true };
}
