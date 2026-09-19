/**
 * Orchestrator (AI-COO) — nhận 1 GOAL từ Founder, gọi LLM Gateway (Gemini / OpenAI / Anthropic / Custom Local)
 * để phân rã thành các sub-task cụ thể, mỗi sub-task giao cho đúng 1 Department
 * Agent đang có trong hệ thống.
 *
 * Tất cả calls LLM đi qua `lib/llm/index.ts` (tự động resolve provider & model).
 *
 * GIỚI HẠN QUYỀN CỐ Ý: Orchestrator CHỈ được tạo Task (đề xuất kế hoạch).
 * Nó không có quyền gọi ToolGateway hay thực thi bất kỳ hành động thật nào —
 * ranh giới: AI-COO chỉ lập kế hoạch, Department Agent mới hành động (Rule 2–5).
 */
import { randomUUID } from "crypto";
import { db } from "../../db/client";
import { broadcastCompanyEvent } from "../../ws/gateway";
import {
  generateContent,
  isLlmConfigured,
  extractJsonObject,
  extractJsonArray,
} from "../../lib/llm";
import { recordModelCost } from "../cost/costTracker";
import { searchKnowledge, formatKnowledgeForPrompt } from "../memory/knowledgeBase";
import type { RiskLevel, Task } from "@ai-opc/shared";

interface SubTaskDraft {
  title: string;
  objective: string;
  assignedTo: string;  // phải khớp 1 agent id có thật trong DB
  riskLevel: RiskLevel;
}

const VALID_RISK: RiskLevel[] = ["R0", "R1", "R2", "R3", "R4"];

// ---- Prompt builders ---------------------------------------------------

function buildSystemPrompt(): string {
  return [
    "Bạn là AI-COO (Chief Operating Officer) của một công ty vận hành theo mô hình",
    "'One-Person Company' — Founder là người duy nhất ra quyết định, mọi việc thực thi",
    "do đội ngũ AI Agent phụ trách.",
    "",
    "Nhiệm vụ: nhận 1 GOAL từ Founder, phân rã thành 3–6 sub-task cụ thể và khả thi,",
    "mỗi sub-task giao cho ĐÚNG 1 Department Agent phù hợp nhất trong danh sách cung cấp.",
    "Đánh giá risk level cho từng sub-task:",
    "  R0 = hoàn toàn an toàn (đọc dữ liệu, nghiên cứu)",
    "  R1 = rủi ro thấp (tạo nội dung, phân tích)",
    "  R2 = rủi ro trung bình (gửi email, cập nhật hồ sơ)",
    "  R3 = rủi ro cao (thay đổi DB, thanh toán nhỏ, deploy staging)",
    "  R4 = rủi ro nghiêm trọng (production deploy, thanh toán lớn, pháp lý)",
    "",
    "QUY ĐỊNH BẮT BUỘC:",
    "  - Chỉ dùng agent id có trong danh sách cung cấp — TUYỆT ĐỐI KHÔNG tự tạo id mới.",
    "  - Mỗi sub-task chỉ giao cho đúng 1 agent.",
    "  - Sub-task phải cụ thể, có output đo lường được.",
    "  - TUYỆT ĐỐI KHÔNG thêm lời chào, hội thoại, markdown hay văn bản nào ngoài JSON.",
    "",
    "CHỈ trả lời bằng đúng 1 JSON object hợp lệ theo schema sau:",
    '{"subtasks":[{"title":"<tên ngắn gọn>","objective":"<mục tiêu + output cụ thể>","assignedTo":"<agent_id>","riskLevel":"R0|R1|R2|R3|R4"}]}',
  ].join("\n");
}

function buildUserPrompt(
  goalText: string,
  agents: { id: string; title: string; mission: string }[],
  knowledgeContext = ""
): string {
  const agentList = agents
    .map((a) => `  - ${a.id}: ${a.title} — ${a.mission}`)
    .join("\n");
  return [
    `GOAL của Founder: "${goalText}"`,
    knowledgeContext,
    "",
    "Danh sách Department Agent hiện có (chỉ được dùng đúng các id này cho assignedTo):",
    agentList,
  ].filter(Boolean).join("\n");
}

// ---- JSON parse & validate ---------------------------------------------

function parseSubTasks(rawText: string, validAgentIds: Set<string>): SubTaskDraft[] {
  let rawList: unknown[] = [];

  // Tầng 1: Tìm object { subtasks: [...] }
  const obj = extractJsonObject<{ subtasks?: unknown[] }>(rawText);
  if (obj && Array.isArray(obj.subtasks)) {
    rawList = obj.subtasks;
  } else {
    // Tầng 2: Nếu model trả về mảng trực tiếp [ {...}, {...} ]
    const arr = extractJsonArray<unknown>(rawText);
    if (arr && arr.length > 0) {
      rawList = arr;
    }
  }

  if (rawList.length === 0) {
    return [];
  }

  const validDrafts: SubTaskDraft[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;

    const title = typeof s.title === "string" ? s.title.trim() : "";
    const objective = typeof s.objective === "string" ? s.objective.trim() : "";
    let assignedTo = typeof s.assignedTo === "string" ? s.assignedTo.trim() : "";

    // Tự động chuẩn hóa assignedTo nếu model trả về hơi lệch case/khoảng trắng
    if (!validAgentIds.has(assignedTo)) {
      const match = Array.from(validAgentIds).find(
        (id) => id.toLowerCase() === assignedTo.toLowerCase()
      );
      if (match) assignedTo = match;
    }

    let riskLevel = typeof s.riskLevel === "string" ? (s.riskLevel.trim().toUpperCase() as RiskLevel) : "R1";
    if (!VALID_RISK.includes(riskLevel)) {
      riskLevel = "R1";
    }

    if (title && objective && validAgentIds.has(assignedTo)) {
      validDrafts.push({
        title,
        objective,
        assignedTo,
        riskLevel,
      });
    } else {
      // eslint-disable-next-line no-console
      console.warn("[Orchestrator] Bỏ qua sub-task không hợp lệ:", JSON.stringify(s));
    }
  }

  return validDrafts;
}

// ---- Public API --------------------------------------------------------

/**
 * Phân rã 1 goal text thành danh sách sub-task draft.
 * Hỗ trợ 4 tầng xử lý thông minh:
 *   1. Lấy kết quả & parse JSON siêu bền vững (chống preamble/postamble/smart quotes).
 *   2. 1-Shot Self-Healing Repair nếu lần đầu không ra JSON.
 *   3. Smart Kickoff Fallback nếu model trả lời hội thoại.
 */
export async function decomposeGoal(goalText: string): Promise<SubTaskDraft[]> {
  if (!isLlmConfigured()) {
    // eslint-disable-next-line no-console
    console.warn(
      "[Orchestrator] Chưa cấu hình LLM API Key hoặc Local URL (GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / CUSTOM_LLM_URL) trong .env — bỏ qua phân rã tự động.\n" +
        "  Thêm ít nhất 1 key hoặc URL vào services/api/.env rồi thử lại /goal."
    );
    return [];
  }

  // Budget Guardrail — AI-COO cũng là 1 Agent bình thường, có thể bị SUSPENDED
  // do vượt trần ngân sách riêng hoặc trần công ty. Không gọi model nếu vậy.
  const aiCoo = await db.agent.findUnique({ where: { id: "ai_coo" } });
  if (aiCoo?.status === "SUSPENDED") {
    // eslint-disable-next-line no-console
    console.warn(
      `[Orchestrator] AI-COO đang SUSPENDED (${aiCoo.suspendedReason ?? "không rõ lý do"}) — bỏ qua phân rã. ` +
        "Vào trang chi tiết Agent hoặc Cài đặt để tăng trần/reset chi phí."
    );
    return [];
  }

  const agents = await db.agent.findMany({
    where: { id: { not: "ai_coo" }, active: true }, // AI-COO không nhận task từ chính nó, chỉ giao cho Agent đang active
    select: { id: true, title: true, mission: true },
  });

  if (agents.length === 0) {
    // eslint-disable-next-line no-console
    console.warn("[Orchestrator] Chưa có Department Agent trong DB — chạy `pnpm db:seed` trước.");
    return [];
  }

  const validAgentIds = new Set<string>(agents.map((a: { id: string }) => a.id));

  // Tra cứu Company Knowledge Base để AI-COO hiểu ngữ cảnh công ty
  const knowledgeResults = await searchKnowledge(goalText, 4);
  const knowledgeContext = formatKnowledgeForPrompt(knowledgeResults);

  try {
    // Lần 1: Gọi model chính
    const result = await generateContent(
      buildSystemPrompt(),
      buildUserPrompt(goalText, agents, knowledgeContext),
      { maxTokens: 1500, temperature: 0.2, jsonMode: true }
    );

    // Ghi nhận chi phí cho AI-COO
    await recordModelCost("ai_coo", result.usage, "Orchestrator phân rã goal");

    const drafts = parseSubTasks(result.text, validAgentIds);
    if (drafts.length > 0) {
      return drafts;
    }

    // eslint-disable-next-line no-console
    console.warn(
      `[Orchestrator] Model không trả về JSON schema chuẩn. Kích hoạt 1-Shot Self-Healing Repair... (Raw: ${result.text.slice(0, 100)}...)`
    );

    // Lần 2: 1-Shot Repair
    const repairSystem = [
      "Bạn là AI-COO chuyên gia chuẩn hóa dữ liệu sang JSON.",
      "Chỉ trả về ĐÚNG 1 JSON object theo định dạng bắt buộc, TUYỆT ĐỐI KHÔNG có lời chào, giải thích hay markdown.",
    ].join("\n");

    const repairUser = [
      `MỤC TIÊU CỦA FOUNDER: "${goalText}"`,
      result.text ? `PHẢN HỒI TRƯỚC ĐÓ CỦA HỆ THỐNG: "${result.text.slice(0, 400)}"` : "",
      "",
      "Hãy phân rã mục tiêu trên thành 2–5 sub-tasks và trả về ĐÚNG 1 JSON object theo cấu trúc:",
      '{"subtasks":[{"title":"<tên task ngắn gọn>","objective":"<mục tiêu cụ thể>","assignedTo":"<agent_id>","riskLevel":"R0|R1|R2|R3|R4"}]}',
      "",
      "Danh sách Agent ID hợp lệ:",
      agents.map((a: { id: string; title: string }) => `  - ${a.id}: ${a.title}`).join("\n"),
    ].join("\n");

    const repairResult = await generateContent(repairSystem, repairUser, {
      maxTokens: 1000,
      temperature: 0.1,
      jsonMode: true,
    });

    await recordModelCost("ai_coo", repairResult.usage, "Orchestrator 1-Shot Repair");

    const repairedDrafts = parseSubTasks(repairResult.text, validAgentIds);
    if (repairedDrafts.length > 0) {
      return repairedDrafts;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[Orchestrator] Lỗi khi gọi LLM cho goal:", err);
  }

  // Tầng 3: Smart Conversational Fallback — Nếu model trả về dạng text hội thoại hoặc chưa phân rã được,
  // tạo 1 Kickoff Sub-task giao cho Agent phù hợp (agent_product / agent_tech / agent đầu tiên)
  // để luồng vận hành không bị BLOCKED.
  const preferredAgentId: string =
    (validAgentIds.has("agent_product") ? "agent_product" : "") ||
    (validAgentIds.has("agent_tech") ? "agent_tech" : "") ||
    Array.from(validAgentIds)[0] ||
    "agent_ops";

  // eslint-disable-next-line no-console
  console.info(
    `[Orchestrator] Tự động tạo Kickoff Sub-task làm rõ mục tiêu cho ${preferredAgentId}.`
  );

  return [
    {
      title: `Phân tích & làm rõ mục tiêu: ${goalText.slice(0, 60)}${goalText.length > 60 ? "..." : ""}`,
      objective: `Tiếp nhận mục tiêu từ Founder: "${goalText}". Phân tích yêu cầu, xác định các tiêu chí thành công (deliverables) và phác thảo các bước triển khai chi tiết cho các bộ phận.`,
      assignedTo: preferredAgentId,
      riskLevel: "R1",
    },
  ];
}

/**
 * Chạy toàn bộ luồng phân rã goal:
 *   1. decomposeGoal → lấy danh sách sub-task draft
 *   2. Tạo từng Task con trong DB, broadcast TASK_UPDATED qua WebSocket
 *   3. Cập nhật task gốc:
 *      - PLANNED nếu có ít nhất 1 sub-task tạo được
 *      - BLOCKED nếu không có (thiếu API key / DB rỗng) → Founder biết cần xử lý tay
 */
export async function runOrchestratorForGoal(
  goalTaskId: string,
  goalText: string
): Promise<Task[]> {
  const drafts = await decomposeGoal(goalText);
  const created: Task[] = [];

  for (const draft of drafts) {
    const task = await db.task.create({
      data: {
        id: `task_${randomUUID()}`,
        parentTaskId: goalTaskId,
        title: draft.title.slice(0, 255),
        objective: draft.objective,
        assignedTo: draft.assignedTo,
        status: "ASSIGNED",
        riskLevel: draft.riskLevel,
        createdBy: "ai_coo",
      },
    });
    created.push(task as unknown as Task);
    broadcastCompanyEvent({ type: "TASK_UPDATED", payload: task });
  }

  // Cập nhật task gốc và broadcast
  const newStatus = created.length > 0 ? "PLANNED" : "BLOCKED";
  const updated = await db.task.update({
    where: { id: goalTaskId },
    data: { status: newStatus },
  });
  broadcastCompanyEvent({ type: "TASK_UPDATED", payload: updated });

  if (newStatus === "BLOCKED") {
    // eslint-disable-next-line no-console
    console.warn(
      `[Orchestrator] Goal task ${goalTaskId} chuyển BLOCKED — không tạo được sub-task. ` +
        "Kiểm tra GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / CUSTOM_LLM_URL trong .env hoặc tự tạo task thủ công."
    );
  }

  return created;
}

