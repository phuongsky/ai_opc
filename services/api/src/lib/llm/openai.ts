/**
 * Client gọi OpenAI Chat Completions API (/v1/chat/completions).
 */
import { env } from "../../config/env";
import { postJsonWithRetry } from "./retry";
import type { LlmCallResult, LlmOptions, ResolvedLlm } from "./types";

export async function callOpenAi(
  systemPrompt: string,
  userPrompt: string,
  resolved: ResolvedLlm,
  opts: LlmOptions = {},
  modelOverride?: string
): Promise<LlmCallResult> {
  const { maxTokens = 2000, temperature = 0.2, jsonMode = true } = opts;
  const model = modelOverride || resolved.model;

  const url = "https://api.openai.com/v1/chat/completions";

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${resolved.apiKey}`,
  };

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: maxTokens,
    temperature,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  };

  const raw = await postJsonWithRetry(url, headers, body, {
    maxRetries: env.llmMaxRetries,
    baseMs: env.llmRetryBaseMs,
    maxMs: env.llmRetryMaxMs,
    label: `OpenAI (${model})`,
  });

  const data = raw as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content ?? "";
  const usage = {
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };

  return { text, usage };
}
