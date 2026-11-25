import fs from "fs";
import path from "path";
import { env, resolveDataDir } from "../../config/env";

export interface AuthChannelsConfig {
  googleLoginEnabled: boolean;
  googleClientId: string;
  googleConfigured: boolean;
  zaloLoginEnabled: boolean;
}

let cachedAuthChannelsConfig: AuthChannelsConfig | null = null;

function getConfigFile(): string {
  const dataDir = resolveDataDir();
  return path.join(dataDir, "auth_channels.json");
}

function getSafeEnvFilePaths(): string[] {
  const paths: string[] = [];

  // 1. Data dir .env
  try {
    paths.push(path.join(resolveDataDir(), ".env"));
  } catch {}

  // 2. Dev candidiate .env files
  const devCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "../../../.env"),
    path.resolve(__dirname, "../../.env"),
    path.resolve(process.cwd(), "services/api/.env"),
  ];

  for (const cand of devCandidates) {
    try {
      if (fs.existsSync(cand)) {
        paths.push(cand);
      }
    } catch {}
  }

  return Array.from(new Set(paths));
}

function updateEnvFile(filePath: string, key: string, value: string): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `${key}=${value}\n`, "utf-8");
      return;
    }

    let content = fs.readFileSync(filePath, "utf-8");
    const regex = new RegExp(`^#?\\s*${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
    fs.writeFileSync(filePath, content, "utf-8");
  } catch (err: any) {
    console.warn(`[authChannelsConfig] Không thể cập nhật file ${filePath}:`, err?.message || err);
  }
}

export function getAuthChannelsConfig(): AuthChannelsConfig {
  const filePath = getConfigFile();
  let fileData: Partial<AuthChannelsConfig> = {};

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      fileData = JSON.parse(raw);
    } catch (err) {
      console.warn("[authChannelsConfig] Lỗi đọc auth_channels.json:", err);
    }
  }

  const fallbackClientId = env.googleClientId || "";
  const googleClientId =
    typeof fileData.googleClientId === "string"
      ? fileData.googleClientId.trim()
      : fallbackClientId;

  // Mặc định bật nếu có Client ID hoặc trường googleLoginEnabled chưa từng bị tắt rõ ràng
  const googleLoginEnabled =
    typeof fileData.googleLoginEnabled === "boolean"
      ? fileData.googleLoginEnabled
      : Boolean(fallbackClientId);

  // Mặc định bật Zalo Login nếu chưa từng bị tắt rõ ràng
  const zaloLoginEnabled =
    typeof fileData.zaloLoginEnabled === "boolean"
      ? fileData.zaloLoginEnabled
      : true;

  const config: AuthChannelsConfig = {
    googleLoginEnabled,
    googleClientId,
    googleConfigured: Boolean(googleLoginEnabled && googleClientId),
    zaloLoginEnabled,
  };

  cachedAuthChannelsConfig = config;
  return { ...config };
}

export function updateAuthChannelsConfig(partial: {
  googleLoginEnabled?: boolean;
  googleClientId?: string | null;
  zaloLoginEnabled?: boolean;
}): AuthChannelsConfig {
  const current = getAuthChannelsConfig();

  const nextGoogleLoginEnabled =
    partial.googleLoginEnabled !== undefined
      ? Boolean(partial.googleLoginEnabled)
      : current.googleLoginEnabled;

  const nextGoogleClientId =
    partial.googleClientId !== undefined && partial.googleClientId !== null
      ? partial.googleClientId.trim()
      : current.googleClientId;

  const nextZaloLoginEnabled =
    partial.zaloLoginEnabled !== undefined
      ? Boolean(partial.zaloLoginEnabled)
      : current.zaloLoginEnabled;

  const updated: AuthChannelsConfig = {
    googleLoginEnabled: nextGoogleLoginEnabled,
    googleClientId: nextGoogleClientId,
    googleConfigured: Boolean(nextGoogleLoginEnabled && nextGoogleClientId),
    zaloLoginEnabled: nextZaloLoginEnabled,
  };

  // 1. Ghi file auth_channels.json
  try {
    const filePath = getConfigFile();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf-8");
  } catch (err) {
    console.error("[authChannelsConfig] Lỗi ghi auth_channels.json:", err);
  }

  // 2. Đồng bộ vào process.env runtime
  process.env.GOOGLE_CLIENT_ID = nextGoogleClientId;

  // 3. Ghi đè vào các file .env liên quan (đặc biệt services/api/.env)
  if (partial.googleClientId !== undefined && partial.googleClientId !== null) {
    const envPaths = getSafeEnvFilePaths();
    for (const p of envPaths) {
      updateEnvFile(p, "GOOGLE_CLIENT_ID", nextGoogleClientId);
    }
  }

  cachedAuthChannelsConfig = updated;
  return { ...updated };
}
