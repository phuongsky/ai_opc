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
import { lookupService } from "../modules/lookups/lookupService";
import { getSystemLogs, clearSystemLogs } from "../modules/systemLogs/systemLogger";
import { rbacService } from "../modules/rbac/rbacService";
import {
  getExternalDbConfig,
  updateExternalDbConfig,
  testExternalDbConnection,
} from "../modules/datasources/externalDbClient";
import {
  getAuthChannelsConfig,
  updateAuthChannelsConfig,
} from "../modules/auth/authChannelsConfig";
import { resetCachedOAuthClient } from "../modules/auth/googleAuthService";
import {
  getCockpitNavConfig,
  updateCockpitNavConfig,
} from "../modules/settings/cockpitNavConfig";
import {
  listSystemAccounts,
  createSystemAccount,
  updateSystemAccount,
  resetSystemAccountPassword,
  deleteSystemAccount,
} from "../modules/auth/accountService";
import {
  syncVideoConfigFromDb,
  getCachedDynamicVideoConfig,
  setDynamicVideoConfig,
} from "../modules/videos/videoProvider";

export const settingsRouter = Router();

const updateLlmSettingsSchema = z.object({
  llmProvider: z.enum(["gemini", "openai", "anthropic", "custom", "auto"]).nullable().optional(),
  geminiApiKey: z.string().trim().nullable().optional(),
  openaiApiKey: z.string().trim().nullable().optional(),
  anthropicApiKey: z.string().trim().nullable().optional(),
  customLlmUrl: z.string().trim().nullable().optional(),
  customLlmApiKey: z.string().trim().nullable().optional(),
  orchestratorModel: z.string().trim().nullable().optional(),
  embeddingApiKey: z.string().trim().nullable().optional(),
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
    embeddingApiKeyMasked: maskApiKey(effective.embeddingApiKey),
    temperature: effective.temperature ?? 0.2,

    hasGeminiKey: Boolean(effective.geminiApiKey),
    hasOpenAiKey: Boolean(effective.openaiApiKey),
    hasAnthropicKey: Boolean(effective.anthropicApiKey),
    hasCustomUrl: Boolean(effective.customLlmUrl),
    hasEmbeddingKey: Boolean(effective.embeddingApiKey),

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
  if (parsed.data.embeddingApiKey !== undefined) {
    if (parsed.data.embeddingApiKey === "") dataToUpdate.embeddingApiKey = null;
    else if (!parsed.data.embeddingApiKey?.includes("••••")) dataToUpdate.embeddingApiKey = parsed.data.embeddingApiKey;
  }

  const updated = await db.companySettings.upsert({
    where: { id: "singleton" },
    update: dataToUpdate,
    create: { id: "singleton", ...dataToUpdate },
  });

  if (dataToUpdate.embeddingApiKey !== undefined) {
    if (dataToUpdate.embeddingApiKey) {
      process.env.EMBEDDING_API_KEY = dataToUpdate.embeddingApiKey;
    } else {
      delete process.env.EMBEDDING_API_KEY;
    }
  }

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

// POST /api/settings/llm/reset — Đặt lại (reset) toàn bộ cấu hình AI Agent Input & Model Gateway về mặc định
settingsRouter.post("/llm/reset", async (_req, res) => {
  try {
    const resetData = {
      llmProvider: null,
      geminiApiKey: null,
      openaiApiKey: null,
      anthropicApiKey: null,
      customLlmUrl: null,
      customLlmApiKey: null,
      orchestratorModel: null,
      embeddingApiKey: null,
      temperature: 0.2,
    };

    const updated = await db.companySettings.upsert({
      where: { id: "singleton" },
      update: resetData,
      create: { id: "singleton", ...resetData },
    });

    setDynamicLlmConfig(resetData);

    await logAudit({
      action: "LLM_SETTINGS_RESET",
      resultSummary: "Founder đã đặt lại (reset) toàn bộ cấu hình AI Agent Input & Model Gateway về mặc định.",
      riskLevel: "R1",
    });

    broadcastCompanyEvent({
      type: "SETTINGS_UPDATED" as any,
      payload: { llmSettings: resetData },
    });

    res.json({
      status: "OK",
      message: "Đã xóa toàn bộ cấu hình AI Agent Input & Model Gateway về mặc định thành công",
      settings: {
        llmProvider: "auto",
        customLlmUrl: null,
        orchestratorModel: null,
        temperature: 0.2,
        statusDescription: getLlmStatusDescription(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi reset cấu hình AI Gateway" });
  }
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

  // Tự động mở lại các agent bị khoá do trần công ty nếu trần được xoá hoặc nâng lên cao hơn chi phí
  const allAgents = await db.agent.findMany();
  const totalSpent = allAgents.reduce((sum: number, a: { monthlyCostUsd: number }) => sum + (a.monthlyCostUsd || 0), 0);

  if (value === null || value > totalSpent) {
    for (const a of allAgents) {
      if (a.suspendedReason === BUDGET_REASON_COMPANY) {
        const updated = await db.agent.update({
          where: { id: a.id },
          data: { status: "READY", suspendedReason: null },
        });
        broadcastCompanyEvent({ type: "AGENT_STATUS", payload: updated });
      }
    }
  }

  await logAudit({
    action: "COMPANY_BUDGET_CAP_UPDATED",
    resultSummary: value == null ? "Founder xoá trần ngân sách công ty (không giới hạn)" : `Founder đặt trần ngân sách công ty: $${value}`,
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

// =========================================================================
// Dynamic System Dictionary (Từ điển quy ước động) — Bug 3 & Bug 4
// =========================================================================
const upsertLookupSchema = z.object({
  id: z.string().optional(),
  category: z.string().min(1, "Danh mục không được để trống"),
  rawCode: z.number().int("Mã số phải là số nguyên"),
  standardKey: z.string().min(1, "Khóa chuẩn không được để trống"),
  displayName: z.string().min(1, "Tên hiển thị không được để trống"),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

// GET /api/settings/lookups — Lấy danh sách quy ước (hỗ trợ lọc theo category)
settingsRouter.get("/lookups", async (req, res) => {
  try {
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const items = await lookupService.getAllLookups(category);
    const toolDescription = lookupService.getToolDescription(category || "booking_status");
    res.json({ items, toolDescription });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi lấy danh sách quy ước" });
  }
});

// POST /api/settings/lookups — Thêm mới hoặc cập nhật một mục quy ước
settingsRouter.post("/lookups", async (req, res) => {
  const parsed = upsertLookupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dữ liệu quy ước không hợp lệ",
      details: parsed.error.format(),
    });
  }

  try {
    const item = await lookupService.upsertLookup(parsed.data);
    await logAudit({
      action: "LOOKUP_UPDATED",
      resultSummary: `Founder cập nhật quy ước [${item.category}] Mã ${item.rawCode} -> "${item.displayName}"`,
      riskLevel: "R1",
    });
    res.json({ status: "OK", item, toolDescription: lookupService.getToolDescription(item.category) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi lưu quy ước" });
  }
});

// PUT /api/settings/lookups/:id — Cập nhật mục quy ước theo ID
settingsRouter.put("/lookups/:id", async (req, res) => {
  const parsed = upsertLookupSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dữ liệu quy ước không hợp lệ",
      details: parsed.error.format(),
    });
  }

  try {
    const existing = (await lookupService.getAllLookups()).find((x) => x.id === req.params.id);
    if (!existing) {
      return res.status(404).json({ error: "Không tìm thấy quy ước cần sửa" });
    }

    const payload = {
      id: req.params.id,
      category: parsed.data.category || existing.category,
      rawCode: parsed.data.rawCode !== undefined ? parsed.data.rawCode : existing.rawCode,
      standardKey: parsed.data.standardKey || existing.standardKey,
      displayName: parsed.data.displayName || existing.displayName,
      description: parsed.data.description !== undefined ? parsed.data.description : existing.description,
      isActive: parsed.data.isActive !== undefined ? parsed.data.isActive : existing.isActive,
    };

    const item = await lookupService.upsertLookup(payload);
    await logAudit({
      action: "LOOKUP_UPDATED",
      resultSummary: `Founder cập nhật quy ước [${item.category}] Mã ${item.rawCode} -> "${item.displayName}"`,
      riskLevel: "R1",
    });
    res.json({ status: "OK", item, toolDescription: lookupService.getToolDescription(item.category) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi cập nhật quy ước" });
  }
});

// DELETE /api/settings/lookups/:id — Xóa một mục quy ước
settingsRouter.delete("/lookups/:id", async (req, res) => {
  try {
    await lookupService.deleteLookup(req.params.id);
    await logAudit({
      action: "LOOKUP_DELETED",
      resultSummary: `Founder xóa quy ước ID "${req.params.id}"`,
      riskLevel: "R1",
    });
    res.json({ status: "OK", message: "Đã xóa quy ước thành công" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi xóa quy ước" });
  }
});

// POST /api/settings/lookups/reset-defaults — Khôi phục về quy ước mặc định
settingsRouter.post("/lookups/reset-defaults", async (_req, res) => {
  try {
    await lookupService.resetToDefaults();
    await logAudit({
      action: "LOOKUP_RESET_DEFAULTS",
      resultSummary: "Founder khôi phục bảng từ điển quy ước về mặc định ban đầu",
      riskLevel: "R1",
    });
    const items = await lookupService.getAllLookups("booking_status");
    res.json({ status: "OK", message: "Đã khôi phục quy ước mặc định", items });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi khôi phục quy ước mặc định" });
  }
});

// =========================================================================
// System Console Logs API (Nhật ký console hệ thống)
// =========================================================================
// GET /api/settings/logs — Lấy danh sách console log hệ thống
settingsRouter.get("/logs", async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 300;
    const level = typeof req.query.level === "string" ? req.query.level : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;

    const result = getSystemLogs({ limit, level, search });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi lấy log hệ thống" });
  }
});

// DELETE /api/settings/logs — Xóa sạch buffer log hiện thời
settingsRouter.delete("/logs", async (_req, res) => {
  try {
    const result = clearSystemLogs();
    res.json({ status: "OK", message: "Đã xóa trắng log buffer", ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi xóa log buffer" });
  }
});

// =========================================================================
// RBAC System Permissions Matrix API (Phân quyền sử dụng hệ thống)
// =========================================================================

// GET /api/settings/rbac — Lấy ma trận phân quyền hiện hành
settingsRouter.get("/rbac", async (_req, res) => {
  try {
    const matrix = await rbacService.getPermissionsMatrix();
    res.json(matrix);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi lấy ma trận phân quyền" });
  }
});

// PUT /api/settings/rbac — Cập nhật ma trận phân quyền
settingsRouter.put("/rbac", async (req, res) => {
  try {
    const { permissions, agentPermissions, commandPermissions } = req.body;
    if (!permissions && !agentPermissions && !commandPermissions) {
      return res.status(400).json({ error: "Dữ liệu ma trận phân quyền không hợp lệ" });
    }

    const updated = await rbacService.updatePermissionsMatrix(
      { permissions, agentPermissions, commandPermissions },
      "FOUNDER"
    );
    await logAudit({
      action: "RBAC_PERMISSIONS_UPDATED",
      resultSummary: "Founder cập nhật cấu hình ma trận phân quyền sử dụng hệ thống (RBAC)",
      riskLevel: "R2",
    });

    broadcastCompanyEvent({
      type: "RBAC_PERMISSIONS_UPDATED" as any,
      payload: updated,
    });

    res.json({
      status: "OK",
      message: "Đã lưu ma trận phân quyền thành công",
      matrix: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi cập nhật ma trận phân quyền" });
  }
});

// POST /api/settings/rbac/reset-defaults — Khôi phục ma trận phân quyền mặc định
settingsRouter.post("/rbac/reset-defaults", async (_req, res) => {
  try {
    const restored = await rbacService.resetToDefaults();
    await logAudit({
      action: "RBAC_PERMISSIONS_RESET_DEFAULTS",
      resultSummary: "Founder khôi phục ma trận phân quyền hệ thống về mặc định tiêu chuẩn",
      riskLevel: "R2",
    });

    broadcastCompanyEvent({
      type: "RBAC_PERMISSIONS_UPDATED" as any,
      payload: restored,
    });

    res.json({
      status: "OK",
      message: "Đã khôi phục ma trận phân quyền về mặc định",
      matrix: restored,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi khôi phục phân quyền mặc định" });
  }
});

// =========================================================================
// External Data Source Settings API (Cấu hình Database bên ngoài)
// =========================================================================

// GET /api/settings/datasource — Lấy cấu hình kết nối database bên ngoài hiện tại
settingsRouter.get("/datasource", (_req, res) => {
  try {
    const config = getExternalDbConfig("hotel_dbs");
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi lấy cấu hình External Database" });
  }
});

// PUT /api/settings/datasource — Cập nhật cấu hình kết nối database bên ngoài
settingsRouter.put("/datasource", async (req, res) => {
  try {
    const updated = updateExternalDbConfig("hotel_dbs", req.body);
    await logAudit({
      action: "EXTERNAL_DATASOURCE_UPDATED",
      resultSummary: `Founder cập nhật cấu hình CSDL nguồn ngoài (${updated.engine} - ${updated.database}@${updated.host}:${updated.port})`,
      riskLevel: "R2",
    });

    broadcastCompanyEvent({
      type: "SETTINGS_UPDATED" as any,
      payload: { externalDb: updated },
    });

    res.json({
      status: "OK",
      message: "Đã lưu cấu hình External Database thành công!",
      config: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi cập nhật cấu hình External Database" });
  }
});

// POST /api/settings/datasource/test — Kiểm tra kết nối tới database bên ngoài
settingsRouter.post("/datasource/test", async (req, res) => {
  try {
    const result = await testExternalDbConnection(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: `Lỗi kiểm tra kết nối: ${err.message || String(err)}`,
    });
  }
});

// GET /api/settings/auth-channels — Lấy cấu hình các kênh đăng nhập (Google Login...)
settingsRouter.get("/auth-channels", (_req, res) => {
  const config = getAuthChannelsConfig();
  res.json(config);
});

// PUT /api/settings/auth-channels — Lưu cấu hình các kênh đăng nhập
settingsRouter.put("/auth-channels", async (req, res) => {
  try {
    const { googleLoginEnabled, googleClientId, zaloLoginEnabled } = req.body || {};
    const updated = updateAuthChannelsConfig({
      googleLoginEnabled,
      googleClientId,
      zaloLoginEnabled,
    });
    resetCachedOAuthClient();

    await logAudit({
      action: "AUTH_CHANNELS_UPDATED",
      resultSummary: `Founder cập nhật cấu hình kênh đăng nhập: Google Login ${updated.googleLoginEnabled ? "BẬT" : "TẮT"} (Client ID: ${updated.googleClientId ? updated.googleClientId.slice(0, 15) + "..." : "Trống"}), Zalo Login ${updated.zaloLoginEnabled ? "BẬT" : "TẮT"}`,
      riskLevel: "R1",
    });

    broadcastCompanyEvent({
      type: "SETTINGS_UPDATED" as any,
      payload: { authChannels: updated },
    });

    res.json({
      status: "OK",
      message: "Đã lưu cấu hình Kênh đăng nhập thành công!",
      config: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi cập nhật cấu hình Kênh đăng nhập" });
  }
});

// GET /api/settings/cockpit-nav — Lấy cấu hình hiển thị các nút bấm trang chủ Executive Cockpit
settingsRouter.get("/cockpit-nav", (req, res) => {
  const userEmail = (req as any).user?.email || (req.query.email as string) || undefined;
  const config = getCockpitNavConfig(userEmail);
  res.json(config);
});

// PUT /api/settings/cockpit-nav — Lưu cấu hình hiển thị các nút bấm trang chủ Executive Cockpit
settingsRouter.put("/cockpit-nav", async (req, res) => {
  try {
    const userEmail = (req as any).user?.email || (req.body?.email as string) || undefined;
    const { showAgents, showHireAgent, showKnowledge, showSettings, showSecurity } = req.body || {};
    const updated = updateCockpitNavConfig(
      {
        showAgents,
        showHireAgent,
        showKnowledge,
        showSettings,
        showSecurity,
      },
      userEmail
    );

    await logAudit({
      action: "COCKPIT_NAV_CONFIG_UPDATED",
      resultSummary: `Founder cập nhật hiển thị nút trang chủ: Agents=${updated.showAgents}, HireAgent=${updated.showHireAgent}, Knowledge=${updated.showKnowledge}, Settings=${updated.showSettings}, Security=${updated.showSecurity}`,
      riskLevel: "R1",
    });

    broadcastCompanyEvent({
      type: "SETTINGS_UPDATED" as any,
      payload: { cockpitNav: updated },
    });

    res.json({
      status: "OK",
      message: "Đã lưu cấu hình hiển thị nút trang chủ thành công!",
      config: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi cập nhật cấu hình hiển thị nút trang chủ" });
  }
});

// =========================================================================
// QUẢN TRỊ TÀI KHOẢN NGƯỜI DÙNG (ACCOUNT MANAGEMENT & RBAC)
// =========================================================================

// GET /api/settings/accounts — Lấy danh sách tài khoản hệ thống
settingsRouter.get("/accounts", async (_req, res) => {
  try {
    const accounts = await listSystemAccounts();
    res.json(accounts);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Lỗi khi lấy danh sách tài khoản" });
  }
});

// POST /api/settings/accounts — Tạo mới tài khoản
settingsRouter.post("/accounts", async (req, res) => {
  try {
    const { email, password, fullName, role } = req.body || {};
    const created = await createSystemAccount({ email, password, fullName, role });
    res.json({
      status: "OK",
      message: `Đã tạo tài khoản ${created.email} thành công!`,
      account: created,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Lỗi khi tạo tài khoản" });
  }
});

// PUT /api/settings/accounts/:id — Cập nhật thông tin / vai trò tài khoản
settingsRouter.put("/accounts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { role, fullName, status } = req.body || {};
    const updated = await updateSystemAccount(id, { role, fullName, status });
    res.json({
      status: "OK",
      message: `Đã cập nhật tài khoản ${updated.email} thành công!`,
      account: updated,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Lỗi khi cập nhật tài khoản" });
  }
});

// PUT /api/settings/accounts/:id/password — Đặt lại mật khẩu tài khoản
settingsRouter.put("/accounts/:id/password", async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body || {};
    const result = await resetSystemAccountPassword(id, password);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Lỗi khi đặt lại mật khẩu" });
  }
});

// DELETE /api/settings/accounts/:id — Xóa tài khoản
settingsRouter.delete("/accounts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteSystemAccount(id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Lỗi khi xóa tài khoản" });
  }
});

// ---- Video Generation AI Provider Settings ---------------------------------

const updateVideoSettingsSchema = z.object({
  videoGenApiUrl: z.string().trim().nullable().optional(),
  videoGenApiKey: z.string().trim().nullable().optional(),
});

// GET /api/settings/video — Lấy cấu hình dịch vụ sinh Video AI
settingsRouter.get("/video", async (_req, res) => {
  await syncVideoConfigFromDb();
  const cfg = getCachedDynamicVideoConfig();
  const url = cfg.videoGenApiUrl || process.env.VIDEO_GEN_API_URL || "";
  const rawKey = cfg.videoGenApiKey || process.env.VIDEO_GEN_API_KEY || "";

  res.json({
    videoGenApiUrl: url,
    videoGenApiKeyMasked: maskApiKey(rawKey),
    hasVideoGenApiKey: Boolean(rawKey),
    activeProvider: url ? "http" : "simulated",
  });
});

// PUT /api/settings/video — Cập nhật cấu hình dịch vụ sinh Video AI
settingsRouter.put("/video", async (req, res) => {
  const parsed = updateVideoSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dữ liệu cấu hình Video AI không hợp lệ",
      details: parsed.error.format(),
    });
  }

  const dataToUpdate: any = {};
  if (parsed.data.videoGenApiUrl !== undefined) {
    dataToUpdate.videoGenApiUrl = parsed.data.videoGenApiUrl || null;
  }
  if (parsed.data.videoGenApiKey !== undefined) {
    if (parsed.data.videoGenApiKey === "") dataToUpdate.videoGenApiKey = null;
    else if (!parsed.data.videoGenApiKey?.includes("••••")) dataToUpdate.videoGenApiKey = parsed.data.videoGenApiKey;
  }

  await (db as any).companySettings.upsert({
    where: { id: "singleton" },
    update: dataToUpdate,
    create: { id: "singleton", ...dataToUpdate },
  });

  if (dataToUpdate.videoGenApiUrl !== undefined) {
    if (dataToUpdate.videoGenApiUrl) process.env.VIDEO_GEN_API_URL = dataToUpdate.videoGenApiUrl;
    else delete process.env.VIDEO_GEN_API_URL;
  }
  if (dataToUpdate.videoGenApiKey !== undefined) {
    if (dataToUpdate.videoGenApiKey) process.env.VIDEO_GEN_API_KEY = dataToUpdate.videoGenApiKey;
    else delete process.env.VIDEO_GEN_API_KEY;
  }

  setDynamicVideoConfig(dataToUpdate);

  await logAudit({
    action: "VIDEO_SETTINGS_UPDATED",
    resultSummary: `Founder cập nhật cấu hình dịch vụ sinh Video AI (Provider: ${dataToUpdate.videoGenApiUrl ? "HTTP Adapter" : "Mô phỏng"})`,
    riskLevel: "R1",
  });

  const cfg = getCachedDynamicVideoConfig();
  const url = cfg.videoGenApiUrl || process.env.VIDEO_GEN_API_URL || "";
  const rawKey = cfg.videoGenApiKey || process.env.VIDEO_GEN_API_KEY || "";

  res.json({
    success: true,
    videoGenApiUrl: url,
    videoGenApiKeyMasked: maskApiKey(rawKey),
    hasVideoGenApiKey: Boolean(rawKey),
    activeProvider: url ? "http" : "simulated",
  });
});





