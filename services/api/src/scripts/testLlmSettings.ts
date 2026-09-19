import { db } from "../db/client";
import {
  syncLlmConfigFromDb,
  getEffectiveLlmConfig,
  resolveLlm,
  getLlmStatusDescription,
  setDynamicLlmConfig,
} from "../lib/llm/resolveProvider";

async function run() {
  console.log("=== BẮT ĐẦU KIỂM TRA CẤU HÌNH AI AGENT INPUT / LLM GATEWAY ===");

  console.log("1. Đọc cấu hình hiện tại...");
  await syncLlmConfigFromDb();
  const initial = getEffectiveLlmConfig();
  console.log("✓ Cấu hình ban đầu:", getLlmStatusDescription());

  console.log("2. Cập nhật cấu hình mới vào Database (chuyển sang custom local Ollama)...");
  await db.companySettings.upsert({
    where: { id: "singleton" },
    update: {
      llmProvider: "custom",
      customLlmUrl: "http://localhost:11434/v1",
      orchestratorModel: "llama3.3",
      temperature: 0.15,
    },
    create: {
      id: "singleton",
      llmProvider: "custom",
      customLlmUrl: "http://localhost:11434/v1",
      orchestratorModel: "llama3.3",
      temperature: 0.15,
    },
  });

  console.log("3. Đồng bộ in-memory cache từ Database...");
  await syncLlmConfigFromDb();
  const resolved = resolveLlm();
  console.log("✓ Trạng thái mới:", getLlmStatusDescription());

  if (!resolved || resolved.provider !== "custom" || resolved.model !== "llama3.3") {
    throw new Error(`Cấu hình resolve không khớp mong đợi: ${JSON.stringify(resolved)}`);
  }
  console.log("✓ Resolve đúng provider custom và model llama3.3!");

  console.log("4. Kiểm tra cấu hình Google Gemini...");
  await db.companySettings.update({
    where: { id: "singleton" },
    data: {
      llmProvider: "gemini",
      orchestratorModel: "gemini-3.7-flash",
      temperature: 0.2,
    },
  });
  await syncLlmConfigFromDb();
  console.log("✓ Trạng thái Gemini:", getLlmStatusDescription());

  console.log("5. Khôi phục cấu hình ban đầu...");
  await db.companySettings.update({
    where: { id: "singleton" },
    data: {
      llmProvider: initial.llmProvider,
      orchestratorModel: initial.orchestratorModel,
      customLlmUrl: initial.customLlmUrl,
      temperature: initial.temperature,
    },
  });
  await syncLlmConfigFromDb();
  console.log("✓ Đã khôi phục hoàn tất:", getLlmStatusDescription());

  console.log("=== TẤT CẢ CÁC BƯỚC KIỂM TRA ĐỀU THÀNH CÔNG ===");
}

run()
  .catch((err) => {
    console.error("LỖI TEST:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
