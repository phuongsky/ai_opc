/**
 * AgentReasoner — mỗi Department Agent tự "suy nghĩ" khi nhận 1 task, quyết
 * định 1 trong 3 hành động:
 *   - CALL_TOOL: cần dùng 1 tool cụ thể (chỉ được chọn trong danh sách tool
 *     mà agent này ĐÃ ĐƯỢC CẤP QUYỀN).
 *   - NONE: hoàn thành nhiệm vụ và đưa ra kết quả/tổng kết cuối cùng.
 *   - NEED_INFO: thiếu thông tin quan trọng cần Founder bổ sung.
 *
 * Hỗ trợ Multi-step Reasoning: nhận vào lịch sử các bước đã chạy trước đó
 * để suy nghĩ bước tiếp theo.
 */
import { db } from "../../db/client";
import { generateContent, isLlmConfigured, extractJsonObject } from "../../lib/llm";
import { recordModelCost } from "../cost/costTracker";
import { searchKnowledge, formatKnowledgeForPrompt } from "../memory/knowledgeBase";

export interface ToolStepRecord {
  step: number;
  toolId: string;
  params: Record<string, unknown>;
  resultSummary: string;
}

export type AgentAction =
  | { action: "CALL_TOOL"; toolId: string; params: Record<string, unknown> }
  | { action: "NONE"; note: string }
  | { action: "NEED_INFO"; note: string };

interface RawModelResponse {
  action?: "CALL_TOOL" | "NONE" | "NEED_INFO";
  toolId?: string;
  params?: Record<string, unknown>;
  note?: string;
}

function buildSystemPrompt(agent: { title: string; name: string; mission: string }): string {
  return [
    `Bạn là ${agent.title} (${agent.name}) trong một công ty vận hành theo mô hình 'One-Person Company'.`,
    `Sứ mệnh của bạn: ${agent.mission}`,
    "",
    "Bạn đang xử lý một task cụ thể. Bạn có thể thực hiện tuần tự nhiều bước (Multi-step) để hoàn thành trọn vẹn nhiệm vụ.",
    "Hãy quyết định ĐÚNG 1 trong 3 hành động sau:",
    '- "CALL_TOOL": nếu cần gọi một công cụ (ví dụ: tìm kiếm web, đọc DB, gửi email...) để lấy dữ liệu hoặc thực thi — CHỈ được chọn tool_id có trong danh sách được cấp quyền bên dưới.',
    '- "NONE": nếu bạn đã có đủ dữ liệu từ các bước trước hoặc có thể hoàn thành bằng suy luận/soạn thảo — kèm "note" là BÁO CÁO / KẾT QUẢ HOÀN TẤT ĐẦY ĐỦ VÀ CHUYÊN NGHIỆP.',
    '- "NEED_INFO": nếu gặp trở ngại lớn hoặc thiếu dữ liệu cơ bản không thể tự giải quyết.',
    "",
    "QUY ĐỊNH BẮT BUỘC:",
    "- CHỈ trả lời bằng đúng 1 JSON object hợp lệ. KHÔNG thêm bất kỳ lời chào hay giải thích nào ngoài JSON.",
    '- Schema: {"action":"CALL_TOOL|NONE|NEED_INFO","toolId":"...","params":{...},"note":"..."}',
  ].join("\n");
}

function buildUserPrompt(
  task: { title: string; objective: string; internalReviewNotes?: string | null },
  tools: { id: string; name: string; description: string | null; riskLevel: string; permissionLevel: string }[],
  previousSteps: ToolStepRecord[],
  knowledgeContext = ""
): string {
  const toolList =
    tools.length > 0
      ? tools
          .map(
            (t) =>
              `- ${t.id}: ${t.name}${t.description ? ` — ${t.description}` : ""} [risk ${t.riskLevel}, quyền hiện có ${t.permissionLevel}]`
          )
          .join("\n")
      : "(Agent này chưa được cấp quyền dùng tool nào)";

  const historyText =
    previousSteps.length > 0
      ? [
          "",
          "LỊCH SỬ CÁC BƯỚC ĐÃ THỰC HIỆN TRƯỚC ĐÓ CHO TASK NÀY:",
          ...previousSteps.map(
            (s) =>
              `[Bước ${s.step}] Tool '${s.toolId}': ${s.resultSummary}`
          ),
          "",
          "Hãy xem xét kỹ kết quả trên. Nếu đã đủ dữ liệu để hoàn tất công việc, hãy chọn 'NONE' và tổng kết kết quả vào 'note'. Nếu cần thêm bước xử lý khác, hãy chọn 'CALL_TOOL'.",
        ].join("\n")
      : "";

  const reviewNotesText = task.internalReviewNotes
    ? [
        "",
        "GHI CHÚ ĐÁNH GIÁ NỘI BỘ (REVIEWER FEEDBACK CẦN KHẮC PHỤC):",
        task.internalReviewNotes,
        "Lưu ý: Bạn phải lưu ý các nhận xét trên của Reviewer để điều chỉnh phương pháp và khắc phục triệt để.",
      ].join("\n")
    : "";

  return [
    `Task: "${task.title}"`,
    `Mô tả chi tiết: ${task.objective}`,
    knowledgeContext,
    reviewNotesText,
    historyText,
    "",
    "Các tool bạn được phép dùng:",
    toolList,
  ].filter(Boolean).join("\n");
}

/**
 * Cho agent quyết định hành động cho 1 task (hỗ trợ multi-step history).
 */
export async function decideAgentAction(
  agentId: string,
  task: { title: string; objective: string; internalReviewNotes?: string | null },
  previousSteps: ToolStepRecord[] = []
): Promise<AgentAction> {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new Error(`Agent không tồn tại: ${agentId}`);

  const permissions = await db.agentToolPermission.findMany({
    where: { agentId },
    include: { tool: true },
  });

  const toolOptions = permissions.map((p: { tool: { id: string; name: string; description: string | null; riskLevel: string }; permissionLevel: string }) => ({
    id: p.tool.id,
    name: p.tool.name,
    description: p.tool.description,
    riskLevel: p.tool.riskLevel,
    permissionLevel: p.permissionLevel,
  }));

  if (!isLlmConfigured()) {
    // Không có API key — agent tự xử lý bằng suy luận
    return {
      action: "NONE",
      note: `(Không có LLM API Key — agent tự hoàn thành bằng suy luận) Task "${task.title}" đã được xử lý nội bộ.`,
    };
  }

  // Tra cứu Company Knowledge Base để Agent có ngữ cảnh kiến thức công ty
  const knowledgeResults = await searchKnowledge(`${task.title} ${task.objective}`, 3);
  const knowledgeContext = formatKnowledgeForPrompt(knowledgeResults);

  const result = await generateContent(
    buildSystemPrompt(agent),
    buildUserPrompt(task, toolOptions, previousSteps, knowledgeContext),
    { maxTokens: 800, temperature: 0.1, jsonMode: true }
  );

  // Ghi nhận chi phí cho Department Agent
  await recordModelCost(
    agentId,
    result.usage,
    `AgentReasoner quyết định bước ${previousSteps.length + 1} cho task "${task.title}"`
  );

  const parsed = extractJsonObject<RawModelResponse>(result.text);

  if (!parsed || !parsed.action) {
    console.warn(
      `[AgentReasoner] Model không trả về JSON schema chuẩn cho agent ${agentId}. Raw:`,
      result.text.slice(0, 150)
    );

    const textNote = result.text.trim();
    if (textNote.length > 0 && !textNote.toLowerCase().includes("error")) {
      return {
        action: "NONE",
        note: textNote.slice(0, 500),
      };
    }

    return {
      action: "NEED_INFO",
      note: `Model phản hồi không đúng định dạng JSON: ${result.text.slice(0, 150)}`,
    };
  }

  if (parsed.action === "CALL_TOOL") {
    const validIds = new Set(toolOptions.map((t: { id: string }) => t.id));
    if (!parsed.toolId || !validIds.has(parsed.toolId)) {
      return {
        action: "NEED_INFO",
        note: `Model chọn tool không hợp lệ hoặc chưa được cấp quyền: ${parsed.toolId ?? "(trống)"}`,
      };
    }
    return { action: "CALL_TOOL", toolId: parsed.toolId, params: parsed.params ?? {} };
  }

  if (parsed.action === "NONE") {
    return { action: "NONE", note: parsed.note ?? "(Hoàn thành nhiệm vụ thành công)" };
  }

  return { action: "NEED_INFO", note: parsed.note ?? "Thiếu thông tin để xử lý task này." };
}
