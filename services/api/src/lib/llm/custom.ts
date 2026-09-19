/**
 * Client gọi Custom / Local LLM Endpoint (OpenAI-compatible: Ollama, LM Studio, vLLM, LocalAI, Custom Proxy).
 */
import { env } from "../../config/env";
import { postJsonWithRetry } from "./retry";
import type { LlmCallResult, LlmOptions, ResolvedLlm } from "./types";

function buildEndpointUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

export async function callCustomLlm(
  systemPrompt: string,
  userPrompt: string,
  resolved: ResolvedLlm,
  opts: LlmOptions = {},
  modelOverride?: string
): Promise<LlmCallResult> {
  const { maxTokens = 2000, temperature = 0.2, jsonMode = true } = opts;
  const model = modelOverride || resolved.model || "auto";
  const baseUrl = resolved.baseUrl || env.customLlmUrl || "http://localhost:11434/v1";
  const url = buildEndpointUrl(baseUrl);

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (resolved.apiKey) {
    headers["authorization"] = `Bearer ${resolved.apiKey}`;
  }

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: maxTokens,
    temperature,
    stream: false,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  };

  const raw = await postJsonWithRetry(url, headers, body, {
    maxRetries: env.llmMaxRetries,
    baseMs: env.llmRetryBaseMs,
    maxMs: env.llmRetryMaxMs,
    label: `CustomLocal (${model} @ ${baseUrl})`,
  });

  const data = raw as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content ?? "";

  // Dự phòng: một số local server không trả usage, tự tính xấp xỉ 1 token ~ 4 ký tự để không crash cost tracker
  const inputTokens =
    data.usage?.prompt_tokens ??
    Math.max(1, Math.ceil((systemPrompt.length + userPrompt.length) / 4));
  const outputTokens =
    data.usage?.completion_tokens ?? Math.max(1, Math.ceil(text.length / 4));

  const usage = {
    inputTokens,
    outputTokens,
  };

  return { text, usage };
}
