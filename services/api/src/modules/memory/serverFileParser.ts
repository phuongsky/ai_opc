import mammoth from "mammoth";
import * as XLSX from "xlsx";
import {
  parseCsvToMarkdown,
  parseJsonToMarkdown,
  formatTitleFromFilename,
  formatFileSize,
  type ParsedFileResult,
} from "@ai-opc/shared";

/**
 * Cleans and sanitizes extracted text to remove all binary garbage, replacement characters, and control codes.
 */
export function sanitizeExtractedText(raw: string): string {
  if (!raw) return "";

  // 1. Remove unicode replacement characters and null bytes
  let text = raw.replace(/[\uFFFD\u0000]/g, "");

  // 2. Remove control characters except standard whitespace (\n, \r, \t)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // 3. Remove PDF page indicator artifacts like '-- 1 of 1 --'
  text = text.replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "");

  // 4. Normalize newlines and collapse multiple blank lines
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
  // Count readable characters (letters, numbers, common Vietnamese diacritics, punctuation, spaces)
  const readableChars = clean.match(/[a-zA-Z0-9\u00C0-\u1EF9\s.,;:\-—–_!?'"()\[\]{}@#$%&*+/=<>|\\~`]/g);
  const readableCount = readableChars ? readableChars.length : 0;
  return readableCount / clean.length >= 0.75;
}

/**
 * Safely extracts text from binary legacy Word 97-2003 (.doc) files
 */
function parseLegacyDocBuffer(buffer: Buffer): string {
  const strings: string[] = [];

  // Try UTF-16LE chunks (common in WordDocument stream)
  const u16 = buffer.toString("utf16le");
  const u16Matches = u16.match(/[a-zA-Z0-9\u00C0-\u1EF9\s.,;:\-!?'"()]{15,}/g);
  if (u16Matches) {
    for (const m of u16Matches) {
      if (isLegitimateText(m)) strings.push(m.trim());
    }
  }

  // Try UTF-8 / ASCII chunks
  const u8 = buffer.toString("utf-8");
  const u8Matches = u8.match(/[a-zA-Z0-9\u00C0-\u1EF9\s.,;:\-!?'"()]{15,}/g);
  if (u8Matches) {
    for (const m of u8Matches) {
      if (isLegitimateText(m) && !strings.includes(m.trim())) {
        strings.push(m.trim());
      }
    }
  }

  return strings.join("\n\n");
}

/**
 * Server-side high fidelity file parser
 */
export async function parseFileBuffer(
  fileName: string,
  buffer: Buffer
): Promise<ParsedFileResult> {
  const extension = fileName.includes(".")
    ? fileName.split(".").pop()?.toLowerCase() || ""
    : "";
  const baseTitle = formatTitleFromFilename(fileName);
  const fileSizeFormatted = formatFileSize(buffer.length);
  const source = `${fileName} (${fileSizeFormatted})`;

  let content = "";
  let warning: string | undefined;

  try {
    if (extension === "pdf") {
      try {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: buffer });
        const res = await parser.getText();
        content = sanitizeExtractedText(res.text || "");
        if (!content || content.length < 10) {
          warning = "Tệp PDF không chứa lớp văn bản (có thể là file scan hình ảnh).";
        }
      } catch (pdfErr) {
        warning = `Lỗi đọc cấu trúc PDF: ${pdfErr instanceof Error ? pdfErr.message : "Định dạng không hợp lệ"}`;
      }
    } else if (extension === "docx") {
      try {
        const res = await mammoth.extractRawText({ buffer });
        content = sanitizeExtractedText(res.value || "");
        if (res.messages && res.messages.length > 0) {
          const warnings = res.messages.filter((m: { type: string; message: string }) => m.type === "warning");
          if (warnings.length > 0 && !content) {
            warning = warnings.map((w: { message: string }) => w.message).join("; ");
          }
        }
      } catch (docxErr) {
        warning = `Lỗi đọc tài liệu Word: ${docxErr instanceof Error ? docxErr.message : "Không thể đọc tệp"}`;
      }
    } else if (extension === "doc") {
      content = sanitizeExtractedText(parseLegacyDocBuffer(buffer));
      if (!content) {
        warning = "Tệp .doc (Word 97-2003) cũ. Khuyên dùng định dạng .docx hoặc .pdf để trích xuất đầy đủ nhất.";
      }
    } else if (extension === "xlsx" || extension === "xls") {
      try {
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const sheetSections: string[] = [];
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          if (sheet) {
            const csv = XLSX.utils.sheet_to_csv(sheet);
            if (csv.trim()) {
              const formattedTable = parseCsvToMarkdown(csv);
              sheetSections.push(`## Trang tính: ${sheetName}\n\n` + formattedTable);
            }
          }
        }
        content = sheetSections.join("\n\n");
      } catch (excelErr) {
        warning = `Lỗi đọc file Excel: ${excelErr instanceof Error ? excelErr.message : "Không thể đọc bảng tính"}`;
      }
    } else if (extension === "csv") {
      const rawCsv = buffer.toString("utf-8");
      content = parseCsvToMarkdown(rawCsv);
    } else if (extension === "json") {
      const rawJson = buffer.toString("utf-8");
      content = parseJsonToMarkdown(rawJson);
    } else {
      // Default plain text (.txt, .md, .log, .yaml, .xml, .html)
      content = sanitizeExtractedText(buffer.toString("utf-8"));
    }
  } catch (err) {
    warning = `Lỗi phân tích tệp: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Final sanity check: if the extracted content is not legitimate text (garbage characters), discard it
  if (content && !isLegitimateText(content)) {
    content = "";
    warning = "Tệp chứa dữ liệu nhị phân không thể giải mã thành văn bản rõ ràng.";
  }

  // Auto-detect title from document heading if available
  let title = baseTitle;
  if (content) {
    const firstLines = content.split("\n").slice(0, 5);
    for (const line of firstLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("# ") && trimmed.length > 3 && trimmed.length < 120) {
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
