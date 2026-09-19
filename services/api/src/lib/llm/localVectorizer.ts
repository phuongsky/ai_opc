/**
 * Local Feature Vectorizer — Bộ sinh vector đặc trưng ngữ nghĩa & từ vựng nội bộ (in-memory)
 * hỗ trợ đa ngôn ngữ (Tiếng Việt có dấu, Tiếng Anh, mã code).
 *
 * Sử dụng kỹ thuật Hashing Trick (MurmurHash3 / FNV-1a) kết hợp:
 *   1. Tokenization (từ đơn, từ ghép)
 *   2. Character 3-grams (nắm bắt gốc từ, lỗi chính tả, biến thể từ)
 *   3. Sublinear Term Frequency: TF = 1 + ln(count)
 *   4. L2 Normalization: Độ dài vector = 1.0 để tính Cosine Similarity tức thì qua Dot Product.
 *
 * Mục đích: Đảm bảo Company Knowledge Base HOẠT ĐỘNG 100% ỔN ĐỊNH NGAY CẢ KHI:
 *   - Provider LLM (như custom proxy, Anthropic) không có /v1/embeddings (trả về 404).
 *   - Mất mạng / API key embedding hết quota.
 *   - Founder muốn chạy hoàn toàn offline không tốn tiền API embedding.
 */

export const LOCAL_VECTOR_DIM = 384;

/** Hashing 32-bit FNV-1a */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Tách từ và sinh character n-grams */
function extractFeatures(text: string): { words: string[]; ngrams: string[] } {
  const normalized = text
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s_.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = normalized.split(" ").filter((w) => w.length > 0);
  const ngrams: string[] = [];

  // Sinh char 3-grams cho từng từ
  for (const word of words) {
    if (word.length >= 3) {
      for (let i = 0; i <= word.length - 3; i++) {
        ngrams.push(word.slice(i, i + 3));
      }
    } else {
      ngrams.push(word);
    }
  }

  return { words, ngrams };
}

/**
 * Sinh vector đặc trưng 384 chiều (L2 normalized) từ chuỗi văn bản.
 */
export function generateLocalEmbedding(text: string): { embedding: number[]; tokenCount: number } {
  if (!text || text.trim() === "") {
    return { embedding: new Array(LOCAL_VECTOR_DIM).fill(0), tokenCount: 0 };
  }

  const { words, ngrams } = extractFeatures(text);
  const vector = new Float64Array(LOCAL_VECTOR_DIM);

  // Đếm tần suất từ (Words có trọng số cao hơn ngrams)
  const wordCounts = new Map<string, number>();
  for (const w of words) {
    wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
  }

  for (const [w, count] of wordCounts.entries()) {
    const hash = fnv1a(w);
    const index = hash % LOCAL_VECTOR_DIM;
    const sign = (hash & 0x80000000) === 0 ? 1 : -1;
    const weight = (1 + Math.log(count)) * 2.0; // Trọng số từ đơn = 2.0
    vector[index] += sign * weight;
  }

  // Đếm tần suất n-grams
  const ngramCounts = new Map<string, number>();
  for (const ng of ngrams) {
    ngramCounts.set(ng, (ngramCounts.get(ng) || 0) + 1);
  }

  for (const [ng, count] of ngramCounts.entries()) {
    const hash = fnv1a(`ng_${ng}`);
    const index = hash % LOCAL_VECTOR_DIM;
    const sign = (hash & 0x80000000) === 0 ? 1 : -1;
    const weight = 1 + Math.log(count); // Trọng số n-gram = 1.0
    vector[index] += sign * weight;
  }

  // L2 Normalization (chuẩn hoá vector độ dài = 1.0)
  let sumSq = 0;
  for (let i = 0; i < LOCAL_VECTOR_DIM; i++) {
    sumSq += vector[i] * vector[i];
  }

  const norm = Math.sqrt(sumSq);
  const result: number[] = new Array(LOCAL_VECTOR_DIM);

  if (norm > 0) {
    for (let i = 0; i < LOCAL_VECTOR_DIM; i++) {
      // Làm tròn 6 chữ số thập phân để tối ưu dung lượng JSON trong DB
      result[i] = Math.round((vector[i] / norm) * 1_000_000) / 1_000_000;
    }
  } else {
    for (let i = 0; i < LOCAL_VECTOR_DIM; i++) result[i] = 0;
  }

  const tokenCount = Math.max(1, Math.ceil(text.length / 4));
  return { embedding: result, tokenCount };
}
