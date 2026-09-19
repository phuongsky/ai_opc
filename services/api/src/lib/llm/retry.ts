/**
 * Retry lỗi transient dùng CHUNG cho cả 4 client (Gemini/OpenAI/Anthropic/CustomLocal).
 *
 * Retry khi: lỗi mạng (status 0), 429 (rate limit), 500/502/503/504.
 * Hỗ trợ tự động parse SSE stream (data: {...}) nếu local/custom server trả về stream chunks.
 */

export interface RetryCfg {
  /** Số lần thử lại (không tính lần đầu). */
  maxRetries: number;
  /** Thời gian chờ ban đầu (ms). */
  baseMs: number;
  /** Giới trên thời gian chờ (ms). */
  maxMs: number;
  /** Tên client — chỉ dùng để log dễ đọc. */
  label: string;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface PostResult {
  ok: boolean;
  status: number;
  data?: unknown;
  errText?: string;
}

/** Tự động parse SSE chunks (data: {...}) thành payload chat completion tiêu chuẩn */
function tryParseSseStream(rawText: string): unknown | null {
  if (!rawText.includes("data: ")) return null;
  try {
    const lines = rawText.split("\n");
    let fullContent = "";
    let promptTokens = 0;
    let completionTokens = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payloadStr = line.replace(/^data:\s*/, "").trim();
      if (!payloadStr || payloadStr === "[DONE]") continue;

      const parsed = JSON.parse(payloadStr) as {
        choices?: { delta?: { content?: string }; text?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const delta = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.text || "";
      fullContent += delta;
      if (parsed.usage) {
        promptTokens = parsed.usage.prompt_tokens || promptTokens;
        completionTokens = parsed.usage.completion_tokens || completionTokens;
      }
    }

    if (fullContent.length > 0) {
      return {
        choices: [{ message: { content: fullContent } }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
      };
    }
  } catch {
    // Không parse được theo SSE, trả về null
  }
  return null;
}

/** Gọi 1 lần POST JSON (không retry). */
async function postOnce(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, errText: `network: ${msg}` };
  }

  const rawText = await res.text();

  if (!res.ok) {
    return { ok: false, status: res.status, errText: rawText };
  }

  // 1. Thử parse JSON thông thường
  try {
    const data: unknown = JSON.parse(rawText);
    return { ok: true, status: res.status, data };
  } catch {
    // 2. Thử parse nếu là SSE stream (data: {...})
    const sseData = tryParseSseStream(rawText);
    if (sseData) {
      return { ok: true, status: res.status, data: sseData };
    }
    return {
      ok: false,
      status: res.status,
      errText: `Không thể parse JSON từ phản hồi: ${rawText.slice(0, 300)}`,
    };
  }
}

/**
 * POST JSON với retry automatic. Trả về body đã parse-json khi thành công,
 * throw Error khi lỗi không recoverable (hết lượt retry hoặc lỗi 4xx).
 */
export async function postJsonWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  cfg: RetryCfg
): Promise<unknown> {
  let lastErr = "";

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const result = await postOnce(url, headers, body);

    if (result.ok) {
      return result.data;
    }

    lastErr = `${cfg.label} API lỗi (${result.status || "network"}): ${
      result.errText ?? ""
    }`;

    const isTransient =
      result.status === 0 || RETRYABLE_STATUS.has(result.status);
    if (!isTransient || attempt === cfg.maxRetries) {
      throw new Error(lastErr);
    }

    const base = Math.min(cfg.maxMs, cfg.baseMs * Math.pow(2, attempt));
    const jitter = Math.random() * base * 0.3;
    const waitMs = base + jitter;
    // eslint-disable-next-line no-console
    console.warn(
      `[llm:${cfg.label}] ${result.status || "network"} — thử lại ${
        attempt + 1
      }/${cfg.maxRetries} sau ${Math.round(waitMs)}ms`
    );
    await sleep(waitMs);
  }

  // Không tới đây (loop đã return/throw), nhưng TypeScript cần.
  throw new Error(lastErr || `${cfg.label} API lỗi không xác định`);
}
