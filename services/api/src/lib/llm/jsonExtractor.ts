/**
 * Tiện ích trích xuất và tự động sửa lỗi cú pháp JSON từ phản hồi LLM.
 *
 * Xử lý:
 * 1. Lời chào/hội thoại mở đầu & kết thúc (Conversational preambles/postambles).
 * 2. Markdown code fences (```json ... ```).
 * 3. Tìm cặp ngoặc ngoài cùng { ... } hoặc [ ... ] theo độ sâu (brace depth tracking).
 * 4. Tự động sửa các lỗi cú pháp phổ biến: trailing commas, smart quotes, comments, unescaped newlines.
 */

/**
 * Chuẩn hóa các lỗi cú pháp nhẹ phổ biến trong JSON do LLM sinh ra.
 */
export function sanitizeJsonString(jsonStr: string): string {
  let cleaned = jsonStr.trim();

  // 1. Thay thế smart quotes bằng chuẩn ASCII
  cleaned = cleaned
    .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'");

  // 2. Loại bỏ comment dạng // hoặc /* ... */
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");
  cleaned = cleaned.replace(/(^|[^\\])\/\/.*$/gm, "$1");

  // 3. Loại bỏ trailing commas trước } hoặc ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");

  return cleaned;
}

/**
 * Quét chuỗi để tìm vị trí bắt đầu và kết thúc của JSON object `{ ... }` ngoài cùng,
 * có tính đến việc bỏ qua các dấu ngoặc nằm trong string literal.
 */
export function findOuterJsonRange(
  text: string,
  openChar: "{" | "[" = "{",
  closeChar: "}" | "]" = "}"
): { start: number; end: number } | null {
  const startIdx = text.indexOf(openChar);
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;
  let actualStart = -1;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openChar) {
      if (depth === 0) {
        actualStart = i;
      }
      depth++;
    } else if (char === closeChar) {
      if (depth > 0) {
        depth--;
        if (depth === 0 && actualStart !== -1) {
          return { start: actualStart, end: i + 1 };
        }
      }
    }
  }

  // Nếu không đóng được hoàn hảo, thử lấy từ startIdx đến dấu closeChar cuối cùng
  const lastCloseIdx = text.lastIndexOf(closeChar);
  if (actualStart !== -1 && lastCloseIdx > actualStart) {
    return { start: actualStart, end: lastCloseIdx + 1 };
  }

  return null;
}

/**
 * Trích xuất chuỗi JSON từ Markdown code block nếu có.
 */
function extractFromCodeFence(text: string): string | null {
  const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1].trim();
  }
  return null;
}

/**
 * Thử parse JSON với nhiều tầng cứu hộ (multi-stage recovery).
 */
export function tryParseJson<T = unknown>(input: string): T | null {
  if (!input || typeof input !== "string") return null;

  // Tầng 1: Thử parse trực tiếp chuỗi nguyên bản
  try {
    return JSON.parse(input) as T;
  } catch {
    // Tiếp tục tầng 2
  }

  // Tầng 2: Sanitize rồi thử parse
  const sanitized = sanitizeJsonString(input);
  try {
    return JSON.parse(sanitized) as T;
  } catch {
    // Tiếp tục tầng 3
  }

  // Tầng 3: Sửa lỗi single quotes thành double quotes cho JSON keys/values nếu cần
  try {
    const doubleQuoted = sanitized
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
      .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
    return JSON.parse(doubleQuoted) as T;
  } catch {
    return null;
  }
}

/**
 * Trích xuất 1 JSON Object (dạng `{ ... }`) từ bất kỳ phản hồi text nào của LLM.
 * Tự động loại bỏ lời chào, văn bản hội thoại xung quanh, code fences.
 */
export function extractJsonObject<T = Record<string, unknown>>(rawText: string): T | null {
  if (!rawText || typeof rawText !== "string") return null;

  // 1. Thử parse trực tiếp nếu là JSON thuần
  const direct = tryParseJson<T>(rawText.trim());
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct;
  }

  // 2. Thử trích xuất từ ```json ... ``` code fence
  const fenceContent = extractFromCodeFence(rawText);
  if (fenceContent) {
    const parsedFence = tryParseJson<T>(fenceContent);
    if (parsedFence && typeof parsedFence === "object" && !Array.isArray(parsedFence)) {
      return parsedFence;
    }
    // Nếu trong code fence vẫn còn text thừa, thử quét range
    const fenceRange = findOuterJsonRange(fenceContent, "{", "}");
    if (fenceRange) {
      const parsedRange = tryParseJson<T>(fenceContent.slice(fenceRange.start, fenceRange.end));
      if (parsedRange && typeof parsedRange === "object" && !Array.isArray(parsedRange)) {
        return parsedRange;
      }
    }
  }

  // 3. Quét tìm khối { ... } ngoài cùng trong toàn bộ text
  const range = findOuterJsonRange(rawText, "{", "}");
  if (range) {
    const snippet = rawText.slice(range.start, range.end);
    const parsedSnippet = tryParseJson<T>(snippet);
    if (parsedSnippet && typeof parsedSnippet === "object" && !Array.isArray(parsedSnippet)) {
      return parsedSnippet;
    }
  }

  return null;
}

/**
 * Trích xuất 1 JSON Array (dạng `[ ... ]`) từ bất kỳ phản hồi text nào của LLM.
 */
export function extractJsonArray<T = unknown>(rawText: string): T[] | null {
  if (!rawText || typeof rawText !== "string") return null;

  const direct = tryParseJson<T[]>(rawText.trim());
  if (Array.isArray(direct)) {
    return direct;
  }

  const fenceContent = extractFromCodeFence(rawText);
  if (fenceContent) {
    const parsedFence = tryParseJson<T[]>(fenceContent);
    if (Array.isArray(parsedFence)) return parsedFence;

    const fenceRange = findOuterJsonRange(fenceContent, "[", "]");
    if (fenceRange) {
      const parsedRange = tryParseJson<T[]>(fenceContent.slice(fenceRange.start, fenceRange.end));
      if (Array.isArray(parsedRange)) return parsedRange;
    }
  }

  const range = findOuterJsonRange(rawText, "[", "]");
  if (range) {
    const snippet = rawText.slice(range.start, range.end);
    const parsedSnippet = tryParseJson<T[]>(snippet);
    if (Array.isArray(parsedSnippet)) {
      return parsedSnippet;
    }
  }

  return null;
}
