/**
 * Client tạo embedding (vector số) cho Company Knowledge Base — dùng chung
 * cho việc ingest tài liệu và semantic search (modules/memory/knowledgeBase.ts).
 *
 * Hỗ trợ 4 chế độ:
 *   1. "openai": Model `text-embedding-3-small` (1536 dims)
 *   2. "gemini": Model `text-embedding-004` (768 dims)
 *   3. "custom": OpenAI-compatible endpoint có /v1/embeddings (Ollama, LM Studio...)
 *   4. "builtin": Bộ sinh vector đặc trưng 384-dim (TF-IDF & N-gram Hashing) nội bộ
 *      chạy 100% in-memory, 0 token cost, 0 network dependency, hoạt động ngay cả khi
 *      custom endpoint (như proxy chat) không hỗ trợ route /v1/embeddings (404).
 *
 * TỰ ĐỘNG FALLBACK THÔNG MINH (Self-Healing):
 *   Nếu gọi remote API (OpenAI/Gemini/Custom) gặp lỗi 404 (endpoint không có),
 *   401 hoặc network error, hệ thống tự động fallback sang "builtin" vectorizer
 *   thay vì crash 500 hoặc ngắt quãng luồng nạp/tìm kiếm tài liệu của Founder.
 */
import { env } from "../../config/env";
import { postJsonWithRetry } from "./retry";
import { generateLocalEmbedding } from "./localVectorizer";
import { getCachedDynamicLlmConfig } from "./resolveProvider";

export type EmbeddingProvider = "openai" | "gemini" | "custom" | "builtin";

export interface EmbeddingResult {
  embedding: number[];
  /** Số token dùng để tính chi phí — ước lượng nếu provider không trả usage thật. */
  tokenCount: number;
  engine?: "remote" | "builtin";
}

const DEFAULT_EMBEDDING_MODEL: Record<EmbeddingProvider, string> = {
  openai: "text-embedding-3-small",
  gemini: "gemini-embedding-001",
  custom: "auto",
  builtin: "local-tfidf-384",
};

interface ResolvedEmbeddingProvider {
  provider: EmbeddingProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

function resolveEmbeddingProvider(): ResolvedEmbeddingProvider {
  const dynamic = getCachedDynamicLlmConfig();
  const explicit = env.embeddingProvider;

  const geminiKey =
    dynamic.embeddingApiKey ||
    dynamic.geminiApiKey ||
    process.env.EMBEDDING_API_KEY ||
    env.geminiApiKey ||
    process.env.GEMINI_API_KEY;
  const openaiKey =
    dynamic.embeddingApiKey ||
    dynamic.openaiApiKey ||
    process.env.EMBEDDING_API_KEY ||
    env.openaiApiKey ||
    process.env.OPENAI_API_KEY;
  const customKey =
    dynamic.embeddingApiKey ||
    dynamic.customLlmApiKey ||
    process.env.EMBEDDING_API_KEY ||
    env.customLlmApiKey ||
    process.env.CUSTOM_LLM_API_KEY;
  const customUrl = dynamic.customLlmUrl || env.embeddingBaseUrl || env.customLlmUrl;

  if (explicit === "builtin") {
    return { provider: "builtin", model: DEFAULT_EMBEDDING_MODEL.builtin, apiKey: "" };
  }
  if (explicit === "openai") {
    if (!openaiKey) {
      console.warn("[KnowledgeBase] EMBEDDING_PROVIDER=openai nhưng thiếu OPENAI_API_KEY hoặc EMBEDDING_API_KEY trong Cài đặt hoặc .env — Tự động fallback sang builtin TF-IDF vectorizer.");
      return { provider: "builtin", model: DEFAULT_EMBEDDING_MODEL.builtin, apiKey: "" };
    }
    return { provider: "openai", model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.openai, apiKey: openaiKey };
  }
  if (explicit === "gemini") {
    if (!geminiKey) {
      console.warn("[KnowledgeBase] EMBEDDING_PROVIDER=gemini nhưng thiếu GEMINI_API_KEY hoặc EMBEDDING_API_KEY trong Cài đặt hoặc .env — Tự động fallback sang builtin TF-IDF vectorizer.");
      return { provider: "builtin", model: DEFAULT_EMBEDDING_MODEL.builtin, apiKey: "" };
    }
    return { provider: "gemini", model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.gemini, apiKey: geminiKey };
  }
  if (explicit === "custom") {
    if (!customUrl) {
      console.warn("[KnowledgeBase] EMBEDDING_PROVIDER=custom nhưng thiếu CUSTOM_LLM_URL — Tự động fallback sang builtin TF-IDF vectorizer.");
      return { provider: "builtin", model: DEFAULT_EMBEDDING_MODEL.builtin, apiKey: "" };
    }
    return {
      provider: "custom",
      model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.custom,
      apiKey: customKey || "",
      baseUrl: customUrl,
    };
  }

  // Auto-detect — ưu tiên provider chuẩn có sẵn API key
  const activeLlmProvider = dynamic.llmProvider || env.llmProvider;
  if (activeLlmProvider === "openai" && openaiKey) {
    return { provider: "openai", model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.openai, apiKey: openaiKey };
  }
  if (activeLlmProvider === "gemini" && geminiKey) {
    return { provider: "gemini", model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.gemini, apiKey: geminiKey };
  }
  if (geminiKey) {
    return { provider: "gemini", model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.gemini, apiKey: geminiKey };
  }
  if (openaiKey) {
    return { provider: "openai", model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.openai, apiKey: openaiKey };
  }
  if (customUrl) {
    return {
      provider: "custom",
      model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.custom,
      apiKey: customKey || "",
      baseUrl: customUrl,
    };
  }

  // Mặc định an toàn: Built-in local vectorizer
  return { provider: "builtin", model: DEFAULT_EMBEDDING_MODEL.builtin, apiKey: "" };
}

async function embedOpenAiCompatibleBatch(
  url: string,
  headers: Record<string, string>,
  model: string,
  texts: string[],
  label: string
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  // Thử gửi dạng batch mảng input trước
  try {
    const raw = await postJsonWithRetry(
      url,
      headers,
      { model, input: texts.length === 1 ? texts[0] : texts },
      {
        maxRetries: Math.max(2, env.llmMaxRetries),
        baseMs: env.llmRetryBaseMs,
        maxMs: env.llmRetryMaxMs,
        label,
      }
    );

    const data = raw as {
      data?: { index?: number; embedding?: number[] }[];
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };

    if (Array.isArray(data.data) && data.data.length > 0) {
      // Sắp xếp theo index để đảm bảo thứ tự đúng với mảng texts ban đầu
      const sorted = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const totalTokens =
        data.usage?.total_tokens ??
        data.usage?.prompt_tokens ??
        texts.reduce((acc, t) => acc + Math.max(1, Math.ceil(t.length / 4)), 0);
      const tokenPerItem = Math.max(1, Math.round(totalTokens / texts.length));

      return sorted.map((item) => ({
        embedding: item.embedding ?? [],
        tokenCount: tokenPerItem,
        engine: "remote",
      }));
    }
  } catch (err: any) {
    // Nếu lỗi không phải 429 mà do endpoint không hỗ trợ batch mảng (ví dụ 400 Bad Request), thử gọi tuần tự có delay
    if (texts.length > 1 && !String(err?.message || "").includes("429")) {
      const results: EmbeddingResult[] = [];
      for (let i = 0; i < texts.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 500));
        const res = await embedOpenAiCompatibleSingle(url, headers, model, texts[i], label);
        results.push(res);
      }
      return results;
    }
    throw err;
  }

  throw new Error(`${label}: Phản hồi không có dữ liệu embedding hợp lệ`);
}

async function embedOpenAiCompatibleSingle(
  url: string,
  headers: Record<string, string>,
  model: string,
  text: string,
  label: string
): Promise<EmbeddingResult> {
  const raw = await postJsonWithRetry(
    url,
    headers,
    { model, input: text },
    {
      maxRetries: Math.max(2, env.llmMaxRetries),
      baseMs: env.llmRetryBaseMs,
      maxMs: env.llmRetryMaxMs,
      label,
    }
  );
  const data = raw as {
    data?: { embedding?: number[] }[];
    usage?: { prompt_tokens?: number; total_tokens?: number };
  };
  const embedding = data.data?.[0]?.embedding ?? [];
  const tokenCount =
    data.usage?.total_tokens ?? data.usage?.prompt_tokens ?? Math.max(1, Math.ceil(text.length / 4));
  return { embedding, tokenCount, engine: "remote" };
}

async function embedGeminiBatch(
  resolved: ResolvedEmbeddingProvider,
  texts: string[]
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) {
    const single = await embedGeminiSingle(resolved, texts[0]);
    return [single];
  }

  // Thử dùng Gemini batchEmbedContents
  try {
    const modelPath = resolved.model.startsWith("models/") ? resolved.model : `models/${resolved.model}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:batchEmbedContents?key=${resolved.apiKey}`;
    const requests = texts.map((t) => ({
      model: modelPath,
      content: { parts: [{ text: t }] },
    }));

    const raw = await postJsonWithRetry(
      url,
      { "content-type": "application/json" },
      { requests },
      {
        maxRetries: Math.max(2, env.llmMaxRetries),
        baseMs: env.llmRetryBaseMs,
        maxMs: env.llmRetryMaxMs,
        label: `Gemini Batch Embedding (${resolved.model})`,
      }
    );

    const data = raw as { embeddings?: { values?: number[] }[] };
    if (Array.isArray(data.embeddings)) {
      return data.embeddings.map((item, idx) => ({
        embedding: item.values ?? [],
        tokenCount: Math.max(1, Math.ceil(texts[idx].length / 4)),
        engine: "remote",
      }));
    }
  } catch (err: any) {
    if (!String(err?.message || "").includes("429")) {
      // Fallback gọi tuần tự
      const results: EmbeddingResult[] = [];
      for (let i = 0; i < texts.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 500));
        const res = await embedGeminiSingle(resolved, texts[i]);
        results.push(res);
      }
      return results;
    }
    throw err;
  }

  throw new Error(`Gemini: Phản hồi batch embedding không hợp lệ`);
}

async function embedGeminiSingle(
  resolved: ResolvedEmbeddingProvider,
  text: string
): Promise<EmbeddingResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolved.model}:embedContent?key=${resolved.apiKey}`;
  const raw = await postJsonWithRetry(
    url,
    { "content-type": "application/json" },
    { content: { parts: [{ text }] } },
    {
      maxRetries: Math.max(2, env.llmMaxRetries),
      baseMs: env.llmRetryBaseMs,
      maxMs: env.llmRetryMaxMs,
      label: `Gemini Embedding (${resolved.model})`,
    }
  );
  const data = raw as { embedding?: { values?: number[] } };
  const embedding = data.embedding?.values ?? [];
  const tokenCount = Math.max(1, Math.ceil(text.length / 4));
  return { embedding, tokenCount, engine: "remote" };
}

function buildCustomEmbeddingUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/embeddings")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/embeddings`;
  return `${trimmed}/v1/embeddings`;
}

/**
 * Sinh embedding theo nhóm (Batching) cho danh sách các đoạn text.
 * Hỗ trợ tự động fallback sang Built-in Vectorizer nếu remote endpoint gặp lỗi.
 */
export async function generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];
  const resolved = resolveEmbeddingProvider();

  if (resolved.provider === "builtin") {
    return texts.map((t) => ({ ...generateLocalEmbedding(t), engine: "builtin" }));
  }

  try {
    if (resolved.provider === "gemini") {
      return await embedGeminiBatch(resolved, texts);
    }

    if (resolved.provider === "openai") {
      return await embedOpenAiCompatibleBatch(
        "https://api.openai.com/v1/embeddings",
        { "content-type": "application/json", authorization: `Bearer ${resolved.apiKey}` },
        resolved.model,
        texts,
        `OpenAI Embedding (${resolved.model})`
      );
    }

    // custom provider
    const url = buildCustomEmbeddingUrl(resolved.baseUrl!);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (resolved.apiKey) headers["authorization"] = `Bearer ${resolved.apiKey}`;
    return await embedOpenAiCompatibleBatch(
      url,
      headers,
      resolved.model,
      texts,
      `Custom Embedding (${resolved.model} @ ${resolved.baseUrl})`
    );
  } catch (err: any) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(
      `[Embeddings] Remote endpoint ${resolved.provider} (${resolved.model}) không hỗ trợ embeddings hoặc gặp lỗi (${errMsg}). ` +
      "Tự động chuyển sang Built-in Semantic Vectorizer để đảm bảo nạp/tìm kiếm tài liệu hoạt động 100% không bị gián đoạn."
    );
    return texts.map((t) => ({ ...generateLocalEmbedding(t), tokenCount: 0, engine: "builtin" }));
  }
}

/**
 * Sinh embedding cho 1 đoạn text đơn lẻ (dùng cho tìm kiếm ngữ nghĩa hoặc single text).
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const results = await generateEmbeddings([text]);
  return results[0] || { ...generateLocalEmbedding(text), engine: "builtin" };
}

export function isEmbeddingConfigured(): boolean {
  return true; // Luôn luôn sẵn sàng (hỗ trợ cả remote lẫn built-in)
}
