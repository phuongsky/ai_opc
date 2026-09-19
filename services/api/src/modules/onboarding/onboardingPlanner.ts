/**
 * Onboarding Planner — dùng LLM Gateway để đề xuất cơ cấu phòng ban + đội ngũ
 * AI Agent + Permission Matrix ban đầu, dựa trên mô tả công việc kinh doanh
 * của Founder. Đây là bước "ĐỀ XUẤT" thuần tuý — KHÔNG tự ghi gì vào DB,
 * Founder xem trước và có thể bỏ chọn từng agent ở UI trước khi
 * routes/onboarding.route.ts (endpoint /apply-plan) mới thực sự tạo dữ liệu.
 */
import { db } from "../../db/client";
import { generateContent, isLlmConfigured } from "../../lib/llm";
import { recordModelCost } from "../cost/costTracker";
import { tryParseJson } from "../../lib/llm/jsonExtractor";

export type RiskTolerance = "conservative" | "balanced" | "bold";

export interface AgentPlanDraft {
  name: string;
  title: string;
  departmentName: string;
  mission: string;
  autonomyLevel: number;
  toolPermissions: { toolId: string; permissionLevel: string }[];
}

export interface OnboardingPlan {
  departments: string[];
  agents: AgentPlanDraft[];
}

const RISK_GUIDANCE: Record<RiskTolerance, string> = {
  conservative:
    "Founder chọn mức THẬN TRỌNG: ưu tiên permissionLevel thấp (L1-L3), autonomyLevel thấp (0-1), " +
    "chỉ cấp quyền tool THỰC SỰ cần thiết cho công việc chính của agent đó.",
  balanced:
    "Founder chọn mức CÂN BẰNG: permissionLevel vừa phải (L2-L4) cho tool agent cần dùng thường xuyên, " +
    "autonomyLevel 1-2.",
  bold:
    "Founder chọn mức TÁO BẠO, ưu tiên tốc độ: permissionLevel cao hơn (L3-L6) cho tool đúng chuyên môn " +
    "của agent, autonomyLevel 2-3. Vẫn không được cấp tool ngoài chuyên môn của agent.",
};

function buildSystemPrompt(riskTolerance: RiskTolerance, toolList: string): string {
  return [
    "Bạn là chuyên gia thiết kế tổ chức cho mô hình 'AI-Native One-Person Company' — 1 Founder",
    "điều hành cả công ty qua đội ngũ AI Agent. Nhiệm vụ: đọc mô tả công việc kinh doanh của Founder,",
    "đề xuất cơ cấu phòng ban + đội ngũ AI Agent TỐI THIỂU cần thiết (3-6 agent, không thừa không thiếu).",
    "",
    RISK_GUIDANCE[riskTolerance],
    "",
    "Danh sách Tool CÓ SẴN trong hệ thống (CHỈ được dùng đúng các tool_id này, KHÔNG bịa tool mới):",
    toolList,
    "",
    "LƯU Ý HỆ THỐNG (không đổi được qua permissionLevel): tool risk R3/R4 LUÔN cần Founder duyệt thủ",
    "công trước khi chạy thật, bất kể permissionLevel cao thấp ra sao — đây là quy tắc an toàn cố định,",
    "nên bạn có thể tự tin cấp permissionLevel phù hợp mà không lo agent tự ý làm việc nguy hiểm.",
    "",
    "QUY TẮC BẮT BUỘC:",
    "  - Mỗi agent có 1 mission cụ thể, không chung chung, bám sát mô tả công ty của Founder.",
    "  - Đặt tên agent dạng 'AI-<Vai trò>' (vd: AI-Sales, AI-Support, AI-Content).",
    "  - Chỉ gán tool THỰC SỰ liên quan tới công việc của agent đó — không gán tràn lan.",
    "  - Không tạo quá 6 agent, không tạo quá 6 phòng ban.",
    "",
    "CHỈ trả lời bằng đúng 1 JSON object hợp lệ, KHÔNG kèm markdown, theo schema:",
    '{"departments":["..."],"agents":[{"name":"AI-...","title":"...","departmentName":"...",' +
      '"mission":"...","autonomyLevel":0,"toolPermissions":[{"toolId":"...","permissionLevel":"L0"}]}]}',
  ].join("\n");
}

function cleanAndParseJson<T>(rawText: string): T {
  // Thử trích xuất qua bộ parser cứu hộ nhiều tầng của hệ thống trước
  const extracted = tryParseJson<T>(rawText);
  if (extracted) return extracted;

  const cleaned = rawText.replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new Error(
      `Không parse được JSON từ model: ${(err as Error).message}\nRaw (300 chars): ${cleaned.slice(0, 300)}`
    );
  }
}

/**
 * Đảm bảo agent hệ thống "ai_coo" luôn tồn tại — nhiều module (Orchestrator,
 * CostTracker...) hardcode agentId này. Idempotent, gọi lại nhiều lần vô hại.
 * Gọi TRƯỚC khi tính chi phí LLM của chính Onboarding Wizard, vì lệnh gọi
 * model đầu tiên trong đời hệ thống cũng cần 1 agent có thật để gắn cost vào.
 */
export async function ensureAiCoo(): Promise<void> {
  const existing = await db.agent.findUnique({ where: { id: "ai_coo" } });
  if (existing) return;
  await db.agent.create({
    data: {
      id: "ai_coo",
      name: "AI-COO",
      title: "Chief Operating Officer",
      mission: "Điều phối toàn bộ công ty, phân rã /goal của Founder thành sub-task cho từng Department Agent.",
      autonomyLevel: 3,
      status: "READY",
    },
  });
}

export async function generateOnboardingPlan(
  companyDescription: string,
  riskTolerance: RiskTolerance
): Promise<OnboardingPlan> {
  if (!isLlmConfigured()) {
    throw new Error(
      "Chưa cấu hình LLM (GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / CUSTOM_LLM_URL) trong .env — " +
        "Onboarding Wizard cần LLM để đề xuất cơ cấu. Cấu hình xong rồi thử lại."
    );
  }

  const tools: Array<{ id: string; name: string; description?: string | null; riskLevel?: string }> =
    await db.tool.findMany();
  if (tools.length === 0) {
    throw new Error("Chưa có Tool nào trong registry — chạy `pnpm db:seed` để có bộ tool mẫu trước.");
  }
  const toolList = tools
    .map((t) => `  - ${t.id}: ${t.name} (${t.description ?? ""}) [risk ${t.riskLevel ?? "R1"}]`)
    .join("\n");

  await ensureAiCoo();

  const userPrompt = `Mô tả công việc kinh doanh của Founder:\n"${companyDescription}"`;

  const result = await generateContent(buildSystemPrompt(riskTolerance, toolList), userPrompt, {
    maxTokens: 2000,
    temperature: 0.3,
    jsonMode: true,
  });

  await recordModelCost("ai_coo", result.usage, "Onboarding Wizard: sinh đề xuất cơ cấu công ty");

  const parsed = cleanAndParseJson<{ departments?: string[]; agents?: AgentPlanDraft[] }>(result.text);
  const validToolIds = new Set(tools.map((t) => t.id));
  const validPermLevels = new Set(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);

  const agents = (parsed.agents ?? [])
    .filter((a) => a.name?.trim() && a.title?.trim() && a.mission?.trim())
    .map((a) => ({
      name: a.name.trim(),
      title: a.title.trim(),
      departmentName: (a.departmentName || "General").trim(),
      mission: a.mission.trim(),
      autonomyLevel: Math.min(5, Math.max(0, Number(a.autonomyLevel) || 1)),
      toolPermissions: (a.toolPermissions ?? []).filter(
        (p) => validToolIds.has(p.toolId) && validPermLevels.has(p.permissionLevel)
      ),
    }));

  const departments = Array.from(new Set([...(parsed.departments ?? []), ...agents.map((a) => a.departmentName)]));

  return { departments, agents };
}
