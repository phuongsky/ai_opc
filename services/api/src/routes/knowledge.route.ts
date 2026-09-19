import { Router } from "express";
import {
  ingestDocument,
  listDocuments,
  deleteDocument,
  searchKnowledge,
} from "../modules/memory/knowledgeBase";
import { parseFileBuffer } from "../modules/memory/serverFileParser";

export const knowledgeRouter = Router();

/** Danh sách tài liệu đã nạp vào Knowledge Base. */
knowledgeRouter.get("/", async (_req, res) => {
  const docs = await listDocuments();
  res.json(docs);
});

/** Phân tích file tải lên (PDF, DOCX, XLSX, CSV, JSON, TXT...) */
knowledgeRouter.post("/parse-file", async (req, res) => {
  const { fileName, fileBase64 } = req.body as {
    fileName?: string;
    fileBase64?: string;
  };
  if (!fileName || !fileBase64) {
    return res.status(400).json({ error: "Thiếu fileName hoặc fileBase64" });
  }
  try {
    const buffer = Buffer.from(fileBase64, "base64");
    const parsed = await parseFileBuffer(fileName, buffer);
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Nạp 1 tài liệu mới (Founder dán text trực tiếp hoặc từ file đã phân tích). */
knowledgeRouter.post("/", async (req, res) => {
  const { title, content, source } = req.body as {
    title?: string;
    content?: string;
    source?: string;
  };
  if (!title?.trim() || !content?.trim()) {
    return res.status(400).json({ error: "Thiếu title hoặc content" });
  }
  try {
    const result = await ingestDocument(title.trim(), content, source);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Test search thủ công — dùng để Founder kiểm tra semantic search hoạt động đúng chưa. */
knowledgeRouter.get("/search", async (req, res) => {
  const q = (req.query.q as string) || "";
  if (!q.trim()) return res.status(400).json({ error: "Thiếu query param 'q'" });
  try {
    const results = await searchKnowledge(q, Number(req.query.topK) || 4);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

knowledgeRouter.delete("/:documentId", async (req, res) => {
  const deletedCount = await deleteDocument(req.params.documentId);
  res.json({ deletedCount });
});
