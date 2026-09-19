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

export type EmbeddingProvider = "openai" | "gemini" | "custom" | "builtin";

export interface EmbeddingResult {
  embedding: number[];
  /** Số token dùng để tính chi phí — ước lượng nếu provider không trả usage thật. */
  tokenCount: number;
  engine?: "remote" | "builtin";
}

const DEFAULT_EMBEDDING_MODEL: Record<EmbeddingProvider, string> = {
  openai: "text-embedding-3-small",
  gemini: "text-embedding-004",
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
  const explicit = env.embeddingProvider;

  if (explicit === "builtin") {
    return { provider: "builtin", model: DEFAULT_EMBEDDING_MODEL.builtin, apiKey: "" };
  }
  if (explicit === "openai") {
    const key = env.embeddingApiKey || env.openaiApiKey;
    if (!key) throw new Error("EMBEDDING_PROVIDER=openai nhưng thiếu OPENAI_API_KEY hoặc EMBEDDING_API_KEY trong .env");
    return { provider: "openai", model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.openai, apiKey: key };
  }
  if (explicit === "gemini") {
    const key = env.embeddingApiKey || env.geminiApiKey;
    if (!key) throw new Error("EMBEDDING_PROVIDER=gemini nhưng thiếu GEMINI_API_KEY hoặc EMBEDDING_API_KEY trong .env");
    return { provider: "gemini", model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.gemini, apiKey: key };
  }
  if (explicit === "custom") {
    const url = env.embeddingBaseUrl || env.customLlmUrl;
    if (!url) throw new Error("EMBEDDING_PROVIDER=custom nhưng thiếu CUSTOM_LLM_URL hoặc EMBEDDING_BASE_URL trong .env");
    return {
      provider: "custom",
      model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.custom,
      apiKey: env.embeddingApiKey || env.customLlmApiKey,
      baseUrl: url,
    };
  }

  // Auto-detect — ưu tiên theo LLM_PROVIDER đang dùng
  if (env.llmProvider === "openai" && env.openaiApiKey) {
    return { provider: "openai", model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.openai, apiKey: env.openaiApiKey };
  }
  if (env.llmProvider === "gemini" && env.geminiApiKey) {
    return { provider: "gemini", model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.gemini, apiKey: env.geminiApiKey };
  }
  if (env.llmProvider === "custom" && env.customLlmUrl) {
    return {
      provider: "custom",
      model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.custom,
      apiKey: env.customLlmApiKey,
      baseUrl: env.customLlmUrl,
    };
  }

  // Fallback nếu có key riêng
  if (env.openaiApiKey) {
    return { provider: "openai", model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.openai, apiKey: env.openaiApiKey };
  }
  if (env.geminiApiKey) {
    return { provider: "gemini", model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.gemini, apiKey: env.geminiApiKey };
  }
  if (env.customLlmUrl) {
    return {
      provider: "custom",
      model: env.embeddingModel || DEFAULT_EMBEDDING_MODEL.custom,
      apiKey: env.customLlmApiKey,
      baseUrl: env.customLlmUrl,
    };
  }

  // Mặc định an toàn: Built-in local vectorizer
  return { provider: "builtin", model: DEFAULT_EMBEDDING_MODEL.builtin, apiKey: "" };
}

async function embedOpenAiCompatible(
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
      maxRetries: env.llmMaxRetries,
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

async function embedGemini(resolved: ResolvedEmbeddingProvider, text: string): Promise<EmbeddingResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolved.model}:embedContent?key=${resolved.apiKey}`;
  const raw = await postJsonWithRetry(
    url,
    { "content-type": "application/json" },
    { content: { parts: [{ text }] } },
    {
      maxRetries: env.llmMaxRetries,
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

export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const resolved = resolveEmbeddingProvider();

  if (resolved.provider === "builtin") {
    const local = generateLocalEmbedding(text);
    return { ...local, engine: "builtin" };
  }

  try {
    if (resolved.provider === "gemini") {
      return await embedGemini(resolved, text);
    }

    if (resolved.provider === "openai") {
      return await embedOpenAiCompatible(
        "https://api.openai.com/v1/embeddings",
        { "content-type": "application/json", authorization: `Bearer ${resolved.apiKey}` },
        resolved.model,
        text,
        `OpenAI Embedding (${resolved.model})`
      );
    }

    // custom provider
    const url = buildCustomEmbeddingUrl(resolved.baseUrl!);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (resolved.apiKey) headers["authorization"] = `Bearer ${resolved.apiKey}`;
    return await embedOpenAiCompatible(
      url,
      headers,
      resolved.model,
      text,
      `Custom Embedding (${resolved.model} @ ${resolved.baseUrl})`
    );
  } catch (err: any) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(
      `[Embeddings] Remote endpoint ${resolved.provider} (${resolved.model}) không hỗ trợ embeddings hoặc gặp lỗi (${errMsg}). ` +
        "Tự động chuyển sang Built-in Semantic Vectorizer để đảm bảo nạp/tìm kiếm tài liệu hoạt động 100% không bị gián đoạn."
    );
    const local = generateLocalEmbedding(text);
    return { ...local, tokenCount: 0, engine: "builtin" };
  }
}

export function isEmbeddingConfigured(): boolean {
  return true; // Luôn luôn sẵn sàng (hỗ trợ cả remote lẫn built-in)
}
