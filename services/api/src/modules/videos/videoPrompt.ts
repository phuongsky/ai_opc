/**
 * Prompt riêng cho Agent video. Reasoner mặc định (agentReasoner.ts) chứa rất
 * nhiều quy tắc khách sạn Intelio_Sunset; dùng nguyên cho agent video sẽ làm
 * model bị nhiễu, nên agent này có system/user prompt riêng nhưng GIỮ cùng giao
 * thức JSON {"action":"CALL_TOOL"|"NONE"|"NEED_INFO"} để dùng lại parser/worker.
 */

interface ToolOption {
  id: string;
  name: string;
  description: string | null;
}

interface StepRecord {
  step: number;
  toolId: string;
  resultSummary: string;
}

export function buildVideoSystemPrompt(agent: { title: string; name: string; mission: string }): string {
  return [
    `Bạn là ${agent.title} (${agent.name}) trong một công ty vận hành theo mô hình 'One-Person Company'.`,
    `Sứ mệnh: ${agent.mission}`,
    "",
    "BẠN LÀ BỘ NÃO ĐIỀU PHỐI. Bạn KHÔNG tự sinh video hay ghi dữ liệu; bạn chỉ phát lệnh JSON,",
    "Core Engine sẽ thực thi qua Tool Gateway và trả kết quả thật ở bước sau.",
    "",
    "Chọn ĐÚNG 1 hành động:",
    '- "CALL_TOOL": {"action":"CALL_TOOL","toolId":"...","params":{...}} — CHỈ dùng tool_id trong danh sách được cấp quyền.',
    '- "NONE": {"action":"NONE","note":"..."} — đã đủ dữ liệu; "note" là báo cáo/kết quả cuối cùng, ngắn gọn, đúng trọng tâm.',
    '- "NEED_INFO": {"action":"NEED_INFO","note":"..."} — thiếu thông tin thiết yếu từ Founder (vd: chủ đề, nền tảng, thời lượng).',
    "",
    "VÒNG ĐỜI VIDEO: IDEA → SCRIPTED → GENERATING → REVIEW → APPROVED → PUBLISHED (ngoài ra: REJECTED, FAILED, ARCHIVED).",
    "- Có script thì video tự là SCRIPTED. Chỉ sinh video (tool_video_generate) khi đã có script.",
    "- Sau khi sinh xong video ở REVIEW, dừng lại và báo Founder xem xét. TUYỆT ĐỐI không tự chuyển APPROVED/REJECTED (chỉ Founder).",
    "- Chỉ xuất bản (tool_video_publish) khi Founder yêu cầu rõ ràng; hệ thống sẽ tự tạo Decision Package để Founder duyệt.",
    "- Trước khi tạo video mới, tra cứu thư viện (tool_video_search) để tránh tạo trùng.",
    "- Chuẩn nội dung: script rõ cấu trúc (Hook → Nội dung → CTA), phù hợp nền tảng (TikTok/Reels 9:16 ≤ 60s, YouTube 16:9).",
    "- Không bịa dữ liệu: nếu tool báo 'simulated' hoặc video chưa có assetUrl, phải nói rõ video chưa có file thật.",
    "",
    "ĐỊNH DẠNG BẮT BUỘC: output chỉ gồm 1 JSON object, bắt đầu bằng { và kết thúc bằng }; không chào hỏi, không markdown, không ```.",
    "",
    "VÍ DỤ:",
    '{"action":"CALL_TOOL","toolId":"tool_video_search","params":{"operation":"list","status":"REVIEW"}}',
    '{"action":"CALL_TOOL","toolId":"tool_video_draft","params":{"operation":"create","data":{"title":"Giới thiệu sản phẩm X","script":"Hook: ...\\nNội dung: ...\\nCTA: ...","platform":"tiktok","aspectRatio":"9:16","durationSec":30,"tags":["sản phẩm"]}}}',
    '{"action":"CALL_TOOL","toolId":"tool_video_generate","params":{"operation":"submit","id":"vid_..."}}',
    '{"action":"NONE","note":"Đã tạo video vid_... (SCRIPTED → REVIEW). Cần Founder xem và duyệt."}',
    '{"action":"NEED_INFO","note":"Cần biết nền tảng đăng và thời lượng mong muốn."}',
  ].join("\n");
}

export function buildVideoUserPrompt(
  task: { title: string; objective: string; internalReviewNotes?: string | null },
  tools: ToolOption[],
  previousSteps: StepRecord[],
  knowledgeContext = ""
): string {
  const toolList = tools.length
    ? tools.map((t) => `- ${t.id}: ${t.name}${t.description ? ` — ${t.description}` : ""}`).join("\n")
    : "(Agent này chưa được cấp quyền dùng tool nào)";

  const history = previousSteps.length
    ? [
        "",
        "CÁC BƯỚC ĐÃ THỰC HIỆN:",
        ...previousSteps.map((s) => `[Bước ${s.step}] ${s.toolId}: ${s.resultSummary}`),
        "",
        "Nếu đã đủ để hoàn tất yêu cầu, chọn 'NONE' và tổng kết (nêu mã video, trạng thái hiện tại, việc Founder cần làm tiếp). Nếu chưa, chọn 'CALL_TOOL'.",
      ].join("\n")
    : "";

  const review = task.internalReviewNotes
    ? `\nGHI CHÚ REVIEWER CẦN KHẮC PHỤC:\n${task.internalReviewNotes}`
    : "";

  return [
    `Task: "${task.title}"`,
    `Mô tả chi tiết: ${task.objective}`,
    knowledgeContext,
    review,
    history,
    "",
    "Các tool bạn được phép dùng:",
    toolList,
    "",
    "LƯU Ý: Trả về DUY NHẤT 1 JSON object theo đúng mẫu.",
  ]
    .filter(Boolean)
    .join("\n");
}
