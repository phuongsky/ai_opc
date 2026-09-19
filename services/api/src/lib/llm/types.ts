/**
 * Types dùng chung cho gateway LLM.
 *
 * Tất cả provider (Gemini / OpenAI / Anthropic / Custom Local) đều trả về 1 cấu trúc
 * thống nhất { text, usage } để `modules/cost/costTracker.ts` tính chi phí
 * thật — caller (Orchestrator, AgentReasoner) không cần biết mình đang gọi
 * provider nào.
 */

export type LlmProvider = "gemini" | "openai" | "anthropic" | "custom";

/** Số token THẬT trả về trong response (dùng cho cost tracking). */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCallResult {
  /** Nội dung text model trả về (chưa parse). */
  text: string;
  usage: TokenUsage;
}

export interface LlmOptions {
  /** Token tối đa cho phần output (mỗi client map sang tên riêng của API). */
  maxTokens?: number;
  /** Temperature sampling. */
  temperature?: number;
  /**
   * Yêu cầu model trả JSON. Gemini/OpenAI có cờ native; Anthropic không có
   * nên người gọi phải tự dặn JSON trong system prompt (đang làm vậy).
   */
  jsonMode?: boolean;
}

/** Kết quả đã resolve: gọi provider nào, model nào, bằng key nào, endpoint nào. */
export interface ResolvedLlm {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  /** true = provider+model được TỰ chọn từ key (không set tay ORCHESTRATOR_MODEL). */
  auto: boolean;
}
