/**
 * Chia nhỏ văn bản dài thành các chunk ~CHUNK_SIZE ký tự, có overlap để không
 * cắt đứt ngữ cảnh giữa 2 chunk liền kề. Ưu tiên cắt tại ranh giới đoạn văn
 * (\n\n) hoặc câu (". ") để mỗi chunk giữ được ngữ nghĩa trọn vẹn nhất có thể.
 */
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;

export function chunkText(text: string): string[] {
  const cleaned = text.trim();
  if (cleaned.length === 0) return [];
  if (cleaned.length <= CHUNK_SIZE) return [cleaned];

  const chunks: string[] = [];
  let start = 0;

  while (start < cleaned.length) {
    let end = Math.min(start + CHUNK_SIZE, cleaned.length);

    if (end < cleaned.length) {
      // Cố tìm ranh giới đoạn văn/câu gần cuối chunk để cắt đẹp hơn thay vì
      // cắt cứng giữa từ. Chỉ chấp nhận nếu ranh giới đó không lùi quá xa
      // (tránh tạo chunk quá ngắn).
      const paragraphBreak = cleaned.lastIndexOf("\n\n", end);
      const sentenceBreak = cleaned.lastIndexOf(". ", end);
      const boundary = Math.max(paragraphBreak, sentenceBreak);
      if (boundary > start + CHUNK_SIZE * 0.5) {
        end = boundary + 1;
      }
    }

    const piece = cleaned.slice(start, end).trim();
    if (piece.length > 0) chunks.push(piece);

    const nextStart = end - CHUNK_OVERLAP;
    if (nextStart <= start) break; // an toàn, tránh vòng lặp vô hạn
    start = nextStart;
    if (start >= cleaned.length) break;
  }

  return chunks;
}
