/**
 * Client gọi Google Gemini API (Generative Language API v1beta).
 */
import { env } from "../../config/env";
import { postJsonWithRetry } from "./retry";
import type { LlmCallResult, LlmOptions, ResolvedLlm } from "./types";

export async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  resolved: ResolvedLlm,
  opts: LlmOptions = {},
  modelOverride?: string
): Promise<LlmCallResult> {
  const { maxTokens = 2000, temperature = 0.2, jsonMode = true } = opts;
  const model = modelOverride || resolved.model;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${resolved.apiKey}`;

  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  const raw = await postJsonWithRetry(
    url,
    { "content-type": "application/json" },
    body,
    {
      maxRetries: env.llmMaxRetries,
      baseMs: env.llmRetryBaseMs,
      maxMs: env.llmRetryMaxMs,
      label: `Gemini (${model})`,
    }
  );

  const data = raw as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");

  const usage = {
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };

  return { text, usage };
}
