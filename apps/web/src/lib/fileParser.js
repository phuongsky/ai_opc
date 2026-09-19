"use strict";
/**
 * Smart file parser for Company Knowledge Base.
 * Supports: .txt, .md, .markdown, .csv, .json, .pdf, .docx, .html, .xml, .yaml, .yml, .log
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatFileSize = formatFileSize;
exports.formatTitleFromFilename = formatTitleFromFilename;
exports.parseCsvToMarkdown = parseCsvToMarkdown;
exports.parseJsonToMarkdown = parseJsonToMarkdown;
exports.parseUploadedFile = parseUploadedFile;
function formatFileSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function formatTitleFromFilename(filename) {
    // Strip extension
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    // Replace underscores, hyphens, multiple dots with spaces
    const cleaned = nameWithoutExt
        .replace(/[_\-.]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    // Capitalize first letter of words
    return cleaned
        .split(" ")
        .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
        .join(" ");
}
/**
 * Parses CSV text into a clean Markdown table
 */
function parseCsvToMarkdown(csvText) {
    const lines = csvText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    if (lines.length === 0)
        return "";
    // Split line handling quotes
    const parseLine = (line) => {
        const values = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                }
                else {
                    inQuotes = !inQuotes;
                }
            }
            else if (char === "," && !inQuotes) {
                values.push(current.trim());
                current = "";
            }
            else {
                current += char;
            }
        }
        values.push(current.trim());
        return values;
    };
    const rows = lines.map(parseLine);
    if (rows.length === 0)
        return "";
    const headers = rows[0];
    const maxCols = Math.max(...rows.map((r) => r.length));
    while (headers.length < maxCols) {
        headers.push(`Column ${headers.length + 1}`);
    }
    const headerRow = `| ${headers.join(" | ")} |`;
    const separatorRow = `| ${headers.map(() => "---").join(" | ")} |`;
    const dataRows = rows.slice(1).map((row) => {
        while (row.length < maxCols)
            row.push("");
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
function parseJsonToMarkdown(jsonText) {
    try {
        const parsed = JSON.parse(jsonText);
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null) {
            // If array of uniform objects, format as list of structured items
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
    }
    catch {
        return jsonText;
    }
}
/**
 * Extracts text from a DOCX (PKZIP archive containing word/document.xml)
 */
async function parseDocxFile(buffer) {
    const bytes = new Uint8Array(buffer);
    let offset = 0;
    // Scan local file headers (0x04034b50)
    while (offset < bytes.length - 30) {
        if (bytes[offset] === 0x50 &&
            bytes[offset + 1] === 0x4b &&
            bytes[offset + 2] === 0x03 &&
            bytes[offset + 3] === 0x04) {
            const compression = bytes[offset + 8] | (bytes[offset + 9] << 8);
            const compressedSize = bytes[offset + 18] |
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
                    }
                    catch {
                        // Fallback to raw bytes scan
                    }
                }
                else if (compression === 0) {
                    xmlText = new TextDecoder("utf-8").decode(compressedData);
                }
                if (xmlText) {
                    return extractTextFromDocxXml(xmlText);
                }
            }
            offset = fileDataEnd > offset ? fileDataEnd : offset + 1;
        }
        else {
            offset++;
        }
    }
    // Fallback: extract string literals
    return fallbackRawTextExtractor(bytes);
}
function extractTextFromDocxXml(xml) {
    // Convert paragraph tags <w:p> to newlines and extract <w:t> content
    const paragraphs = xml.split(/<\/w:p>/);
    const textLines = [];
    for (const p of paragraphs) {
        const textMatches = p.match(/<w:t[^>]*>([^<]+)<\/w:t>/g);
        if (textMatches && textMatches.length > 0) {
            const line = textMatches
                .map((m) => m.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, ""))
                .join("")
                .trim();
            if (line)
                textLines.push(line);
        }
    }
    return textLines.join("\n\n");
}
/**
 * Extracts readable text streams from a PDF file
 */
async function parsePdfFile(buffer) {
    const bytes = new Uint8Array(buffer);
    const rawString = new TextDecoder("latin1").decode(bytes);
    const textBlocks = [];
    // Match /Filter /FlateDecode streams
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match;
    while ((match = streamRegex.exec(rawString)) !== null) {
        const streamContent = match[1];
        if (!streamContent)
            continue;
        const streamStartIndex = match.index + match[0].indexOf(streamContent);
        const streamBytes = bytes.subarray(streamStartIndex, streamStartIndex + streamContent.length);
        let decompressedText = "";
        if (typeof DecompressionStream !== "undefined") {
            try {
                const ds = new DecompressionStream("deflate");
                const writer = ds.writable.getWriter();
                writer.write(streamBytes);
                writer.close();
                const response = new Response(ds.readable);
                decompressedText = await response.text();
            }
            catch {
                // Try raw text
            }
        }
        const textToSearch = decompressedText || streamContent;
        // Extract text from operators: (...) Tj or [(...)] TJ
        const tjMatches = textToSearch.match(/\(([^)]+)\)\s*Tj/g);
        if (tjMatches) {
            const line = tjMatches
                .map((m) => m.replace(/^\(/, "").replace(/\)\s*Tj$/, ""))
                .map(cleanPdfEscapedString)
                .join(" ")
                .trim();
            if (line.length > 3)
                textBlocks.push(line);
        }
        const arrayTjMatches = textToSearch.match(/\[([^\]]+)\]\s*TJ/g);
        if (arrayTjMatches) {
            for (const block of arrayTjMatches) {
                const innerMatches = block.match(/\(([^)]*)\)/g);
                if (innerMatches) {
                    const line = innerMatches
                        .map((s) => s.slice(1, -1))
                        .map(cleanPdfEscapedString)
                        .join("")
                        .trim();
                    if (line.length > 3)
                        textBlocks.push(line);
                }
            }
        }
    }
    if (textBlocks.length > 0) {
        // Remove duplicate consecutive lines and join
        const uniqueLines = textBlocks.filter((line, i) => line !== textBlocks[i - 1]);
        return uniqueLines.join("\n\n");
    }
    // Fallback: extract ASCII/UTF-8 printables
    return fallbackRawTextExtractor(bytes);
}
function cleanPdfEscapedString(str) {
    return str
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\");
}
function fallbackRawTextExtractor(bytes) {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const text = decoder.decode(bytes);
    // Extract long readable chunks
    const chunks = text.match(/[A-Za-z0-9\u00C0-\u1EF9\s.,;:!?'"()\-_/]{20,}/g);
    if (chunks && chunks.length > 0) {
        return chunks.map((c) => c.trim()).filter((c) => c.length > 25).join("\n\n");
    }
    return "";
}
/**
 * Main entrance for parsing any uploaded file
 */
async function parseUploadedFile(file) {
    const fileName = file.name;
    const extension = fileName.includes(".")
        ? fileName.split(".").pop()?.toLowerCase() || ""
        : "";
    const baseTitle = formatTitleFromFilename(fileName);
    const fileSizeFormatted = formatFileSize(file.size);
    const source = `${fileName} (${fileSizeFormatted})`;
    let content = "";
    let warning;
    try {
        if (["txt", "md", "markdown", "log", "yaml", "yml", "xml", "html", "sql", "js", "ts"].includes(extension)) {
            content = await file.text();
        }
        else if (extension === "csv") {
            const rawText = await file.text();
            content = parseCsvToMarkdown(rawText);
        }
        else if (extension === "json") {
            const rawText = await file.text();
            content = parseJsonToMarkdown(rawText);
        }
        else if (extension === "docx") {
            const buffer = await file.arrayBuffer();
            content = await parseDocxFile(buffer);
            if (!content || content.length < 20) {
                warning = "Tệp Word có thể chứa nhiều hình ảnh hoặc định dạng phức tạp. Vui lòng kiểm tra lại nội dung trích xuất.";
            }
        }
        else if (extension === "pdf") {
            const buffer = await file.arrayBuffer();
            content = await parsePdfFile(buffer);
            if (!content || content.length < 20) {
                warning = "Tệp PDF có thể là dạng scan hình ảnh (cần OCR) hoặc được mã hóa. Vui lòng kiểm tra nội dung trích xuất.";
            }
        }
        else {
            // General text attempt
            content = await file.text();
        }
    }
    catch (err) {
        warning = `Lỗi khi đọc file: ${err instanceof Error ? err.message : "Định dạng không hỗ trợ"}`;
    }
    // Clean up content
    content = content.replace(/\u0000/g, "").trim();
    // Try to detect a better title from the first heading of the document if available
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
