/**
 * Video generation provider — lớp trừu tượng để Agent sinh video mà không
 * phụ thuộc 1 nhà cung cấp cụ thể.
 *
 * Mặc định: "simulated" — KHÔNG sinh video thật, không tốn tiền; chỉ trả job
 * giả để chạy thử toàn bộ luồng (IDEA → … → REVIEW). Video ở chế độ này có
 * assetUrl = null và được ghi chú rõ ràng trong `notes`.
 *
 * Provider thật: đặt VIDEO_GEN_API_URL (+ VIDEO_GEN_API_KEY) để dùng provider
 * "http" — một HTTP adapter tối giản theo hợp đồng bên dưới. Các dịch vụ cụ
 * thể (Veo, Runway, Kling, ...) có API khác nhau, nên cần một service trung
 * gian/adaptor nói đúng hợp đồng này (hoặc viết thêm 1 provider ở file này).
 *
 *   POST {VIDEO_GEN_API_URL}                 body: SubmitRequest
 *        → { jobId, status: "PROCESSING"|"DONE"|"FAILED", assetUrl?, thumbnailUrl?, costUsd?, error? }
 *   GET  {VIDEO_GEN_API_URL}/{jobId}         → cùng schema phản hồi
 */
import { randomUUID } from "crypto";
import { db } from "../../db/client";

export interface DynamicVideoConfig {
  videoGenApiUrl?: string | null;
  videoGenApiKey?: string | null;
}

let cachedVideoConfig: DynamicVideoConfig | null = null;

export function setDynamicVideoConfig(cfg: Partial<DynamicVideoConfig>): void {
  cachedVideoConfig = {
    ...(cachedVideoConfig || {}),
    ...cfg,
  };
}

export function getCachedDynamicVideoConfig(): DynamicVideoConfig {
  return cachedVideoConfig || {};
}

export async function syncVideoConfigFromDb(): Promise<DynamicVideoConfig> {
  try {
    const settings = await (db as any).companySettings.findUnique({ where: { id: "singleton" } });
    if (settings) {
      cachedVideoConfig = {
        videoGenApiUrl: settings.videoGenApiUrl ?? null,
        videoGenApiKey: settings.videoGenApiKey ?? null,
      };
      if (settings.videoGenApiUrl) process.env.VIDEO_GEN_API_URL = settings.videoGenApiUrl;
      if (settings.videoGenApiKey) process.env.VIDEO_GEN_API_KEY = settings.videoGenApiKey;
    }
  } catch (err: any) {
    // Không crash nếu DB hoặc cột chưa sẵn sàng
  }
  return cachedVideoConfig || {};
}

export interface SubmitRequest {
  videoId: string;
  prompt: string;
  script?: string | null;
  durationSec?: number | null;
  aspectRatio: string;
}

export interface ProviderResult {
  provider: string;
  jobId: string;
  status: "PROCESSING" | "DONE" | "FAILED";
  assetUrl?: string | null;
  thumbnailUrl?: string | null;
  costUsd?: number;
  error?: string;
  simulated?: boolean;
}

export interface VideoProvider {
  readonly name: string;
  submit(req: SubmitRequest): Promise<ProviderResult>;
  refresh(jobId: string): Promise<ProviderResult>;
}

class SimulatedProvider implements VideoProvider {
  readonly name = "simulated";

  async submit(req: SubmitRequest): Promise<ProviderResult> {
    return {
      provider: this.name,
      jobId: `sim_${randomUUID().slice(0, 8)}`,
      status: "DONE",
      assetUrl: null,
      costUsd: 0,
      simulated: true,
    };
  }

  async refresh(jobId: string): Promise<ProviderResult> {
    return { provider: this.name, jobId, status: "DONE", assetUrl: null, costUsd: 0, simulated: true };
  }
}

class HttpProvider implements VideoProvider {
  readonly name = "http";

  constructor(private readonly baseUrl: string, private readonly apiKey?: string) { }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  private normalize(data: any, fallbackJobId: string): ProviderResult {
    const status = String(data?.status ?? "PROCESSING").toUpperCase();
    return {
      provider: this.name,
      jobId: String(data?.jobId ?? fallbackJobId),
      status: status === "DONE" || status === "FAILED" ? status : "PROCESSING",
      assetUrl: data?.assetUrl ?? null,
      thumbnailUrl: data?.thumbnailUrl ?? null,
      costUsd: typeof data?.costUsd === "number" ? data.costUsd : 0,
      error: data?.error ? String(data.error) : undefined,
    };
  }

  async submit(req: SubmitRequest): Promise<ProviderResult> {
    const res = await fetch(this.baseUrl, { method: "POST", headers: this.headers(), body: JSON.stringify(req) });
    if (!res.ok) throw new Error(`Video provider HTTP ${res.status}`);
    return this.normalize(await res.json(), `job_${randomUUID().slice(0, 8)}`);
  }

  async refresh(jobId: string): Promise<ProviderResult> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/${encodeURIComponent(jobId)}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Video provider HTTP ${res.status}`);
    return this.normalize(await res.json(), jobId);
  }
}

export function getVideoProvider(): VideoProvider {
  const dynamic = getCachedDynamicVideoConfig();
  const url = dynamic.videoGenApiUrl || process.env.VIDEO_GEN_API_URL;
  const key = dynamic.videoGenApiKey || process.env.VIDEO_GEN_API_KEY;
  if (url) return new HttpProvider(url, key);
  return new SimulatedProvider();
}
