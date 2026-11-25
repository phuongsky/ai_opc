/**
 * Retry lỗi transient dùng CHUNG cho cả 4 client (Gemini/OpenAI/Anthropic/CustomLocal).
 *
 * Retry khi: lỗi mạng (status 0), 429 (rate limit), 500/502/503/504, và các mã lỗi Cloudflare 520-524.
 * Hỗ trợ tự động parse SSE stream (data: {...}) nếu local/custom server trả về stream chunks.
 * Tự động làm sạch và bóc tách lỗi HTML (Cloudflare, Nginx...), không bao giờ để rò rỉ mã HTML thô ra ngoài.
 */
import { env } from "../../config/env";

export interface RetryCfg {
  /** Số lần thử lại (không tính lần đầu). */
  maxRetries: number;
  /** Thời gian chờ ban đầu (ms). */
  baseMs: number;
  /** Giới trên thời gian chờ (ms). */
  maxMs: number;
  /** Tên client — chỉ dùng để log dễ đọc. */
  label: string;
  /** Thời gian chờ tối đa cho 1 request HTTP (ms). Mặc định lấy từ env.llmTimeoutMs. */
  timeoutMs?: number;
}

/**
 * Các mã lỗi HTTP có tính chất tạm thời (transient) có thể thử lại:
 * - 429: Rate Limit
 * - 500: Internal Server Error
 * - 502: Bad Gateway
 * - 503: Service Unavailable
 * - 504: Gateway Timeout
 * - 520: Cloudflare Web Server Returns an Unknown Error
 * - 521: Cloudflare Web Server Is Down
 * - 522: Cloudflare Connection Timed Out
 * - 523: Cloudflare Origin Is Unreachable
 * - 524: Cloudflare A Timeout Occurred (quá thời gian chờ của upstream origin)
 */
const RETRYABLE_STATUS = new Set([
  429, 500, 502, 503, 504, 520, 521, 522, 523, 524,
]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface PostResult {
  ok: boolean;
  status: number;
  data?: unknown;
  errText?: string;
  retryAfterSec?: number;
}

export function stripHtmlAndClean(text: string): string {
  return text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#38;/gi, "&")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/\s+/g, " ")
    .trim();
}

export function getStatusFallbackMessage(status?: number): string {
  switch (status) {
    case 524:
      return "Máy chủ AI xử lý quá thời gian chờ (Cloudflare 524: A timeout occurred do server backend AI quá tải hoặc xử lý quá lâu)";
    case 520:
    case 521:
      return "Máy chủ AI đang tạm ngừng hoạt động hoặc không thể kết nối (Cloudflare 520/521: Origin server down)";
    case 522:
      return "Không thể kết nối đến máy chủ AI (Cloudflare 522: Connection timed out)";
    case 523:
      return "Máy chủ AI không thể tiếp cận (Cloudflare 523: Origin is unreachable)";
    case 504:
      return "Cổng kết nối AI quá thời gian chờ (504: Gateway Timeout)";
    case 502:
      return "Cổng kết nối AI phản hồi lỗi (502: Bad Gateway)";
    case 503:
      return "Dịch vụ AI đang tạm thời quá tải hoặc bảo trì (503: Service Unavailable)";
    case 500:
      return "Máy chủ AI gặp lỗi nội bộ (500: Internal Server Error)";
    case 429:
      return "Dịch vụ AI vượt quá hạn mức yêu cầu (429: Too Many Requests / Rate Limit)";
    case 401:
      return "Lỗi xác thực API Key (401: Unauthorized)";
    case 403:
      return "Không có quyền truy cập dịch vụ AI (403: Forbidden)";
    case 404:
      return "Không tìm thấy endpoint hoặc model AI (404: Not Found)";
    default:
      return status ? `API phản hồi mã lỗi HTTP ${status}` : "Lỗi kết nối mạng đến dịch vụ AI";
  }
}

/**
 * Bóc tách và làm sạch nội dung lỗi trả về từ các API bên ngoài hoặc Proxy Gateway.
 * Đặc biệt xử lý các phản hồi trả về HTML (Cloudflare 524, Nginx 502/504, Apache, IIS)
 * hoặc JSON lỗi lồng nhau, đảm bảo KHÔNG BAO GIỜ để rò rỉ mã HTML thô vào log/giao diện người dùng.
 */
export function sanitizeApiErrorMessage(rawText?: string | null, status?: number): string {
  if (!rawText || !rawText.trim()) {
    return getStatusFallbackMessage(status);
  }

  const trimmed = rawText.trim();

  // 1. Nếu là JSON, trích xuất message rõ ràng
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as any;
      const extracted =
        parsed?.error?.message ??
        parsed?.error?.detail ??
        (typeof parsed?.error === "string" ? parsed.error : null) ??
        parsed?.message ??
        parsed?.detail;
      if (typeof extracted === "string" && extracted.trim()) {
        return stripHtmlAndClean(extracted);
      }
    } catch {
      // Bỏ qua lỗi parse JSON, tiếp tục xử lý bên dưới
    }
  }

  // 2. Nếu nội dung chứa HTML (ví dụ Cloudflare 524, 502 Bad Gateway...)
  const isHtml = /<(!doctype|html|head|body|title)/i.test(trimmed);
  if (isHtml) {
    // Trích xuất thẻ <title>...</title>
    const titleMatch = trimmed.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    let titleText = titleMatch ? stripHtmlAndClean(titleMatch[1]) : "";
    if (titleText.toLowerCase().includes("cloudflare")) {
      titleText = titleText.replace(/^cloudflare\s*\|\s*/i, "").replace(/\s*\|\s*cloudflare$/i, "");
    }

    // Trích xuất phần mô tả lỗi phổ biến từ Cloudflare/Nginx
    let descText = "";
    const pMatch =
      trimmed.match(/<p[^>]*class=["'][^"']*leading-relaxed[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) ||
      trimmed.match(/<p[^>]*class=["'][^"']*mb-2[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) ||
      trimmed.match(/<h2[^>]*>What happened\?<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/i);
    if (pMatch) {
      descText = stripHtmlAndClean(pMatch[1]);
    }

    const fallback = getStatusFallbackMessage(status);

    if (descText && titleText) {
      return `${fallback} [${titleText} — ${descText}]`;
    }
    if (titleText) {
      return `${fallback} [${titleText}]`;
    }
    if (descText) {
      return `${fallback} [${descText}]`;
    }
    return fallback;
  }

  // 3. Chuỗi text thông thường: loại bỏ các thẻ HTML nếu có và cắt gọn
  const cleaned = stripHtmlAndClean(trimmed);
  if (cleaned.length > 300) {
    return `${cleaned.slice(0, 300)}...`;
  }
  return cleaned || getStatusFallbackMessage(status);
}

/** Tự động trích xuất số giây cần chờ (retry_after) từ HTTP Header hoặc JSON Body khi gặp lỗi 429 */
function parseRetryAfter(res: Response, rawText: string): number | undefined {
  // 1. Kiểm tra Response Headers tiêu chuẩn
  const headerRetryAfter = res.headers?.get?.("retry-after");
  if (headerRetryAfter) {
    const num = parseFloat(headerRetryAfter);
    if (!isNaN(num) && num > 0) return num;
    const dateParsed = Date.parse(headerRetryAfter);
    if (!isNaN(dateParsed)) {
      const diffSec = (dateParsed - Date.now()) / 1000;
      if (diffSec > 0) return diffSec;
    }
  }

  const headerReset = res.headers?.get?.("x-ratelimit-reset-requests") || res.headers?.get?.("x-ratelimit-reset");
  if (headerReset) {
    const num = parseFloat(headerReset);
    if (!isNaN(num) && num > 0) {
      // Nếu là epoch timestamp tính bằng giây (> 1e9)
      if (num > 1e9) {
        const diffSec = num - Date.now() / 1000;
        if (diffSec > 0) return diffSec;
      } else {
        return num;
      }
    }
  }

  // 2. Kiểm tra JSON Body (ví dụ: {"error":"Rate limit exceeded","retry_after":60})
  try {
    const parsed = JSON.parse(rawText) as any;
    const candidate =
      parsed?.retry_after ??
      parsed?.retryAfter ??
      parsed?.error?.retry_after ??
      parsed?.error?.retryAfter;
    if (typeof candidate === "number" && candidate > 0) {
      return candidate;
    }
    if (typeof candidate === "string") {
      const num = parseFloat(candidate);
      if (!isNaN(num) && num > 0) return num;
    }
  } catch {
    // Không phải JSON
  }

  // 3. Quét regex trong text cho trường hợp trả về message tự do
  const matchJsonField = rawText.match(/(?:retry_after|retryAfter)["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i);
  if (matchJsonField && matchJsonField[1]) {
    const num = parseFloat(matchJsonField[1]);
    if (!isNaN(num) && num > 0) return num;
  }

  const matchMsg = rawText.match(/(?:try again in|wait|retry after)\s*(\d+(?:\.\d+)?)\s*(?:s|sec|second|seconds|giây)/i);
  if (matchMsg && matchMsg[1]) {
    const num = parseFloat(matchMsg[1]);
    if (!isNaN(num) && num > 0) return num;
  }

  return undefined;
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

/** Gọi 1 lần POST JSON (không retry) với cơ chế timeout an toàn bằng AbortController. */
async function postOnce(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number
): Promise<PostResult> {
  let res: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    const isAbort = err?.name === "AbortError";
    const msg = isAbort
      ? `Thời gian chờ máy chủ AI vượt quá ${Math.round(timeoutMs / 1000)}s (Request Timeout)`
      : (err instanceof Error ? err.message : String(err));
    return { ok: false, status: 0, errText: `network: ${msg}` };
  } finally {
    clearTimeout(timer);
  }

  const rawText = await res.text();

  if (!res.ok) {
    const retryAfterSec = parseRetryAfter(res, rawText);
    const cleanErr = sanitizeApiErrorMessage(rawText, res.status);
    return { ok: false, status: res.status, errText: cleanErr, retryAfterSec };
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
    const cleanErr = sanitizeApiErrorMessage(rawText, res.status);
    return {
      ok: false,
      status: res.status,
      errText: `Không thể parse JSON từ phản hồi: ${cleanErr.slice(0, 200)}`,
    };
  }
}

/**
 * POST JSON với retry automatic. Trả về body đã parse-json khi thành công,
 * throw Error khi lỗi không recoverable (hết lượt retry hoặc lỗi 4xx không transient).
 */
export async function postJsonWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  cfg: RetryCfg
): Promise<unknown> {
  let lastErr = "";
  const timeoutMs = cfg.timeoutMs ?? env.llmTimeoutMs;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const result = await postOnce(url, headers, body, timeoutMs);

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

    let waitMs: number;
    if (result.retryAfterSec && result.retryAfterSec > 0) {
      const retrySec = result.retryAfterSec;
      waitMs = retrySec * 1000 + 500 + Math.random() * 500;
      // eslint-disable-next-line no-console
      console.warn(
        `[llm:${cfg.label}] 429 Rate Limit — API yêu cầu chờ ${retrySec}s (retry_after). Đang tạm dừng ${Math.round(
          waitMs / 1000
        )}s và thử lại (${attempt + 1}/${cfg.maxRetries})...`
      );
    } else {
      const base = Math.min(cfg.maxMs, cfg.baseMs * Math.pow(2, attempt));
      const jitter = Math.random() * base * 0.3;
      // Nếu là lỗi 429 nhưng không có retry_after cụ thể, chờ tối thiểu 2000ms
      const minDelay = result.status === 429 ? 2000 : 0;
      waitMs = Math.max(minDelay, base) + jitter;
      // eslint-disable-next-line no-console
      console.warn(
        `[llm:${cfg.label}] ${result.status || "network"} — thử lại ${
          attempt + 1
        }/${cfg.maxRetries} sau ${Math.round(waitMs)}ms`
      );
    }
    await sleep(waitMs);
  }

  // Không tới đây (loop đã return/throw), nhưng TypeScript cần.
  throw new Error(lastErr || `${cfg.label} API lỗi không xác định`);
}
