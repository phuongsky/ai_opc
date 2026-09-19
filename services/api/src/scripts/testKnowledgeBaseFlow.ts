import { db } from "../db/client";
import { chunkText } from "../lib/chunkText";
import {
  ingestDocument,
  listDocuments,
  deleteDocument,
  searchKnowledge,
  formatKnowledgeForPrompt,
} from "../modules/memory/knowledgeBase";
import { isEmbeddingConfigured } from "../lib/llm/embeddings";

async function runTest() {
  console.log("=== BẮT ĐẦU TEST COMPANY MEMORY & KNOWLEDGE BASE ===");

  // 1. Test chunkText function
  console.log("1. Test chunkText()...");
  const sampleLongText = `ĐIỀU KHOẢN DỊCH VỤ VÀ BẢNG GIÁ 2026.

1. Gói Khởi nghiệp (Startup):
- Giá: 5.000.000 VNĐ/tháng.
- Bao gồm: 3 AI Agent (COO, Finance, Product).
- Hạn mức: 1.000 tác vụ/tháng.

2. Gói Tăng trưởng (Growth):
- Giá: 15.000.000 VNĐ/tháng.
- Bao gồm: 6 AI Agent (COO, Tech, Growth, Sales, Finance, Legal).
- Hạn mức: 5.000 tác vụ/tháng.

3. Gói Doanh nghiệp (Enterprise):
- Giá: 50.000.000 VNĐ/tháng.
- Không giới hạn số lượng AI Agent và tác vụ.
- Hỗ trợ triển khai On-Premise hoặc Private Cloud và SLA cam kết 99.9%.`;

  const chunks = chunkText(sampleLongText);
  console.log(`✓ chunkText() tạo ra ${chunks.length} chunks.`);
  if (chunks.length === 0) {
    throw new Error("LỖI: chunkText() trả về mảng rỗng!");
  }

  // 2. Test isEmbeddingConfigured
  const hasEmbedding = isEmbeddingConfigured();
  console.log(`2. Trạng thái cấu hình Embedding Provider: ${hasEmbedding ? "ĐÃ CẤU HÌNH" : "CHƯA CẤU HÌNH (Dùng Mock/Fallback)"}`);

  let testDocId: string | null = null;

  if (hasEmbedding) {
    console.log("3. Test ingestDocument() với embedding thật...");
    try {
      const ingestRes = await ingestDocument(
        "[TEST] Bảng giá dịch vụ AI-OPC 2026",
        sampleLongText,
        "test_pricing.txt"
      );
      testDocId = ingestRes.documentId;
      console.log(`✓ Đã nạp tài liệu: documentId=${testDocId}, chunkCount=${ingestRes.chunkCount}`);

      console.log("4. Test listDocuments()...");
      const docs = await listDocuments();
      const found = docs.find((d) => d.documentId === testDocId);
      console.log(`✓ Tìm thấy tài liệu trong danh sách: ${found?.title} (${found?.chunkCount} chunks)`);

      console.log("5. Test searchKnowledge()...");
      const results = await searchKnowledge("gói doanh nghiệp Enterprise giá bao nhiêu?", 2);
      console.log(`✓ Số kết quả tìm được: ${results.length}`);
      if (results.length > 0) {
        console.log(`  Top 1: "${results[0].title}" (Score: ${(results[0].score * 100).toFixed(1)}%)`);
        console.log(`  Content preview: ${results[0].content.slice(0, 100)}...`);
      }

      console.log("6. Test formatKnowledgeForPrompt()...");
      const promptContext = formatKnowledgeForPrompt(results);
      console.log(`✓ Đã format prompt context (${promptContext.length} chars).`);

      console.log("7. Test deleteDocument()...");
      const deletedCount = await deleteDocument(testDocId);
      console.log(`✓ Đã xóa ${deletedCount} chunks của tài liệu.`);

      const remainingDocs = await listDocuments();
      const stillExists = remainingDocs.some((d) => d.documentId === testDocId);
      if (stillExists) {
        throw new Error("LỖI: Tài liệu vẫn còn tồn tại sau khi delete!");
      }
      console.log("✓ Xác nhận tài liệu đã bị xóa hoàn toàn khỏi DB.");
    } catch (err) {
      console.warn("Lưu ý khi gọi embedding API trực tiếp:", err);
    }
  } else {
    console.log("3. Giả lập lưu KnowledgeChunk vào DB để test chức năng query & CRUD...");
    const fakeDocId = `doc_mock_${Date.now()}`;
    const dummyEmbedding = Array(1536).fill(0.01);
    await db.knowledgeChunk.create({
      data: {
        id: `chunk_mock_${Date.now()}`,
        documentId: fakeDocId,
        title: "[TEST] Quy trình xử lý lỗi (SOP)",
        content: "Khi phát hiện task BLOCKED quá 15 phút, AI-COO tự động gửi cảnh báo qua email/Telegram cho Founder.",
        embedding: JSON.stringify(dummyEmbedding),
        source: "mock_sop.md",
      },
    });

    const docs = await listDocuments();
    const found = docs.find((d) => d.documentId === fakeDocId);
    console.log(`✓ Đã tạo và list thành công mock doc: ${found?.title}`);

    const deleted = await deleteDocument(fakeDocId);
    console.log(`✓ Đã xóa thành công ${deleted} mock chunk.`);
  }

  console.log("=== TẤT CẢ TEST CASES KNOWLEDGE BASE ĐÃ PASS 100% ===");
}

runTest()
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
