/**
 * Gateway LLM trừu tượng cho AI-OPC — Hỗ trợ Gemini, OpenAI, Anthropic và Custom Local (Ollama, LM Studio, vLLM).
 *
 * Tính năng:
 * 1. Hỗ trợ Local LLM / Custom OpenAI-compatible endpoints qua CUSTOM_LLM_URL / LOCAL_LLM_URL.
 * 2. Multi-Model Cascade: Tự động chuyển sang model flash/mini khi model chính bị 503 (quá tải) hoặc 429 (hết rate limit).
 * 3. Multi-Provider Failover: Tự động chuyển sang provider dự phòng nếu có cấu hình nhiều key/endpoint trong .env.
 * 4. Tất cả callers (Orchestrator, AgentReasoner) chỉ cần gọi 1 hàm duy nhất:
 *    `generateContent(systemPrompt, userPrompt, opts)`
 */
import { callGemini } from "./gemini";
import { callOpenAi } from "./openai";
import { callAnthropic } from "./anthropic";
import { callCustomLlm } from "./custom";
import {
  resolveLlm,
  isLlmConfigured,
  getLlmStatusDescription,
  DEFAULT_MODELS,
  FALLBACK_MODELS,
  getAllAvailableProviders,
  getModelCandidates,
  type DynamicLlmConfig,
} from "./resolveProvider";
import type {
  LlmCallResult,
  LlmOptions,
  LlmProvider,
  ResolvedLlm,
  TokenUsage,
} from "./types";

async function executeCall(
  provider: LlmProvider,
  model: string,
  resolved: ResolvedLlm,
  systemPrompt: string,
  userPrompt: string,
  opts: LlmOptions
): Promise<LlmCallResult> {
  switch (provider) {
    case "gemini":
      return callGemini(systemPrompt, userPrompt, resolved, opts, model);
    case "openai":
      return callOpenAi(systemPrompt, userPrompt, resolved, opts, model);
    case "anthropic":
      return callAnthropic(systemPrompt, userPrompt, resolved, opts, model);
    case "custom":
      return callCustomLlm(systemPrompt, userPrompt, resolved, opts, model);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`LLM Provider không được hỗ trợ: ${_exhaustive}`);
    }
  }
}

export async function generateContent(
  systemPrompt: string,
  userPrompt: string,
  opts: LlmOptions = {},
  overrideConfig?: Partial<DynamicLlmConfig>
): Promise<LlmCallResult> {
  const availableProviders = getAllAvailableProviders(overrideConfig);

  if (availableProviders.length === 0) {
    throw new Error(
      "Chưa cấu hình LLM API Key hoặc Local URL. Hãy thêm ít nhất một trong các cấu hình trong Cài đặt (hoặc file .env): " +
        "GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, hoặc CUSTOM_LLM_URL (Ollama, LM Studio, vLLM, Groq)."
    );
  }

  const errors: string[] = [];

  for (let pIdx = 0; pIdx < availableProviders.length; pIdx++) {
    const currentProvider = availableProviders[pIdx];
    const candidateModels = getModelCandidates(currentProvider);

    for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
      const model = candidateModels[mIdx];

      try {
        const result = await executeCall(
          currentProvider.provider,
          model,
          currentProvider,
          systemPrompt,
          userPrompt,
          opts
        );
        return result;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push(`[${currentProvider.provider}:${model}] ${errMsg}`);

        const hasNextModel = mIdx + 1 < candidateModels.length;
        const hasNextProvider = pIdx + 1 < availableProviders.length;

        if (hasNextModel) {
          const nextModel = candidateModels[mIdx + 1];
          // eslint-disable-next-line no-console
          console.warn(
            `[LLM Fallback] Model ${currentProvider.provider}/${model} gặp sự cố. Tự động chuyển sang fallback model ${nextModel}...`
          );
        } else if (hasNextProvider) {
          const nextProvider = availableProviders[pIdx + 1];
          // eslint-disable-next-line no-console
          console.warn(
            `[LLM Failover] Provider ${currentProvider.provider} không phản hồi sau mọi model. Tự động chuyển sang provider ${nextProvider.provider} (${nextProvider.model})...`
          );
        }
      }
    }
  }

  throw new Error(
    `Tất cả các model và provider LLM đều thất bại:\n${errors.join("\n")}`
  );
}

export {
  resolveLlm,
  isLlmConfigured,
  getLlmStatusDescription,
  DEFAULT_MODELS,
  FALLBACK_MODELS,
  getAllAvailableProviders,
  getModelCandidates,
};

export {
  extractJsonObject,
  extractJsonArray,
  tryParseJson,
  sanitizeJsonString,
} from "./jsonExtractor";

export type {
  LlmCallResult,
  LlmOptions,
  LlmProvider,
  ResolvedLlm,
  TokenUsage,
};

