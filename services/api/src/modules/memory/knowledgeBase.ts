/**
 * Company Knowledge Base — "bộ nhớ dài hạn" của công ty. Founder nạp tài liệu
 * (bảng giá, SOP, playbook, thông tin sản phẩm...), hệ thống chia nhỏ + tạo
 * embedding, lưu vào DB. Orchestrator (AI-COO) và AgentReasoner (Department
 * Agent) truy vấn ngữ nghĩa (semantic & hybrid search) trước khi ra quyết định,
 * để AI thực sự "hiểu công ty" thay vì chỉ dựa vào 1 câu mission ngắn.
 *
 * Tính năng nổi bật:
 *   - Hỗ trợ đa Provider Embedding (OpenAI, Gemini, Custom, Local TF-IDF).
 *   - Tự động fallback sang Built-in Vectorizer nếu remote endpoint không hỗ trợ /embeddings (404).
 *   - Hybrid Search: Kết hợp Cosine Vector Similarity + Keyword Term Matching để
 *     cho độ chính xác cao nhất đối với cả truy vấn ngữ nghĩa lẫn từ khoá chính xác.
 */
import { randomUUID } from "crypto";
import { db } from "../../db/client";
import { generateEmbedding, generateEmbeddings } from "../../lib/llm/embeddings";
import { chunkText } from "../../lib/chunkText";
import { recordModelCost } from "../cost/costTracker";

export interface IngestResult {
  documentId: string;
  chunkCount: number;
  engine: "remote" | "builtin";
}

export interface KnowledgeDocumentSummary {
  documentId: string;
  title: string;
  source: string | null;
  chunkCount: number;
  createdAt: Date;
}

export interface KnowledgeSearchResult {
  title: string;
  content: string;
  source: string | null;
  score: number;
}

/** Chia tài liệu thành chunk, tạo embedding theo batch có throttling delay, lưu vào DB. */
export async function ingestDocument(
  title: string,
  content: string,
  source?: string
): Promise<IngestResult> {
  const documentId = `doc_${randomUUID()}`;
  const chunks = chunkText(content);
  let totalTokens = 0;
  let usedEngine: "remote" | "builtin" = "builtin";

  if (chunks.length === 0) {
    return { documentId, chunkCount: 0, engine: "builtin" };
  }

  // Tối ưu Batching & Throttling: Gom các chunk thành từng mảng nhỏ (tối đa 8 chunks/lần)
  // và thêm delay 1500ms giữa các batch request để tránh kích hoạt Rate Limit 429
  const BATCH_SIZE = 8;
  const BATCH_DELAY_MS = 1500;

  for (let b = 0; b < chunks.length; b += BATCH_SIZE) {
    const batchChunks = chunks.slice(b, b + BATCH_SIZE);

    // Thêm khoảng nghỉ an toàn giữa các batch request
    if (b > 0) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }

    const results = await generateEmbeddings(batchChunks);

    for (let j = 0; j < batchChunks.length; j++) {
      const idx = b + j;
      const res = results[j] || { embedding: [], tokenCount: 0, engine: "builtin" };
      if (res.engine === "remote") usedEngine = "remote";
      totalTokens += res.tokenCount;

      await db.knowledgeChunk.create({
        data: {
          id: `chunk_${randomUUID()}`,
          documentId,
          title: chunks.length > 1 ? `${title} (phần ${idx + 1}/${chunks.length})` : title,
          content: batchChunks[j],
          embedding: JSON.stringify(res.embedding),
          source: source ?? "manual",
        },
      });
    }
  }

  if (totalTokens > 0 && usedEngine === "remote") {
    // Gắn chi phí embedding vào "ai_coo" vì Knowledge Base là năng lực cấp công ty
    await recordModelCost(
      "ai_coo",
      { inputTokens: totalTokens, outputTokens: 0 },
      `Ingest tài liệu Knowledge Base: "${title}" (${chunks.length} chunk)`
    );
  }

  return { documentId, chunkCount: chunks.length, engine: usedEngine };
}

/** Danh sách tài liệu đã nạp, group theo documentId. */
export async function listDocuments(): Promise<KnowledgeDocumentSummary[]> {
  const chunks = await db.knowledgeChunk.findMany({ orderBy: { createdAt: "asc" } });
  const grouped = new Map<string, KnowledgeDocumentSummary>();

  for (const c of chunks) {
    const existing = grouped.get(c.documentId);
    if (existing) {
      existing.chunkCount += 1;
    } else {
      grouped.set(c.documentId, {
        documentId: c.documentId,
        title: c.title.replace(/\s\(phần \d+\/\d+\)$/, ""),
        source: c.source,
        chunkCount: 1,
        createdAt: c.createdAt,
      });
    }
  }

  return Array.from(grouped.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function deleteDocument(documentId: string): Promise<number> {
  const result = await db.knowledgeChunk.deleteMany({ where: { documentId } });
  return result.count;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function keywordMatchScore(query: string, text: string): number {
  const qWords = query
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  if (qWords.length === 0) return 0;

  const target = text.toLowerCase().normalize("NFC");
  let matches = 0;
  for (const w of qWords) {
    if (target.includes(w)) matches++;
  }
  return matches / qWords.length;
}

const MIN_RELEVANCE_SCORE = 0.15;

/**
 * Hybrid Semantic & Keyword Search — trả về tối đa `topK` chunk liên quan nhất tới `query`.
 */
export async function searchKnowledge(query: string, topK = 4): Promise<KnowledgeSearchResult[]> {
  if (!query || query.trim() === "") return [];

  const allChunks = await db.knowledgeChunk.findMany();
  if (allChunks.length === 0) return [];

  try {
    const { embedding: queryEmbedding, tokenCount, engine } = await generateEmbedding(query);
    if (tokenCount > 0 && engine === "remote") {
      await recordModelCost(
        "ai_coo",
        { inputTokens: tokenCount, outputTokens: 0 },
        `Semantic search Knowledge Base: "${query.slice(0, 60)}"`
      );
    }

    const scored = allChunks.map((c: { title: string; content: string; source: string | null; embedding: string }) => {
      let chunkVector: number[] = [];
      try {
        chunkVector = JSON.parse(c.embedding) as number[];
      } catch {
        chunkVector = [];
      }

      const vectorSim = cosineSimilarity(queryEmbedding, chunkVector);
      const kwSim = keywordMatchScore(query, `${c.title} ${c.content}`);
      // Hybrid score: 65% vector similarity + 35% exact keyword match
      const combinedScore = Math.max(vectorSim, vectorSim * 0.65 + kwSim * 0.35);

      return {
        title: c.title,
        content: c.content,
        source: c.source,
        score: Math.round(combinedScore * 1000) / 1000,
      };
    });

    scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);
    return scored.slice(0, topK).filter((s: { score: number }) => s.score >= MIN_RELEVANCE_SCORE);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[KnowledgeBase] Lỗi khi search:", err);
    return [];
  }
}

/** Định dạng kết quả search thành đoạn text để nhét vào system/user prompt. */
export function formatKnowledgeForPrompt(results: KnowledgeSearchResult[]): string {
  if (results.length === 0) return "";
  const blocks = results
    .map((r, i) => `[Kiến thức ${i + 1} — ${r.title}${r.source ? ` (${r.source})` : ""}]\n${r.content}`)
    .join("\n\n");
  return `\n\nTHÔNG TIN LIÊN QUAN TỪ COMPANY KNOWLEDGE BASE (dùng để tham khảo, ưu tiên áp dụng nếu phù hợp):\n${blocks}`;
}
