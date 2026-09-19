import dotenv from "dotenv";
import path from "path";

function reloadDotenv(): void {
  // Nạp root .env trước, sau đó services/api/.env để ghi đè (override: true)
  dotenv.config({ path: path.resolve(__dirname, "../../../.env"), override: true });
  dotenv.config({ path: path.resolve(__dirname, "../../.env"), override: true });
}

// Nạp lần đầu khi khởi động
reloadDotenv();

export type DbProvider = "postgresql" | "sqlite" | "sqlserver";
export type LlmProviderEnv = "gemini" | "openai" | "anthropic" | "custom";
export type EmbeddingProviderEnv = "openai" | "gemini" | "custom" | "builtin";
export type RiskLevelEnv = "R0" | "R1" | "R2" | "R3" | "R4";

function readDbProvider(): DbProvider {
  const raw = (process.env.DB_PROVIDER || "postgresql").toLowerCase();
  if (raw === "postgresql" || raw === "sqlite" || raw === "sqlserver") return raw;
  throw new Error(
    `DB_PROVIDER không hợp lệ: "${raw}". Chỉ chấp nhận: postgresql | sqlite | sqlserver`
  );
}

function readLlmProvider(): LlmProviderEnv | undefined {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "gemini" || raw === "openai" || raw === "anthropic" || raw === "custom") return raw;
  if (raw === "local") return "custom";
  throw new Error(
    `LLM_PROVIDER không hợp lệ: "${raw}". Chỉ chấp nhận: gemini | openai | anthropic | custom | local`
  );
}

function readEmbeddingProvider(): EmbeddingProviderEnv | undefined {
  const raw = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "gemini" || raw === "openai" || raw === "custom" || raw === "builtin") return raw;
  if (raw === "local" || raw === "tfidf" || raw === "internal") return "builtin";
  throw new Error(
    `EMBEDDING_PROVIDER không hợp lệ: "${raw}". Chỉ chấp nhận: openai | gemini | custom | builtin ` +
      "(Anthropic không có embeddings API; 'builtin' sử dụng bộ sinh vector nội bộ không tốn API key)."
  );
}

function readNotifyMinRisk(): RiskLevelEnv {
  const raw = (process.env.NOTIFY_DECISION_MIN_RISK || "R0").toUpperCase();
  if (raw === "R0" || raw === "R1" || raw === "R2" || raw === "R3" || raw === "R4") return raw;
  throw new Error(`NOTIFY_DECISION_MIN_RISK không hợp lệ: "${raw}". Chỉ chấp nhận: R0 | R1 | R2 | R3 | R4`);
}

export const env = {
  get port(): number {
    return Number(process.env.PORT || 8000);
  },
  get jwtSecret(): string {
    return process.env.JWT_SECRET || "dev-secret-change-me";
  },
  get databaseUrl(): string {
    return process.env.DATABASE_URL || "file:./data/company_os.db";
  },
  get dbProvider(): DbProvider {
    return readDbProvider();
  },
  get corsOrigin(): string {
    return process.env.CORS_ORIGIN || "http://localhost:3000";
  },
  get isProd(): boolean {
    return process.env.NODE_ENV === "production";
  },

  // LLM Multi-Provider API Keys (Live dynamic read từ .env)
  get geminiApiKey(): string {
    reloadDotenv();
    return process.env.GEMINI_API_KEY?.trim() || "";
  },
  get openaiApiKey(): string {
    reloadDotenv();
    return process.env.OPENAI_API_KEY?.trim() || "";
  },
  get anthropicApiKey(): string {
    reloadDotenv();
    return process.env.ANTHROPIC_API_KEY?.trim() || "";
  },

  // Custom / Local LLM Endpoint (Ollama, LM Studio, vLLM, LocalAI, Custom Proxy)
  get customLlmUrl(): string {
    reloadDotenv();
    return (
      process.env.CUSTOM_LLM_URL?.trim() ||
      process.env.LOCAL_LLM_URL?.trim() ||
      "http://localhost:11434/v1"
    );
  },
  get customLlmModel(): string {
    reloadDotenv();
    return (
      process.env.CUSTOM_LLM_MODEL?.trim() ||
      process.env.LOCAL_LLM_MODEL?.trim() ||
      "llama3"
    );
  },
  get customLlmApiKey(): string {
    reloadDotenv();
    return (
      process.env.CUSTOM_LLM_API_KEY?.trim() ||
      process.env.LOCAL_LLM_API_KEY?.trim() ||
      "local-key"
    );
  },

  // Embedding dedicated config (if different from LLM)
  get embeddingApiKey(): string {
    reloadDotenv();
    return (
      process.env.EMBEDDING_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.CUSTOM_LLM_API_KEY?.trim() ||
      ""
    );
  },
  get embeddingBaseUrl(): string {
    reloadDotenv();
    return (
      process.env.EMBEDDING_BASE_URL?.trim() ||
      process.env.CUSTOM_LLM_URL?.trim() ||
      ""
    );
  },
  get embeddingModel(): string {
    reloadDotenv();
    return (
      process.env.EMBEDDING_MODEL?.trim() ||
      (this.embeddingProvider === "gemini" ? "text-embedding-004" : "text-embedding-3-small")
    );
  },

  // Provider selector (gemini | openai | anthropic | custom)
  get llmProvider(): LlmProviderEnv | undefined {
    reloadDotenv();
    return readLlmProvider();
  },

  // Embedding Provider (openai | gemini | custom | builtin)
  get embeddingProvider(): EmbeddingProviderEnv | undefined {
    reloadDotenv();
    return readEmbeddingProvider();
  },

  // Model Name Overrides
  get geminiModel(): string {
    return process.env.GEMINI_MODEL?.trim() || "gemini-1.5-pro";
  },
  get openaiModel(): string {
    return process.env.OPENAI_MODEL?.trim() || "gpt-4o";
  },
  get anthropicModel(): string {
    return process.env.ANTHROPIC_MODEL?.trim() || "claude-3-5-sonnet-20241022";
  },
  get orchestratorModel(): string {
    return process.env.ORCHESTRATOR_MODEL?.trim() || "";
  },
  get agentWorkerPollMs(): number {
    return Number(process.env.AGENT_WORKER_POLL_MS || 2000);
  },

  // Model Cost (USD per 1 Million Tokens)
  get costInputPerMTok(): number {
    return Number(process.env.MODEL_INPUT_COST_PER_MTOK || 3);
  },
  get costOutputPerMTok(): number {
    return Number(process.env.MODEL_OUTPUT_COST_PER_MTOK || 15);
  },

  // Retry — số lần thử lại cho lỗi transient trước khi switch sang fallback model
  get llmMaxRetries(): number {
    return parseInt(
      process.env.LLM_MAX_RETRIES ?? process.env.GEMINI_MAX_RETRIES ?? "1",
      10
    );
  },
  get llmRetryBaseMs(): number {
    return parseInt(
      process.env.LLM_RETRY_BASE_MS ?? process.env.GEMINI_RETRY_BASE_MS ?? "1000",
      10
    );
  },
  get llmRetryMaxMs(): number {
    return parseInt(
      process.env.LLM_RETRY_MAX_MS ?? process.env.GEMINI_RETRY_MAX_MS ?? "8000",
      10
    );
  },

  // ---- Notification Channel (Telegram / Email) ------------------------------
  get telegramBotToken(): string {
    reloadDotenv();
    return process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  },
  get telegramChatId(): string {
    reloadDotenv();
    return process.env.TELEGRAM_CHAT_ID?.trim() || "";
  },
  get smtpHost(): string {
    reloadDotenv();
    return process.env.SMTP_HOST?.trim() || "";
  },
  get smtpPort(): number {
    return Number(process.env.SMTP_PORT || 587);
  },
  get smtpUser(): string {
    reloadDotenv();
    return process.env.SMTP_USER?.trim() || "";
  },
  get smtpPass(): string {
    reloadDotenv();
    return process.env.SMTP_PASS?.trim() || "";
  },
  get smtpFrom(): string {
    return process.env.SMTP_FROM?.trim() || "";
  },
  get founderNotifyEmail(): string {
    reloadDotenv();
    return process.env.FOUNDER_NOTIFY_EMAIL?.trim() || "";
  },
  get zaloNotifyPhone(): string {
    reloadDotenv();
    return process.env.ZALO_NOTIFY_PHONE?.trim() || "";
  },
  get zaloNotifyGroupId(): string {
    reloadDotenv();
    return process.env.ZALO_NOTIFY_GROUP_ID?.trim() || "";
  },
  /** Ngưỡng risk tối thiểu để báo khi có Decision Package mới. Mặc định R0 = báo tất cả. */
  get notifyDecisionMinRisk(): RiskLevelEnv {
    return readNotifyMinRisk();
  },
  /** Task BLOCKED quá bao nhiêu phút thì báo Founder (chỉ báo 1 lần/task). */
  get blockedTaskAlertMinutes(): number {
    return Number(process.env.BLOCKED_TASK_ALERT_MINUTES || 30);
  },
  /** Chu kỳ chạy PeriodicJobs (blocked task check + weekly report check), ms. */
  get periodicJobsIntervalMs(): number {
    return Number(process.env.PERIODIC_JOBS_INTERVAL_MS || 10 * 60 * 1000); // mặc định 10 phút
  },

  // ---- Google OAuth / Identity Services ------------------------------------
  get googleClientId(): string {
    reloadDotenv();
    return (
      process.env.GOOGLE_CLIENT_ID?.trim() ||
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ||
      ""
    );
  },

  // ---- SLA / Escalation Timeout ---------------------------------------------
  /** Task RUNNING quá bao nhiêu phút thì coi là "treo" -> tự ESCALATED. */
  get slaTaskRunningMinutes(): number {
    return Number(process.env.SLA_TASK_RUNNING_MINUTES || 20);
  },
  /** Decision Package PENDING quá bao nhiêu phút thì nhắc Founder (nhắc lại định kỳ theo đúng chu kỳ này). */
  get slaDecisionPendingMinutes(): number {
    return Number(process.env.SLA_DECISION_PENDING_MINUTES || 60);
  },
};
