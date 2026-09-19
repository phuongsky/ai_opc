/**
 * Smart file parser for Company Knowledge Base.
 * Supports: .txt, .md, .markdown, .csv, .json, .pdf, .docx, .doc, .xlsx, .xls, .html, .xml, .yaml, .yml, .log
 */

export interface ParsedFileResult {
  title: string;
  source: string;
  content: string;
  fileType: string;
  fileSizeFormatted: string;
  characterCount: number;
  wordCount: number;
  warning?: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatTitleFromFilename(filename: string): string {
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
  const cleaned = nameWithoutExt
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .split(" ")
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

/**
 * Converts ArrayBuffer to Base64 in browser or Node.js environment
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buffer).toString("base64");
  }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa !== "undefined" ? btoa(binary) : "";
}

/**
 * Cleans extracted text to remove all binary garbage, replacement characters, and control codes.
 */
export function sanitizeExtractedText(raw: string): string {
  if (!raw) return "";

  // Remove replacement character and nulls
  let text = raw.replace(/[\uFFFD\u0000]/g, "");

  // Remove control characters except tab and newline
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Remove common PDF page artifacts
  text = text.replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "");

  // Normalize line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/**
 * Checks if a string contains genuine human-readable text vs binary noise
 */
export function isLegitimateText(text: string): boolean {
  if (!text || text.trim().length < 5) return false;
  const clean = text.trim();
  const readableChars = clean.match(/[a-zA-Z0-9\u00C0-\u1EF9\s.,;:\-—–_!?'"()\[\]{}@#$%&*+/=<>|\\~`]/g);
  const readableCount = readableChars ? readableChars.length : 0;
  return readableCount / clean.length >= 0.75;
}

/**
 * Parses CSV text into a clean Markdown table
 */
export function parseCsvToMarkdown(csvText: string): string {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return "";

  const parseLine = (line: string): string[] => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };

  const rows = lines.map(parseLine);
  if (rows.length === 0) return "";

  const headers = rows[0];
  const maxCols = Math.max(...rows.map((r) => r.length));
  while (headers.length < maxCols) {
    headers.push(`Column ${headers.length + 1}`);
  }

  const headerRow = `| ${headers.join(" | ")} |`;
  const separatorRow = `| ${headers.map(() => "---").join(" | ")} |`;
  const dataRows = rows.slice(1).map((row) => {
    while (row.length < maxCols) row.push("");
    return `| ${row.map((val) => val.replace(/\|/g, "\\|")).join(" | ")} |`;
  });

  return [
    `# Bảng dữ liệu trích xuất (${rows.length - 1} dòng)`,
    "",
    headerRow,
    separatorRow,
    ...dataRows,
  ].join("\n");
}

/**
 * Formats JSON into human & LLM friendly Markdown
 */
export function parseJsonToMarkdown(jsonText: string): string {
  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null) {
      const items = parsed.map((item, idx) => {
        const props = Object.entries(item)
          .map(([k, v]) => `  - **${k}**: ${typeof v === "object" ? JSON.stringify(v) : v}`)
          .join("\n");
        return `### Mục #${idx + 1}\n${props}`;
      });
      return `# Danh sách đối tượng trích xuất (${parsed.length} mục)\n\n` + items.join("\n\n");
    }

    if (typeof parsed === "object" && parsed !== null) {
      const sections = Object.entries(parsed).map(([k, v]) => {
        if (typeof v === "object" && v !== null) {
          return `## ${k}\n\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\``;
        }
        return `- **${k}**: ${v}`;
      });
      return `# Cấu hình & Dữ liệu JSON\n\n` + sections.join("\n\n");
    }

    return jsonText;
  } catch {
    return jsonText;
  }
}

/**
 * Extracts text from DOCX (PKZIP containing word/document.xml) in client
 */
export async function parseDocxBufferClient(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  while (offset < bytes.length - 30) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x03 &&
      bytes[offset + 3] === 0x04
    ) {
      const compression = bytes[offset + 8] | (bytes[offset + 9] << 8);
      const compressedSize =
        bytes[offset + 18] |
        (bytes[offset + 19] << 8) |
        (bytes[offset + 20] << 16) |
        (bytes[offset + 21] << 24);
      const fileNameLen = bytes[offset + 26] | (bytes[offset + 27] << 8);
      const extraFieldLen = bytes[offset + 28] | (bytes[offset + 29] << 8);

      const fileNameBytes = bytes.subarray(offset + 30, offset + 30 + fileNameLen);
      const fileName = new TextDecoder("utf-8").decode(fileNameBytes);

      const fileDataStart = offset + 30 + fileNameLen + extraFieldLen;
      const fileDataEnd = fileDataStart + compressedSize;

      if (fileName === "word/document.xml" && fileDataEnd <= bytes.length) {
        let xmlText = "";
        const compressedData = bytes.subarray(fileDataStart, fileDataEnd);

        if (compression === 8 && typeof DecompressionStream !== "undefined") {
          try {
            const ds = new DecompressionStream("deflate-raw");
            const writer = ds.writable.getWriter();
            writer.write(compressedData);
            writer.close();
            const response = new Response(ds.readable);
            xmlText = await response.text();
          } catch {
            // Continue
          }
        } else if (compression === 0) {
          xmlText = new TextDecoder("utf-8").decode(compressedData);
        }

        if (xmlText) {
          const paragraphs = xmlText.split(/<\/w:p>/);
          const textLines: string[] = [];
          for (const p of paragraphs) {
            const textMatches = p.match(/<w:t[^>]*>([^<]+)<\/w:t>/g);
            if (textMatches && textMatches.length > 0) {
              const line = textMatches
                .map((m) => m.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, ""))
                .join("")
                .trim();
              if (line) textLines.push(line);
            }
          }
          return sanitizeExtractedText(textLines.join("\n\n"));
        }
      }

      offset = fileDataEnd > offset ? fileDataEnd : offset + 1;
    } else {
      offset++;
    }
  }

  return "";
}

/**
 * Client-side parser entry with strict validation to prevent dumping binary garbage
 */
export async function parseUploadedFileClient(file: File): Promise<ParsedFileResult> {
  const fileName = file.name;
  const extension = fileName.includes(".")
    ? fileName.split(".").pop()?.toLowerCase() || ""
    : "";
  const baseTitle = formatTitleFromFilename(fileName);
  const fileSizeFormatted = formatFileSize(file.size);
  const source = `${fileName} (${fileSizeFormatted})`;

  let content = "";
  let warning: string | undefined;

  try {
    if (["txt", "md", "markdown", "log", "yaml", "yml", "xml", "html", "sql", "js", "ts"].includes(extension)) {
      content = sanitizeExtractedText(await file.text());
    } else if (extension === "csv") {
      const rawText = await file.text();
      content = parseCsvToMarkdown(rawText);
    } else if (extension === "json") {
      const rawText = await file.text();
      content = parseJsonToMarkdown(rawText);
    } else if (extension === "docx") {
      const buffer = await file.arrayBuffer();
      content = await parseDocxBufferClient(buffer);
      if (!content || content.length < 20) {
        warning = "Đang kết nối parser nâng cao để đọc đầy đủ tài liệu Word...";
      }
    } else {
      // General attempt
      const text = await file.text();
      if (isLegitimateText(text)) {
        content = sanitizeExtractedText(text);
      } else {
        warning = "Tệp ở định dạng nhị phân. Hệ thống đang chuyển tiếp qua máy chủ phân tích tài liệu.";
      }
    }
  } catch (err) {
    warning = `Lỗi đọc tệp: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Ensure binary junk is discarded
  if (content && !isLegitimateText(content)) {
    content = "";
    warning = "Không thể trích xuất văn bản hợp lệ từ tệp nhị phân.";
  }

  let title = baseTitle;
  if (content) {
    const firstLines = content.split("\n").slice(0, 5);
    for (const line of firstLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("# ") && trimmed.length > 3 && trimmed.length < 100) {
        title = trimmed.replace(/^#+\s*/, "").trim();
        break;
      }
    }
  }

  const characterCount = content.length;
  const wordCount = content.trim().length > 0 ? content.trim().split(/\s+/).length : 0;

  return {
    title,
    source,
    content,
    fileType: extension ? `.${extension.toUpperCase()}` : "FILE",
    fileSizeFormatted,
    characterCount,
    wordCount,
    warning,
  };
}
