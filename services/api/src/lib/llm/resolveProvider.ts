/**
 * Tự động resolve LLM Provider + Model từ Cấu hình động trong Database (CompanySettings)
 * và Fallback về các biến trong .env, kèm danh sách Fallback Models & Multi-Provider Failover khi gặp 503/429.
 */
import { env } from "../../config/env";
import { db } from "../../db/client";
import type { LlmProvider, ResolvedLlm } from "./types";

export interface DynamicLlmConfig {
  llmProvider?: string | null;
  geminiApiKey?: string | null;
  openaiApiKey?: string | null;
  anthropicApiKey?: string | null;
  customLlmUrl?: string | null;
  customLlmApiKey?: string | null;
  orchestratorModel?: string | null;
  temperature?: number | null;
}

let cachedDynamicConfig: DynamicLlmConfig | null = null;

export function setDynamicLlmConfig(cfg: Partial<DynamicLlmConfig>): void {
  cachedDynamicConfig = {
    ...(cachedDynamicConfig || {}),
    ...cfg,
  };
}

export function getCachedDynamicLlmConfig(): DynamicLlmConfig {
  return cachedDynamicConfig || {};
}

/** Tải cấu hình từ database vào in-memory cache */
export async function syncLlmConfigFromDb(): Promise<DynamicLlmConfig> {
  try {
    const settings = await db.companySettings.findUnique({ where: { id: "singleton" } });
    if (settings) {
      cachedDynamicConfig = {
        llmProvider: settings.llmProvider,
        geminiApiKey: settings.geminiApiKey,
        openaiApiKey: settings.openaiApiKey,
        anthropicApiKey: settings.anthropicApiKey,
        customLlmUrl: settings.customLlmUrl,
        customLlmApiKey: settings.customLlmApiKey,
        orchestratorModel: settings.orchestratorModel,
        temperature: settings.temperature,
      };
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[LLM Gateway] Không thể đọc cấu hình LLM từ DB:", err);
  }
  return cachedDynamicConfig || {};
}

export function getEffectiveLlmConfig(override?: Partial<DynamicLlmConfig>): DynamicLlmConfig {
  const dynamic = { ...(cachedDynamicConfig || {}), ...(override || {}) };

  return {
    llmProvider: dynamic.llmProvider ?? (env.llmProvider || null),
    geminiApiKey: dynamic.geminiApiKey || env.geminiApiKey || null,
    openaiApiKey: dynamic.openaiApiKey || env.openaiApiKey || null,
    anthropicApiKey: dynamic.anthropicApiKey || env.anthropicApiKey || null,
    customLlmUrl: dynamic.customLlmUrl || env.customLlmUrl || null,
    customLlmApiKey: dynamic.customLlmApiKey || env.customLlmApiKey || null,
    orchestratorModel: dynamic.orchestratorModel || env.orchestratorModel || null,
    temperature: dynamic.temperature ?? 0.2,
  };
}

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  gemini: "gemini-3.7-flash",
  openai: "gpt-4o",
  anthropic: "claude-3-5-sonnet-20241022",
  custom: "auto",
};

/**
 * Danh sách model dự phòng khi model chính quá tải (503/429).
 */
export const FALLBACK_MODELS: Record<LlmProvider, string[]> = {
  gemini: [
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-pro-preview",
  ],
  openai: ["gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-3-5-haiku-20241022", "claude-3-haiku-20240307"],
  custom: [],
};

export function resolveLlm(override?: Partial<DynamicLlmConfig>): ResolvedLlm | null {
  const cfg = getEffectiveLlmConfig(override);

  // 1. Nếu có chỉ định rõ LLM_PROVIDER
  if (cfg.llmProvider && cfg.llmProvider !== "auto") {
    const provider = cfg.llmProvider as LlmProvider;

    if (provider === "custom") {
      const baseUrl = cfg.customLlmUrl || "http://localhost:11434/v1";
      const model = cfg.orchestratorModel || DEFAULT_MODELS.custom;
      return {
        provider: "custom",
        model,
        apiKey: cfg.customLlmApiKey || undefined,
        baseUrl,
        auto: !cfg.orchestratorModel,
      };
    }

    let apiKey = "";
    let keyVarName = "";

    if (provider === "gemini") {
      apiKey = cfg.geminiApiKey || "";
      keyVarName = "Gemini API Key";
    } else if (provider === "openai") {
      apiKey = cfg.openaiApiKey || "";
      keyVarName = "OpenAI API Key";
    } else if (provider === "anthropic") {
      apiKey = cfg.anthropicApiKey || "";
      keyVarName = "Anthropic API Key";
    }

    if (!apiKey) {
      throw new Error(
        `Nhà cung cấp "${provider}" được chọn nhưng chưa cấu hình ${keyVarName}. Vui lòng nhập key trong Cài đặt hoặc .env`
      );
    }

    const model = cfg.orchestratorModel || DEFAULT_MODELS[provider];
    return {
      provider,
      model,
      apiKey,
      auto: !cfg.orchestratorModel,
    };
  }

  // 2. Auto-detect theo key / endpoint có sẵn (Ưu tiên: Custom -> Gemini -> OpenAI -> Anthropic)
  if (cfg.customLlmUrl) {
    return {
      provider: "custom",
      model: cfg.orchestratorModel || DEFAULT_MODELS.custom,
      apiKey: cfg.customLlmApiKey || undefined,
      baseUrl: cfg.customLlmUrl,
      auto: !cfg.orchestratorModel,
    };
  }

  if (cfg.geminiApiKey) {
    return {
      provider: "gemini",
      model: cfg.orchestratorModel || DEFAULT_MODELS.gemini,
      apiKey: cfg.geminiApiKey,
      auto: !cfg.orchestratorModel,
    };
  }

  if (cfg.openaiApiKey) {
    return {
      provider: "openai",
      model: cfg.orchestratorModel || DEFAULT_MODELS.openai,
      apiKey: cfg.openaiApiKey,
      auto: !cfg.orchestratorModel,
    };
  }

  if (cfg.anthropicApiKey) {
    return {
      provider: "anthropic",
      model: cfg.orchestratorModel || DEFAULT_MODELS.anthropic,
      apiKey: cfg.anthropicApiKey,
      auto: !cfg.orchestratorModel,
    };
  }

  // 3. Không có key hoặc endpoint nào
  return null;
}

/** Lấy toàn bộ danh sách các provider có cấu hình hợp lệ */
export function getAllAvailableProviders(override?: Partial<DynamicLlmConfig>): ResolvedLlm[] {
  const cfg = getEffectiveLlmConfig(override);
  const providers: ResolvedLlm[] = [];
  const added = new Set<string>();

  // 1. Primary provider được ưu tiên trước
  const primary = resolveLlm(override);
  if (primary) {
    providers.push(primary);
    added.add(primary.provider);
  }

  // 2. Các provider khác đóng vai trò failover nếu primary gặp sự cố
  if (cfg.customLlmUrl && !added.has("custom")) {
    providers.push({
      provider: "custom",
      model: cfg.orchestratorModel || DEFAULT_MODELS.custom,
      apiKey: cfg.customLlmApiKey || undefined,
      baseUrl: cfg.customLlmUrl,
      auto: !cfg.orchestratorModel,
    });
    added.add("custom");
  }

  if (cfg.geminiApiKey && !added.has("gemini")) {
    providers.push({
      provider: "gemini",
      model: cfg.orchestratorModel || DEFAULT_MODELS.gemini,
      apiKey: cfg.geminiApiKey,
      auto: true,
    });
    added.add("gemini");
  }

  if (cfg.openaiApiKey && !added.has("openai")) {
    providers.push({
      provider: "openai",
      model: cfg.orchestratorModel || DEFAULT_MODELS.openai,
      apiKey: cfg.openaiApiKey,
      auto: true,
    });
    added.add("openai");
  }

  if (cfg.anthropicApiKey && !added.has("anthropic")) {
    providers.push({
      provider: "anthropic",
      model: cfg.orchestratorModel || DEFAULT_MODELS.anthropic,
      apiKey: cfg.anthropicApiKey,
      auto: true,
    });
    added.add("anthropic");
  }

  return providers;
}

/** Lấy danh sách các model candidates (gồm primary model và các fallback model) */
export function getModelCandidates(resolved: ResolvedLlm): string[] {
  const fallbacks = FALLBACK_MODELS[resolved.provider] ?? [];
  const list = [resolved.model, ...fallbacks];
  return Array.from(new Set(list));
}

/** Kiểm tra xem ít nhất 1 LLM API Key hoặc Local URL đã được cấu hình hay chưa */
export function isLlmConfigured(override?: Partial<DynamicLlmConfig>): boolean {
  return resolveLlm(override) !== null;
}

/** Chuỗi mô tả trạng thái LLM hiện tại (dùng cho log / audit / settings) */
export function getLlmStatusDescription(override?: Partial<DynamicLlmConfig>): string {
  const resolved = resolveLlm(override);
  if (!resolved) {
    return "Chưa cấu hình LLM (Gemini / OpenAI / Anthropic / Custom URL)";
  }
  const endpointInfo = resolved.baseUrl ? ` @ ${resolved.baseUrl}` : "";
  return `${resolved.provider.toUpperCase()} (${resolved.model}${endpointInfo})${resolved.auto ? " [auto]" : " [cố định]"}`;
}
