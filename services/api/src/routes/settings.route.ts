import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { logAudit } from "../modules/audit/auditLogger";
import { broadcastCompanyEvent } from "../ws/gateway";
import { BUDGET_REASON_AGENT, BUDGET_REASON_COMPANY } from "../modules/cost/costTracker";
import {
  resolveLlm,
  getEffectiveLlmConfig,
  setDynamicLlmConfig,
  syncLlmConfigFromDb,
  getLlmStatusDescription,
  getAllAvailableProviders,
  DEFAULT_MODELS,
} from "../lib/llm/resolveProvider";
import { generateContent } from "../lib/llm";

export const settingsRouter = Router();

const updateLlmSettingsSchema = z.object({
  llmProvider: z.enum(["gemini", "openai", "anthropic", "custom", "auto"]).nullable().optional(),
  geminiApiKey: z.string().trim().nullable().optional(),
  openaiApiKey: z.string().trim().nullable().optional(),
  anthropicApiKey: z.string().trim().nullable().optional(),
  customLlmUrl: z.string().trim().nullable().optional(),
  customLlmApiKey: z.string().trim().nullable().optional(),
  orchestratorModel: z.string().trim().nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
});

function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

// GET /api/settings — Lấy cài đặt chung (Budget Cap)
settingsRouter.get("/", async (_req, res) => {
  const settings = await db.companySettings.findUnique({ where: { id: "singleton" } });
  res.json({ monthlyBudgetCapUsd: settings?.monthlyBudgetCapUsd ?? null });
});

// GET /api/settings/llm — Lấy cấu hình LLM / AI Gateway hiện tại
settingsRouter.get("/llm", async (_req, res) => {
  await syncLlmConfigFromDb();
  const effective = getEffectiveLlmConfig();
  const resolved = resolveLlm();
  const available = getAllAvailableProviders();

  res.json({
    llmProvider: effective.llmProvider || "auto",
    geminiApiKeyMasked: maskApiKey(effective.geminiApiKey),
    openaiApiKeyMasked: maskApiKey(effective.openaiApiKey),
    anthropicApiKeyMasked: maskApiKey(effective.anthropicApiKey),
    customLlmUrl: effective.customLlmUrl || "",
    customLlmApiKeyMasked: maskApiKey(effective.customLlmApiKey),
    orchestratorModel: effective.orchestratorModel || "",
    temperature: effective.temperature ?? 0.2,

    hasGeminiKey: Boolean(effective.geminiApiKey),
    hasOpenAiKey: Boolean(effective.openaiApiKey),
    hasAnthropicKey: Boolean(effective.anthropicApiKey),
    hasCustomUrl: Boolean(effective.customLlmUrl),

    statusDescription: getLlmStatusDescription(),
    resolved: resolved
      ? {
          provider: resolved.provider,
          model: resolved.model,
          baseUrl: resolved.baseUrl,
          auto: resolved.auto,
        }
      : null,
    availableProviders: available.map((p) => ({
      provider: p.provider,
      model: p.model,
      baseUrl: p.baseUrl,
    })),
    defaultModels: DEFAULT_MODELS,
  });
});

// PUT /api/settings/llm — Cập nhật cấu hình LLM
settingsRouter.put("/llm", async (req, res) => {
  const parsed = updateLlmSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dữ liệu cấu hình AI không hợp lệ",
      details: parsed.error.format(),
    });
  }

  const existing = await db.companySettings.findUnique({ where: { id: "singleton" } });

  // Xử lý giữ lại key cũ nếu client gửi chuỗi rỗng hoặc giữ nguyên mask
  const dataToUpdate: any = {};
  if (parsed.data.llmProvider !== undefined) {
    dataToUpdate.llmProvider = parsed.data.llmProvider === "auto" ? null : parsed.data.llmProvider;
  }
  if (parsed.data.orchestratorModel !== undefined) {
    dataToUpdate.orchestratorModel = parsed.data.orchestratorModel || null;
  }
  if (parsed.data.customLlmUrl !== undefined) {
    dataToUpdate.customLlmUrl = parsed.data.customLlmUrl || null;
  }
  if (parsed.data.temperature !== undefined) {
    dataToUpdate.temperature = parsed.data.temperature;
  }

  // Chỉ update key khi người dùng nhập key mới thực sự (không phải chuỗi mask "••••")
  if (parsed.data.geminiApiKey !== undefined) {
    if (parsed.data.geminiApiKey === "") dataToUpdate.geminiApiKey = null;
    else if (!parsed.data.geminiApiKey?.includes("••••")) dataToUpdate.geminiApiKey = parsed.data.geminiApiKey;
  }
  if (parsed.data.openaiApiKey !== undefined) {
    if (parsed.data.openaiApiKey === "") dataToUpdate.openaiApiKey = null;
    else if (!parsed.data.openaiApiKey?.includes("••••")) dataToUpdate.openaiApiKey = parsed.data.openaiApiKey;
  }
  if (parsed.data.anthropicApiKey !== undefined) {
    if (parsed.data.anthropicApiKey === "") dataToUpdate.anthropicApiKey = null;
    else if (!parsed.data.anthropicApiKey?.includes("••••")) dataToUpdate.anthropicApiKey = parsed.data.anthropicApiKey;
  }
  if (parsed.data.customLlmApiKey !== undefined) {
    if (parsed.data.customLlmApiKey === "") dataToUpdate.customLlmApiKey = null;
    else if (!parsed.data.customLlmApiKey?.includes("••••")) dataToUpdate.customLlmApiKey = parsed.data.customLlmApiKey;
  }

  const updated = await db.companySettings.upsert({
    where: { id: "singleton" },
    update: dataToUpdate,
    create: { id: "singleton", ...dataToUpdate },
  });

  // Đồng bộ lại in-memory config
  setDynamicLlmConfig(dataToUpdate);

  await logAudit({
    action: "LLM_SETTINGS_UPDATED",
    resultSummary: `Founder cập nhật cấu hình AI Agent Input: ${getLlmStatusDescription()}`,
    riskLevel: "R1",
  });

  res.json({
    status: "OK",
    message: "Đã lưu cấu hình AI thành công",
    settings: {
      llmProvider: updated.llmProvider || "auto",
      customLlmUrl: updated.customLlmUrl,
      orchestratorModel: updated.orchestratorModel,
      temperature: updated.temperature,
      statusDescription: getLlmStatusDescription(),
    },
  });
});

// POST /api/settings/test-llm — Kiểm tra kết nối AI Gateway tức thì
settingsRouter.post("/test-llm", async (req, res) => {
  const { provider, model, apiKey, customLlmUrl, customLlmApiKey, temperature } = req.body || {};

  const override: any = {};
  if (provider) override.llmProvider = provider === "auto" ? null : provider;
  if (model) override.orchestratorModel = model;
  if (apiKey && !apiKey.includes("••••")) {
    if (provider === "gemini") override.geminiApiKey = apiKey;
    if (provider === "openai") override.openaiApiKey = apiKey;
    if (provider === "anthropic") override.anthropicApiKey = apiKey;
  }
  if (customLlmUrl) override.customLlmUrl = customLlmUrl;
  if (customLlmApiKey && !customLlmApiKey.includes("••••")) override.customLlmApiKey = customLlmApiKey;
  if (temperature !== undefined && temperature !== null) override.temperature = Number(temperature);

  const startMs = Date.now();
  try {
    const resolved = resolveLlm(override);
    const result = await generateContent(
      "Bạn là AI kiểm tra kết nối hệ thống AI-OPC. Hãy trả lời ngắn gọn đúng 1 câu.",
      "Kiểm tra kết nối: Xác nhận hệ thống AI-OPC đã sẵn sàng hoạt động.",
      { maxTokens: 80, temperature: 0.1 },
      override
    );
    const latencyMs = Date.now() - startMs;

    res.json({
      success: true,
      latencyMs,
      provider: resolved?.provider || "unknown",
      modelUsed: resolved?.model || "unknown",
      reply: result.text,
      tokensUsed: (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0),
    });
  } catch (err: any) {
    const latencyMs = Date.now() - startMs;
    res.status(400).json({
      success: false,
      latencyMs,
      error: err.message || "Không thể kết nối tới nhà cung cấp AI",
    });
  }
});

/** Đặt/xoá trần ngân sách AI cho TOÀN CÔNG TY. Gửi null để xoá trần. */
settingsRouter.put("/", async (req, res) => {
  const { monthlyBudgetCapUsd } = req.body as { monthlyBudgetCapUsd: number | null };
  const value = monthlyBudgetCapUsd === null || monthlyBudgetCapUsd === undefined ? null : Number(monthlyBudgetCapUsd);

  const settings = await db.companySettings.upsert({
    where: { id: "singleton" },
    update: { monthlyBudgetCapUsd: value },
    create: { id: "singleton", monthlyBudgetCapUsd: value },
  });

  await logAudit({
    action: "COMPANY_BUDGET_CAP_UPDATED",
    resultSummary: value == null ? "Founder xoá trần ngân sách công ty" : `Founder đặt trần ngân sách công ty: $${value}`,
  });

  res.json(settings);
});

/**
 * Reset chi phí TOÀN BỘ agent về $0 + tự mở lại (READY) mọi agent đang
 * SUSPENDED do Budget Guardrail.
 */
settingsRouter.post("/reset-company-cost", async (_req, res) => {
  const agents = await db.agent.findMany();
  let unsuspendedCount = 0;

  for (const a of agents) {
    const shouldUnsuspend = a.suspendedReason === BUDGET_REASON_COMPANY || a.suspendedReason === BUDGET_REASON_AGENT;
    if (shouldUnsuspend) unsuspendedCount += 1;

    const updated = await db.agent.update({
      where: { id: a.id },
      data: {
        monthlyCostUsd: 0,
        ...(shouldUnsuspend ? { status: "READY", suspendedReason: null } : {}),
      },
    });
    broadcastCompanyEvent({ type: "AGENT_STATUS", payload: updated });
  }

  await logAudit({
    action: "COMPANY_COST_RESET",
    resultSummary: `Founder reset chi phí toàn công ty về $0 — mở lại ${unsuspendedCount} agent bị khoá do ngân sách.`,
  });

  res.json({ status: "OK", agentCount: agents.length, unsuspendedCount });
});
