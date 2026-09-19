function cleanDeliverableText(raw) {
  if (!raw) return "";
  let text = String(raw).trim();

  // 1. Strip markdown code block wrappers like ```json ... ```
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }

  // 2. If text has a prefix like 'Agent "agent_sales" hoàn tất...: {...}'
  const colonBraceIdx = text.indexOf(": {");
  if (colonBraceIdx !== -1 && text.includes("}")) {
    const candidate = text.slice(colonBraceIdx + 2).trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      text = candidate;
    }
  }

  // 3. Try parsing JSON (direct or wrapped with braces)
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      if (!text.startsWith("{") && text.includes('"note"')) {
        parsed = JSON.parse("{" + text.replace(/,?$/, "") + "}");
      }
    } catch {
      // Find { ... } within text
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
    // 4. Regex fallback to extract "note": "..."
    const noteMatch = text.match(/"note"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (noteMatch && noteMatch[1]) {
      try {
        text = JSON.parse('"' + noteMatch[1] + '"');
      } catch {
        text = noteMatch[1];
      }
    } else {
      // Fallback if "action": ... and "note": ... exist in plain text
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

  // 5. Unescape literal \n, \r\n, \t, \"
  if (text.includes("\\n")) {
    text = text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
  }
  if (text.includes("\\t")) {
    text = text.replace(/\\t/g, "\t");
  }
  if (text.includes('\\"')) {
    text = text.replace(/\\"/g, '"');
  }

  // 6. If somehow the text is still wrapped with an outer quote or escaped quotes
  if (text.startsWith('"') && text.endsWith('"') && text.length > 2) {
    try {
      const unquoted = JSON.parse(text);
      if (typeof unquoted === "string") text = unquoted;
    } catch {
      text = text.slice(1, -1);
    }
  }

  return text.trim();
}

// Test cases
const test1 = '{\n  "action": "NONE",\n  "toolId": "",\n  "params": {},\n  "note": "# TÀI LIỆU SOP BÁN HÀNG\\n\\n---\\n\\n## I. QUY TRÌNH"\n}';
const test2 = '  "action": "NONE",\n  "toolId": "",\n  "params": {},\n  "note": "# TÀI LIỆU SOP BÁN HÀNG\\n\\n---\\n\\n## I. QUY TRÌNH"';
const test3 = 'Agent "agent_sales" hoàn tất các bước. Chuyển sang chờ founder đánh giá nội bộ: {\n  "action": "NONE",\n  "toolId": "",\n  "params": {},\n  "note": "# TÀI LIỆU SOP BÁN HÀNG\\n\\n---\\n\\n## I. QUY TRÌNH"\n}';
const test4 = '{\n  "action": "NONE",\n  "note": "Kịch bản bán phòng khách sạn\\nBước 1: Chào khách\\nBước 2: Báo giá"\n}';

console.log("=== TEST 1 ===");
console.log(cleanDeliverableText(test1));

console.log("=== TEST 2 ===");
console.log(cleanDeliverableText(test2));

console.log("=== TEST 3 ===");
console.log(cleanDeliverableText(test3));

console.log("=== TEST 4 ===");
console.log(cleanDeliverableText(test4));
