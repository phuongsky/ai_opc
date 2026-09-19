/**
 * Client gọi Anthropic Messages API (/v1/messages).
 */
import { env } from "../../config/env";
import { postJsonWithRetry } from "./retry";
import type { LlmCallResult, LlmOptions, ResolvedLlm } from "./types";

export async function callAnthropic(
  systemPrompt: string,
  userPrompt: string,
  resolved: ResolvedLlm,
  opts: LlmOptions = {},
  modelOverride?: string
): Promise<LlmCallResult> {
  const { maxTokens = 2000, temperature = 0.2 } = opts;
  const model = modelOverride || resolved.model;

  const url = "https://api.anthropic.com/v1/messages";

  const headers = {
    "content-type": "application/json",
    "x-api-key": resolved.apiKey || "",
    "anthropic-version": "2023-06-01",
  };

  const body: Record<string, unknown> = {
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    max_tokens: maxTokens,
    temperature,
  };

  const raw = await postJsonWithRetry(url, headers, body, {
    maxRetries: env.llmMaxRetries,
    baseMs: env.llmRetryBaseMs,
    maxMs: env.llmRetryMaxMs,
    label: `Anthropic (${model})`,
  });

  const data = raw as {
    content?: { type?: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text = (data.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text ?? "")
    .join("");

  const usage = {
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };

  return { text, usage };
}
