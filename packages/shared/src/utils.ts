/**
 * Trích xuất và định dạng nội dung Kết quả bàn giao (Agent Output/Deliverable).
 * - Nếu kết quả được bọc trong JSON (ví dụ: {"action":"NONE","note":"# SOP..."}),
 *   chỉ trích xuất giá trị trường `note` (hoặc `resultSummary`/`message` nếu không có `note`).
 * - Xử lý thông minh mọi định dạng: JSON có/không có ngoặc nhọn ngoài, chuỗi prefix log, markdown block.
 * - Tự động chuyển đổi các ký tự escaped `\n`, `\r\n`, `\t`, `\"` thành ký tự hiển thị thực tế.
 */
export function cleanDeliverableText(raw?: string | null): string {
  if (!raw) return "";
  let text = String(raw).trim();

  // 1. Gỡ bỏ vỏ bọc Markdown code block như ```json ... ``` hoặc ``` ... ```
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\r?\n?/, "").replace(/```$/, "").trim();
  }

  // 2. Cắt bỏ tiền tố log (ví dụ: 'Agent "agent_sales" hoàn tất...: {...}')
  const colonBraceIdx = text.indexOf(": {");
  if (colonBraceIdx !== -1 && text.includes("}")) {
    const candidate = text.slice(colonBraceIdx + 2).trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      text = candidate;
    }
  }

  // 3. Thử phân tích cú pháp JSON linh hoạt (trực tiếp hoặc tự bọc ngoặc)
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      // Trường hợp chuỗi JSON thiếu cặp ngoặc ngoài nhưng có chứa "note"
      if (!text.startsWith("{") && text.includes('"note"')) {
        const candidate = "{" + text.replace(/,?\s*$/, "") + "}";
        parsed = JSON.parse(candidate);
      }
    } catch {
      // Tìm cặp ngoặc { ... } bên trong chuỗi nếu có
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
        } catch {}
      }
    }
  }

  if (parsed && typeof parsed === "object" && parsed !== null) {
    if (typeof parsed.note === "string" && parsed.note.trim()) {
      text = parsed.note;
    } else if (typeof parsed.resultSummary === "string" && parsed.resultSummary.trim()) {
      text = parsed.resultSummary;
    } else if (typeof parsed.message === "string" && parsed.message.trim()) {
      text = parsed.message;
    }
  } else {
    // 4. Regex & Substring Fallback trích xuất "note": "..."
    const noteMatch = text.match(/"note"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    if (noteMatch && noteMatch[1]) {
      try {
        text = JSON.parse('"' + noteMatch[1] + '"');
      } catch {
        text = noteMatch[1];
      }
    } else {
      // Fallback nếu "action": ... và "note": ... tồn tại trong chuỗi thô
      const noteIdx = text.indexOf('"note":');
      if (noteIdx !== -1) {
        let sub = text.slice(noteIdx + 7).trim();
        if (sub.startsWith('"')) sub = sub.slice(1);
        if (sub.endsWith('"}')) sub = sub.slice(0, -2);
        else if (sub.endsWith('}')) sub = sub.slice(0, -1);
        if (sub.endsWith('"')) sub = sub.slice(0, -1);
        text = sub;
      }
    }
  }

  // 5. Unescape literal \n, \r\n, \t, \" thành ký tự thực tế
  if (text.includes("\\n")) {
    text = text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
  }
  if (text.includes("\\t")) {
    text = text.replace(/\\t/g, "\t");
  }
  if (text.includes('\\"')) {
    text = text.replace(/\\"/g, '"');
  }

  // 6. Gỡ bỏ dấu ngoặc kép bọc ngoài nếu chuỗi bị double-stringified
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      const unquoted = JSON.parse(text);
      if (typeof unquoted === "string") text = unquoted;
    } catch {
      text = text.slice(1, -1);
    }
  }

  return text.trim();
}

