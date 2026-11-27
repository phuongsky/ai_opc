/**
 * API client — tất cả fetch calls tới Core Engine.
 * Token được lưu trong localStorage (key: "aiopc_token") và gửi qua
 * Authorization header. Khi server trả 401, tự redirect về /login.
 */

const FALLBACK_HOSTS = ["http://127.0.0.1:8000", "http://localhost:8000"];

function resolveInitialApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("aiopc_api_host");
    if (saved && FALLBACK_HOSTS.includes(saved)) return saved;
  }
  // Mặc định ưu tiên 127.0.0.1 trên desktop để tránh lỗi IPv6 DNS resolution của localhost trên Windows
  return "http://127.0.0.1:8000";
}

let activeApiHost = resolveInitialApiBase();
export const API_BASE = activeApiHost;

const originalFetch =
  typeof globalThis !== "undefined" && typeof globalThis.fetch === "function"
    ? globalThis.fetch.bind(globalThis)
    : (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init);

/**
 * Smart Fetch Client:
 * 1. Tự động luân chuyển giữa 127.0.0.1 và localhost khi gặp lỗi kết nối (Failed to fetch).
 * 2. Tự động chờ và thử lại tối đa 6 lượt (mỗi lượt 1s) khi Backend Sidecar đang khởi động.
 * 3. Ghi nhớ host hoạt động tốt nhất vào localStorage để tăng tốc các yêu cầu tiếp theo.
 */
async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
  let lastError: any = null;
  const maxRetries = 6;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Sắp xếp các host: host đang active đứng đầu
    const candidateHosts = [activeApiHost, ...FALLBACK_HOSTS.filter((h) => h !== activeApiHost)];

    for (const host of candidateHosts) {
      let targetInput = input;
      if (urlStr) {
        for (const altHost of FALLBACK_HOSTS) {
          if (urlStr.startsWith(altHost)) {
            const pathSuffix = urlStr.substring(altHost.length);
            targetInput = `${host}${pathSuffix}`;
            break;
          }
        }
      }

      try {
        const res = await originalFetch(targetInput, init);
        if (host !== activeApiHost) {
          activeApiHost = host;
          if (typeof window !== "undefined") {
            try {
              localStorage.setItem("aiopc_api_host", host);
            } catch {}
          }
        }
        return res;
      } catch (err: any) {
        lastError = err;
        // Chỉ thử lại với lỗi mạng (Failed to fetch / Connection refused)
        const isNetworkErr = err?.name === "TypeError" || String(err?.message || "").toLowerCase().includes("fetch");
        if (!isNetworkErr) {
          throw err;
        }
      }
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  throw lastError || new Error("Failed to fetch");
}

const fetch = fetchWithRetry;

// ---- Token helpers -----------------------------------------------------

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("aiopc_token");
}

export function setToken(token: string): void {
  localStorage.setItem("aiopc_token", token);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("aiopc_token");
    localStorage.clear();
    sessionStorage.clear();
    // Xóa tất cả cookie của trình duyệt
    const cookies = document.cookie.split(";");
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i];
      const eqPos = cookie.indexOf("=");
      const name = eqPos > -1 ? cookie.substring(0, eqPos).trim() : cookie.trim();
      if (name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;`;
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=${window.location.hostname};`;
      }
    }
  } catch (err) {
    console.error("[Auth] Lỗi dọn dẹp storage và cookie:", err);
  }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function handleResponse(res: Response) {
  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---- Auth --------------------------------------------------------------

export interface AuthChannelsConfig {
  googleLoginEnabled: boolean;
  googleClientId: string;
  googleConfigured: boolean;
  zaloLoginEnabled: boolean;
}

export async function fetchAuthConfig(): Promise<AuthChannelsConfig> {
  const res = await fetch(`${API_BASE}/api/auth/config`);
  if (!res.ok) {
    return { googleLoginEnabled: false, googleClientId: "", googleConfigured: false, zaloLoginEnabled: true };
  }
  return res.json() as Promise<AuthChannelsConfig>;
}

export async function fetchAuthChannelsSettings(): Promise<AuthChannelsConfig> {
  const res = await fetch(`${API_BASE}/api/settings/auth-channels`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function updateAuthChannelsSettings(payload: {
  googleLoginEnabled: boolean;
  googleClientId: string;
  zaloLoginEnabled?: boolean;
}): Promise<{ status: string; message: string; config: AuthChannelsConfig }> {
  const res = await fetch(`${API_BASE}/api/settings/auth-channels`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function loginWithGoogle(credentialOrIdToken: string) {
  const res = await fetch(`${API_BASE}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential: credentialOrIdToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Đăng nhập Google thất bại");
  }
  return res.json() as Promise<{
    status: "OK";
    token: string;
    founder: { id: string; email: string; name?: string; picture?: string };
    totpEnabled: boolean;
  }>;
}

export async function checkZaloAuthSession(sessionId?: string) {
  const url = new URL(`${API_BASE}/api/auth/zalo/check-session`);
  if (sessionId) url.searchParams.set("sessionId", sessionId);
  const res = await fetch(url.toString(), {
    credentials: "include",
  });
  if (!res.ok) return { authenticated: false };
  return res.json() as Promise<{
    authenticated: boolean;
    token?: string;
    founder?: { id: string; email: string };
    userId?: string;
    receivedAt?: string;
  }>;
}

export async function loginWithZaloManual(payload: any) {
  const res = await fetch(`${API_BASE}/api/auth/zalo/manual-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Đăng nhập Zalo thất bại");
  }
  return res.json() as Promise<{
    status: "OK";
    token: string;
    founder: { id: string; email: string };
    userId: string;
  }>;
}

export async function fetchZaloStatus() {
  const res = await fetch(`${API_BASE}/api/auth/zalo/status`);
  if (!res.ok) return { connected: false, uid: null, imei: null, lastReceived: null };
  return res.json() as Promise<{
    connected: boolean;
    uid: string | null;
    imei: string | null;
    lastReceived: string | null;
  }>;
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Đăng nhập thất bại");
  }
  return res.json() as Promise<
    | { status: "OK"; token: string; totpEnabled: boolean }
    | { status: "2FA_REQUIRED"; pendingToken: string }
  >;
}

export async function verify2fa(pendingToken: string, code: string) {
  const res = await fetch(`${API_BASE}/api/auth/verify-2fa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendingToken, code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Mã 2FA không đúng");
  }
  return res.json() as Promise<{ status: "OK"; token: string }>;
}

export async function fetchMe() {
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
  return handleResponse(res) as Promise<{ id: string; email: string; role?: string; totpEnabled: boolean }>;
}

export async function logout() {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      headers: authHeaders(),
      credentials: "include",
    });
  } catch (err) {
    console.warn("[Auth] Server logout request failed:", err);
  } finally {
    clearToken();
  }
}

// ---- 2FA setup ---------------------------------------------------------

export async function setup2fa() {
  const res = await fetch(`${API_BASE}/api/auth/setup-2fa`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res) as Promise<{ secret: string; otpauth: string; qrDataUrl: string }>;
}

export async function enable2fa(code: string) {
  const res = await fetch(`${API_BASE}/api/auth/enable-2fa`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ code }),
  });
  return handleResponse(res) as Promise<{ status: string; totpEnabled: boolean }>;
}

// ---- Commands ----------------------------------------------------------

export async function sendFounderCommand(command: string) {
  const res = await fetch(`${API_BASE}/api/commands`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ command }),
  });
  return handleResponse(res);
}

// ---- Agents ------------------------------------------------------------

export async function fetchAgents(options?: { includeInactive?: boolean }) {
  const qStr = options?.includeInactive ? "?includeInactive=true" : "";
  const res = await fetch(`${API_BASE}/api/agents${qStr}`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function fetchAgentDetail(agentId: string) {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function fetchAgentTasks(agentId: string, limit = 50) {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/tasks?limit=${limit}`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function fetchAgentAuditLogs(agentId: string, limit = 100) {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/audit-logs?limit=${limit}`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function resetAgentCost(agentId: string) {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/reset-cost`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ---- Decisions ---------------------------------------------------------

export async function fetchDecisions(status = "PENDING") {
  const res = await fetch(`${API_BASE}/api/decisions?status=${status}`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function actOnDecision(
  id: string,
  action: "approve" | "reject",
  totpCode?: string
) {
  const extra: Record<string, string> = {};
  if (totpCode) extra["X-TOTP-Code"] = totpCode;

  const res = await fetch(`${API_BASE}/api/decisions/${id}/${action}`, {
    method: "POST",
    headers: authHeaders(extra),
  });
  return handleResponse(res);
}

// ---- Tasks -------------------------------------------------------------

export async function fetchTasks(status?: string, assignedTo?: string) {
  const query = new URLSearchParams();
  if (status) query.append("status", status);
  if (assignedTo) query.append("assignedTo", assignedTo);
  const qStr = query.toString() ? `?${query.toString()}` : "";
  const res = await fetch(`${API_BASE}/api/tasks${qStr}`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function fetchTaskDetail(id: string) {
  const res = await fetch(`${API_BASE}/api/tasks/${id}`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function submitTaskInternalReview(
  id: string,
  action: "approve" | "reject",
  comment?: string
) {
  const res = await fetch(`${API_BASE}/api/tasks/${id}/internal-review`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ action, comment }),
  });
  return handleResponse(res);
}

export async function updateTaskDeliverable(id: string, result: string) {
  const res = await fetch(`${API_BASE}/api/tasks/${id}/deliverable`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ result }),
  });
  return handleResponse(res);
}

export async function fetchTrashTasks() {
  const res = await fetch(`${API_BASE}/api/tasks/trash/list`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function fetchTrashCount(): Promise<{ count: number }> {
  const res = await fetch(`${API_BASE}/api/tasks/trash/count`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function moveTaskToTrash(id: string) {
  const res = await fetch(`${API_BASE}/api/tasks/${id}/trash`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function restoreTaskFromTrash(id: string) {
  const res = await fetch(`${API_BASE}/api/tasks/${id}/restore`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function permanentlyDeleteTask(id: string) {
  const res = await fetch(`${API_BASE}/api/tasks/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function emptyTrashTasks() {
  const res = await fetch(`${API_BASE}/api/tasks/trash/empty`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function moveAllTasksToTrash(): Promise<{ status: string; count: number }> {
  const res = await fetch(`${API_BASE}/api/tasks/trash/all`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}


// ---- Audit logs --------------------------------------------------------

export async function fetchAuditLogs(limit = 100, offset = 0) {
  const res = await fetch(`${API_BASE}/api/audit-logs?limit=${limit}&offset=${offset}`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ---- Company Knowledge Base --------------------------------------------

export async function fetchKnowledgeDocs() {
  const res = await fetch(`${API_BASE}/api/knowledge`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function ingestKnowledgeDoc(title: string, content: string, source?: string) {
  const res = await fetch(`${API_BASE}/api/knowledge`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ title, content, source }),
  });
  return handleResponse(res);
}

export async function deleteKnowledgeDoc(documentId: string) {
  const res = await fetch(`${API_BASE}/api/knowledge/${documentId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function parseKnowledgeFileApi(file: File) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const fileBase64 = typeof btoa !== "undefined" ? btoa(binary) : "";

  const res = await fetch(`${API_BASE}/api/knowledge/parse-file`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      fileName: file.name,
      fileBase64,
    }),
  });
  return handleResponse(res);
}

export async function searchKnowledgeApi(query: string, topK = 4) {
  const res = await fetch(
    `${API_BASE}/api/knowledge/search?q=${encodeURIComponent(query)}&topK=${topK}`,
    { headers: authHeaders() }
  );
  return handleResponse(res);
}

// ---- Settings & Budget Guardrail ---------------------------------------

export async function setAgentBudgetCap(id: string, budgetCapUsd: number | null) {
  const res = await fetch(`${API_BASE}/api/agents/${id}/budget`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ budgetCapUsd }),
  });
  return handleResponse(res);
}

export async function fetchCompanySettings() {
  const res = await fetch(`${API_BASE}/api/settings`, { headers: authHeaders() });
  return handleResponse(res) as Promise<{ monthlyBudgetCapUsd: number | null }>;
}

export async function updateCompanySettings(monthlyBudgetCapUsd: number | null) {
  const res = await fetch(`${API_BASE}/api/settings`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ monthlyBudgetCapUsd }),
  });
  return handleResponse(res);
}

export async function resetCompanyCost() {
  const res = await fetch(`${API_BASE}/api/settings/reset-company-cost`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res) as Promise<{ status: string; agentCount: number; unsuspendedCount: number }>;
}

// ---- Notifications -----------------------------------------------------

export async function fetchNotificationStatus() {
  const res = await fetch(`${API_BASE}/api/notifications/status`, {
    headers: authHeaders(),
  });
  return handleResponse(res) as Promise<{
    telegram: boolean;
    email: boolean;
    anyConfigured: boolean;
  }>;
}

export async function fetchNotificationPreferences() {
  const res = await fetch(`${API_BASE}/api/notifications/preferences`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function updateNotificationPreferences(preferences: Record<string, any>) {
  const res = await fetch(`${API_BASE}/api/notifications/preferences`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(preferences),
  });
  return handleResponse(res);
}

export async function resetNotificationPreferences(): Promise<{
  ok: boolean;
  message: string;
  preferences: any;
  status: any;
}> {
  const res = await fetch(`${API_BASE}/api/notifications/reset`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

/**
 * Gửi tin nhắn tạm biệt tới kênh cụ thể (gọi ngay khi Admin toggle tắt kênh,
 * trước khi bấm Lưu). Lỗi không throw — chỉ log console.
 */
export async function sendChannelFarewell(
  channelId: "telegram" | "zalo" | "zaloBot" | "email"
): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/notifications/farewell`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ channelId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn("[API] sendChannelFarewell thất bại:", body);
    }
  } catch (err) {
    console.warn("[API] sendChannelFarewell lỗi mạng:", err);
  }
}

export async function sendTestNotification(payload?: {
  title?: string;
  message?: string;
  category?: string;
  severity?: string;
}) {
  const res = await fetch(`${API_BASE}/api/notifications/test`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload || {}),
  });
  return handleResponse(res);
}

export async function requeueTask(taskId: string) {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/requeue`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function sendTaskDeliverableNotification(taskId: string) {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/notify`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}


// ---- Tools & Permissions -----------------------------------------------

export async function fetchTools() {
  const res = await fetch(`${API_BASE}/api/tools`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function createTool(data: {
  id: string;
  name: string;
  description?: string;
  riskLevel: string;
  requiresApproval?: boolean;
}) {
  const res = await fetch(`${API_BASE}/api/tools`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateTool(
  id: string,
  data: Partial<{ name: string; description: string; riskLevel: string; requiresApproval: boolean }>
) {
  const res = await fetch(`${API_BASE}/api/tools/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteTool(id: string) {
  const res = await fetch(`${API_BASE}/api/tools/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function setAgentToolPermission(
  agentId: string,
  toolId: string,
  permissionLevel: string
) {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/permissions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ toolId, permissionLevel }),
  });
  return handleResponse(res);
}

export async function removeAgentToolPermission(agentId: string, toolId: string) {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/permissions/${toolId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ---- Agent Lifecycle & Departments -------------------------------------

export async function fetchDepartments() {
  const res = await fetch(`${API_BASE}/api/departments`, { headers: authHeaders() });
  return handleResponse(res) as Promise<
    Array<{
      id: string;
      name: string;
      managerAgentId?: string | null;
      _count?: { agents: number };
      agents?: Array<{ id: string; name: string; title: string; status: string; active?: boolean }>;
    }>
  >;
}

export async function createDepartment(data: { id: string; name: string; managerAgentId?: string | null }) {
  const res = await fetch(`${API_BASE}/api/departments`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function createAgent(data: {
  id: string;
  name: string;
  title: string;
  departmentId?: string | null;
  reportsTo?: string | null;
  mission: string;
  autonomyLevel?: number;
  budgetCapUsd?: number | null;
  initialPermissions?: Array<{ toolId: string; permissionLevel: string }>;
}) {
  const res = await fetch(`${API_BASE}/api/agents`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateAgent(
  agentId: string,
  data: Partial<{
    name: string;
    title: string;
    departmentId: string | null;
    reportsTo: string | null;
    mission: string;
    autonomyLevel: number;
    budgetCapUsd: number | null;
  }>
) {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function fireAgent(agentId: string) {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/fire`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function rehireAgent(agentId: string) {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/rehire`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ---- LLM & AI Gateway Settings ----------------------------------------

export interface LlmSettingsData {
  llmProvider: "gemini" | "openai" | "anthropic" | "custom" | "auto";
  geminiApiKeyMasked: string | null;
  openaiApiKeyMasked: string | null;
  anthropicApiKeyMasked: string | null;
  customLlmUrl: string;
  customLlmApiKeyMasked: string | null;
  orchestratorModel: string;
  embeddingApiKeyMasked: string | null;
  temperature: number;
  hasGeminiKey: boolean;
  hasOpenAiKey: boolean;
  hasAnthropicKey: boolean;
  hasCustomUrl: boolean;
  hasEmbeddingKey: boolean;
  statusDescription: string;
  resolved: {
    provider: string;
    model: string;
    baseUrl?: string;
    auto?: boolean;
  } | null;
  availableProviders: Array<{
    provider: string;
    model: string;
    baseUrl?: string;
  }>;
  defaultModels: Record<string, string>;
}

export async function fetchLlmSettings(): Promise<LlmSettingsData> {
  const res = await fetch(`${API_BASE}/api/settings/llm`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function updateLlmSettings(data: {
  llmProvider?: string | null;
  geminiApiKey?: string | null;
  openaiApiKey?: string | null;
  anthropicApiKey?: string | null;
  customLlmUrl?: string | null;
  customLlmApiKey?: string | null;
  orchestratorModel?: string | null;
  embeddingApiKey?: string | null;
  temperature?: number | null;
}) {
  const res = await fetch(`${API_BASE}/api/settings/llm`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function resetLlmSettings(): Promise<{ status: string; message: string; settings: any }> {
  const res = await fetch(`${API_BASE}/api/settings/llm/reset`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function testLlmConnection(data: {
  provider?: string;
  model?: string;
  apiKey?: string;
  customLlmUrl?: string;
  customLlmApiKey?: string;
  temperature?: number;
}) {
  const res = await fetch(`${API_BASE}/api/settings/test-llm`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res) as Promise<{
    success: boolean;
    latencyMs: number;
    provider: string;
    modelUsed: string;
    reply?: string;
    tokensUsed?: number;
    costUsd?: number;
  }>;
}

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws";

// ---- Onboarding --------------------------------------------------------

export interface OnboardingAgentDraft {
  name: string;
  title: string;
  departmentName: string;
  mission: string;
  autonomyLevel: number;
  toolPermissions: { toolId: string; permissionLevel: string }[];
}

export interface OnboardingPlan {
  departments: string[];
  agents: OnboardingAgentDraft[];
}

export async function fetchOnboardingStatus(): Promise<{ needsOnboarding: boolean }> {
  const res = await fetch(`${API_BASE}/api/onboarding/status`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function generateOnboardingPlan(
  companyDescription: string,
  riskTolerance: string
): Promise<OnboardingPlan> {
  const res = await fetch(`${API_BASE}/api/onboarding/generate-plan`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ companyDescription, riskTolerance }),
  });
  return handleResponse(res);
}

export async function applyOnboardingPlan(
  departments: string[],
  agents: OnboardingAgentDraft[]
): Promise<{ status: string; agentsCreated: number; departmentsCreated: number }> {
  const res = await fetch(`${API_BASE}/api/onboarding/apply-plan`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ departments, agents }),
  });
  return handleResponse(res);
}

// ---- Dynamic System Dictionary (Từ điển quy ước động) -----------------

export interface SystemLookupItem {
  id: string;
  category: string;
  rawCode: number;
  standardKey: string;
  displayName: string;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface SystemLookupsResponse {
  items: SystemLookupItem[];
  toolDescription: string;
}

export async function fetchSystemLookups(category?: string): Promise<SystemLookupsResponse> {
  const url = new URL(`${API_BASE}/api/settings/lookups`);
  if (category) url.searchParams.set("category", category);
  const res = await fetch(url.toString(), { headers: authHeaders() });
  return handleResponse(res);
}

export async function upsertSystemLookup(data: {
  id?: string;
  category: string;
  rawCode: number;
  standardKey: string;
  displayName: string;
  description?: string | null;
  isActive?: boolean;
}): Promise<{ status: string; item: SystemLookupItem; toolDescription: string }> {
  const res = await fetch(`${API_BASE}/api/settings/lookups`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateSystemLookup(
  id: string,
  data: Partial<Omit<SystemLookupItem, "id" | "updatedAt">>
): Promise<{ status: string; item: SystemLookupItem; toolDescription: string }> {
  const res = await fetch(`${API_BASE}/api/settings/lookups/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteSystemLookup(id: string): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/api/settings/lookups/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function resetSystemLookups(): Promise<{ status: string; message: string; items: SystemLookupItem[] }> {
  const res = await fetch(`${API_BASE}/api/settings/lookups/reset-defaults`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ---- System Console Logs API -------------------------------------------

export interface SystemLogItem {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  source?: string;
}

export async function fetchSystemLogs(options?: {
  limit?: number;
  level?: string;
  search?: string;
}): Promise<{ logs: SystemLogItem[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.level && options.level !== "all") params.set("level", options.level);
  if (options?.search) params.set("search", options.search);

  const res = await fetch(`${API_BASE}/api/settings/logs?${params.toString()}`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function clearSystemLogs(): Promise<{ status: string; message: string; cleared: number }> {
  const res = await fetch(`${API_BASE}/api/settings/logs`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ---- RBAC System Permissions API ---------------------------------------

import type {
  RbacRoleId,
  RbacModuleId,
  RbacCommandId,
  RbacAgentPermission,
  RbacPermissionsMatrix,
} from "@ai-opc/shared";

export async function fetchRbacPermissions(): Promise<RbacPermissionsMatrix> {
  const res = await fetch(`${API_BASE}/api/settings/rbac`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function updateRbacPermissions(data: {
  permissions?: Partial<Record<RbacRoleId, Partial<Record<RbacModuleId, boolean>>>>;
  agentPermissions?: Partial<Record<RbacRoleId, Partial<Record<string, RbacAgentPermission>>>>;
  commandPermissions?: Partial<Record<RbacRoleId, Partial<Record<RbacCommandId, boolean>>>>;
}): Promise<{ status: string; message: string; matrix: RbacPermissionsMatrix }> {
  const res = await fetch(`${API_BASE}/api/settings/rbac`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function resetRbacPermissions(): Promise<{ status: string; message: string; matrix: RbacPermissionsMatrix }> {
  const res = await fetch(`${API_BASE}/api/settings/rbac/reset-defaults`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ---- External Data Source (Database) API -------------------------------

import type { ExternalDbConfig, ExternalDbEngine } from "@ai-opc/shared";
export type { ExternalDbConfig, ExternalDbEngine };

export async function fetchExternalDbSettings(): Promise<ExternalDbConfig> {
  const res = await fetch(`${API_BASE}/api/settings/datasource`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function updateExternalDbSettings(
  payload: Partial<ExternalDbConfig>
): Promise<{ status: string; message: string; config: ExternalDbConfig }> {
  const res = await fetch(`${API_BASE}/api/settings/datasource`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function testExternalDbConnection(payload?: Partial<ExternalDbConfig>): Promise<{
  success: boolean;
  message: string;
  version?: string;
  latencyMs?: number;
  tableCount?: number;
}> {
  const res = await fetch(`${API_BASE}/api/settings/datasource/test`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload || {}),
  });
  return handleResponse(res);
}

// ---- Cockpit Navigation Buttons Config -----------------------------------
export interface CockpitNavButtonsConfig {
  showAgents: boolean;
  showHireAgent?: boolean;
  showKnowledge: boolean;
  showSettings: boolean;
  showSecurity: boolean;
  defaultEmail?: string;
}

export async function fetchCockpitNavConfig(email?: string): Promise<CockpitNavButtonsConfig> {
  const url = new URL(`${API_BASE}/api/settings/cockpit-nav`);
  if (email) url.searchParams.set("email", email);
  const res = await fetch(url.toString(), {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function updateCockpitNavConfig(
  payload: Partial<CockpitNavButtonsConfig>,
  email?: string
): Promise<{ status: string; message: string; config: CockpitNavButtonsConfig }> {
  const res = await fetch(`${API_BASE}/api/settings/cockpit-nav`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ ...payload, email }),
  });
  return handleResponse(res);
}

// ---- System Accounts Management & RBAC ------------------------------------
export interface SystemAccount {
  id: string;
  email: string;
  fullName: string;
  role: "founder" | "manager" | "operator" | "viewer";
  status: "active" | "locked";
  totpEnabled: boolean;
  createdAt: string;
  isPrimaryFounder: boolean;
}

export async function fetchSystemAccounts(): Promise<SystemAccount[]> {
  const res = await fetch(`${API_BASE}/api/settings/accounts`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function createSystemAccount(payload: {
  email: string;
  password: string;
  fullName?: string;
  role?: string;
}): Promise<{ status: string; message: string; account: SystemAccount }> {
  const res = await fetch(`${API_BASE}/api/settings/accounts`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function updateSystemAccount(
  id: string,
  payload: { role?: string; fullName?: string; status?: "active" | "locked" }
): Promise<{ status: string; message: string; account: SystemAccount }> {
  const res = await fetch(`${API_BASE}/api/settings/accounts/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function resetSystemAccountPassword(
  id: string,
  password: string
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/settings/accounts/${id}/password`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ password }),
  });
  return handleResponse(res);
}

export async function deleteSystemAccount(
  id: string
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/settings/accounts/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ---- Video Agent (agent_create_video_ai) ------------------------------------

import type { VideoAsset, VideoStatus } from "@ai-opc/shared";

export interface VideoStats {
  total: number;
  byStatus: Record<string, number>;
  totalCostUsd: number;
}

export interface VideoInputPayload {
  title: string;
  brief?: string | null;
  script?: string | null;
  platform?: string | null;
  aspectRatio?: string;
  durationSec?: number | null;
  tags?: string[];
}

export async function fetchVideos(
  params: { status?: string; q?: string; limit?: number } = {}
): Promise<VideoAsset[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.q) qs.set("q", params.q);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetch(`${API_BASE}/api/videos${qs.toString() ? `?${qs}` : ""}`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function fetchVideoStats(): Promise<VideoStats> {
  const res = await fetch(`${API_BASE}/api/videos/stats`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function createVideoAsset(payload: VideoInputPayload): Promise<VideoAsset> {
  const res = await fetch(`${API_BASE}/api/videos`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function setVideoAssetStatus(id: string, status: VideoStatus, note?: string): Promise<VideoAsset> {
  const res = await fetch(`${API_BASE}/api/videos/${encodeURIComponent(id)}/status`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ status, note: note ?? null }),
  });
  return handleResponse(res);
}

export async function archiveVideoAsset(id: string): Promise<VideoAsset> {
  const res = await fetch(`${API_BASE}/api/videos/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
}



export interface VideoSettingsData {
  videoGenApiUrl: string;
  videoGenApiKeyMasked: string | null;
  hasVideoGenApiKey: boolean;
  activeProvider: "http" | "simulated";
}

export async function fetchVideoSettings(): Promise<VideoSettingsData> {
  const res = await fetch(`${API_BASE}/api/settings/video`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function updateVideoSettings(payload: {
  videoGenApiUrl?: string | null;
  videoGenApiKey?: string | null;
}): Promise<VideoSettingsData> {
  const res = await fetch(`${API_BASE}/api/settings/video`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function fetchVideo(id: string): Promise<VideoAsset> {
  const res = await fetch(`${API_BASE}/api/videos/${encodeURIComponent(id)}`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function saveVideoTimeline(id: string, timeline: unknown): Promise<VideoAsset> {
  const res = await fetch(`${API_BASE}/api/videos/${encodeURIComponent(id)}/timeline`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ timeline }),
  });
  return handleResponse(res);
}

export async function buildVideoTimelineFromScript(id: string, overwrite = false): Promise<VideoAsset> {
  const res = await fetch(`${API_BASE}/api/videos/${encodeURIComponent(id)}/timeline/from-script`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ overwrite }),
  });
  return handleResponse(res);
}

