import dotenv from "dotenv";
import path from "path";
import fs from "fs";

export function resolveDataDir(): string {
  if (process.env.AI_OPC_DATA_DIR) {
    const custom = process.env.AI_OPC_DATA_DIR;
    if (!fs.existsSync(custom)) {
      try {
        fs.mkdirSync(custom, { recursive: true });
      } catch {}
    }
    return custom;
  }

  const isPackaged = Boolean((process as any).pkg) || !process.execPath.toLowerCase().endsWith("node.exe");
  if (isPackaged || process.env.APPDATA) {
    const baseDir =
      process.env.APPDATA ||
      (process.env.HOME ? path.join(process.env.HOME, ".ai-opc") : path.resolve(process.cwd(), "data"));
    const appDataDir = path.join(baseDir, "AI-OPC", "data");
    if (!fs.existsSync(appDataDir)) {
      try {
        fs.mkdirSync(appDataDir, { recursive: true });
      } catch {}
    }
    return appDataDir;
  }

  const localData = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(localData)) {
    try {
      fs.mkdirSync(localData, { recursive: true });
    } catch {}
  }
  return localData;
}

function reloadDotenv(): void {
  // 1. Nạp .env từ user writable data directory nếu có (cho Desktop App)
  try {
    const userEnv = path.join(resolveDataDir(), ".env");
    if (fs.existsSync(userEnv)) {
      dotenv.config({ path: userEnv, override: true });
    }
  } catch {}

  // 2. Nạp root .env trước, sau đó services/api/.env để ghi đè (override: true)
  dotenv.config({ path: path.resolve(__dirname, "../../../.env"), override: true });
  dotenv.config({ path: path.resolve(__dirname, "../../.env"), override: true });
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });
  try {
    dotenv.config({ path: path.resolve(path.dirname(process.execPath), ".env"), override: true });
  } catch {}
}

// Nạp lần đầu khi khởi động
reloadDotenv();

// Tự động định vị Prisma Query Engine Native Library nếu đang chạy packaged binary
if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  const engineCandidates = [
    path.resolve(path.dirname(process.execPath), "query_engine-windows.dll.node"),
    path.resolve(path.dirname(process.execPath), "resources", "query_engine-windows.dll.node"),
    path.resolve(path.dirname(process.execPath), "binaries", "query_engine-windows.dll.node"),
    path.resolve(path.dirname(process.execPath), "../resources", "query_engine-windows.dll.node"),
    path.resolve(process.cwd(), "query_engine-windows.dll.node"),
    path.resolve(process.cwd(), "resources", "query_engine-windows.dll.node"),
    path.resolve(process.cwd(), "binaries", "query_engine-windows.dll.node"),
    path.resolve(__dirname, "../../node_modules/.prisma/client-sqlite/query_engine-windows.dll.node"),
  ];
  for (const p of engineCandidates) {
    try {
      if (fs.existsSync(p)) {
        process.env.PRISMA_QUERY_ENGINE_LIBRARY = p;
        break;
      }
    } catch {}
  }
}

export type DbProvider = "postgresql" | "sqlite" | "sqlserver";
export type LlmProviderEnv = "gemini" | "openai" | "anthropic" | "custom";
export type EmbeddingProviderEnv = "openai" | "gemini" | "custom" | "builtin";
export type RiskLevelEnv = "R0" | "R1" | "R2" | "R3" | "R4";

function readDbProvider(): DbProvider {
  // Nếu đang chạy trong môi trường packaged standalone binary hoặc desktop sidecar
  const isPackaged = Boolean((process as any).pkg) || !process.execPath.toLowerCase().endsWith("node.exe");
  if (isPackaged && !process.env.AI_OPC_FORCE_DB_PROVIDER) {
    return "sqlite";
  }
  const raw = (process.env.DB_PROVIDER || "sqlite").toLowerCase();
  if (raw === "postgresql" || raw === "sqlite" || raw === "sqlserver") return raw;
  return "sqlite";
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
  get dataDir(): string {
    return resolveDataDir();
  },
  get port(): number {
    return Number(process.env.PORT || 8000);
  },
  get jwtSecret(): string {
    return process.env.JWT_SECRET || "dev-secret-change-me";
  },
  get databaseUrl(): string {
    if (this.dbProvider === "sqlite") {
      // Nếu có DATABASE_URL hợp lệ bắt đầu bằng file:
      if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("file:")) {
        return process.env.DATABASE_URL;
      }
      // Tự động phân giải đường dẫn SQLite trong writable dataDir
      try {
        const dataDir = resolveDataDir();
        const dbFile = path.join(dataDir, "company_os.db");
        if (!fs.existsSync(dbFile) || fs.statSync(dbFile).size === 0) {
          const candidates = [
            path.resolve(process.cwd(), "resources/binaries/data/company_os.db"),
            path.resolve(process.cwd(), "resources/data/company_os.db"),
            path.resolve(process.cwd(), "binaries/data/company_os.db"),
            path.resolve(process.cwd(), "data/company_os.db"),
            path.resolve(path.dirname(process.execPath), "data/company_os.db"),
            path.resolve(path.dirname(process.execPath), "resources/data/company_os.db"),
            path.resolve(path.dirname(process.execPath), "binaries/data/company_os.db"),
            path.resolve(path.dirname(process.execPath), "../resources/data/company_os.db"),
            path.resolve(path.dirname(process.execPath), "../resources/binaries/data/company_os.db"),
            path.resolve(__dirname, "../db/prisma/data/company_os.db"),
            path.resolve(__dirname, "../../src/db/prisma/data/company_os.db"),
            path.resolve(__dirname, "../../data/company_os.db"),
          ];
          for (const cand of candidates) {
            try {
              if (fs.existsSync(cand) && fs.statSync(cand).size > 0) {
                fs.copyFileSync(cand, dbFile);
                console.log(`[env] Khởi tạo cơ sở dữ liệu từ mẫu: ${cand} -> ${dbFile}`);
                break;
              }
            } catch {}
          }
        }
        const finalUrl = `file:${dbFile.replace(/\\/g, "/")}`;
        process.env.DATABASE_URL = finalUrl;
        return finalUrl;
      } catch (err) {
        console.error("[env] Lỗi cấu hình SQLite path:", err);
      }
      const fallbackUrl = "file:./data/company_os.db";
      process.env.DATABASE_URL = fallbackUrl;
      return fallbackUrl;
    }

    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    return "file:./data/company_os.db";
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
      (this.embeddingProvider === "gemini" ? "gemini-embedding-001" : "text-embedding-3-small")
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
  get llmTimeoutMs(): number {
    return Math.max(
      10000,
      parseInt(process.env.LLM_TIMEOUT_MS ?? "90000", 10) || 90000
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
  get zaloAdminIds(): string[] {
    reloadDotenv();
    const raw = process.env.ZALO_ADMIN_IDS?.trim() || "";
    if (!raw) return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
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

  // ---- Telegram Inbound (long polling nhận lệnh Founder Command) ------------
  get telegramPollMs(): number {
    return Number(process.env.TELEGRAM_POLL_MS || 2000); // mặc định 2 giây — phản hồi nhanh
  },

  // ---- Zalo Bot Platform (bot.zaloplatforms.com) -----------------------------
  get zaloBotToken(): string {
    reloadDotenv();
    return process.env.ZALO_BOT_TOKEN?.trim() || "";
  },
  get zaloChatId(): string {
    reloadDotenv();
    return process.env.ZALO_CHAT_ID?.trim() || "";
  },
  get zaloPollMs(): number {
    return Number(process.env.ZALO_POLL_MS || 2000); // mặc định 2 giây — long-polling nhanh
  },
};
