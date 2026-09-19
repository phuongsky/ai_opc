/**
 * API client — tất cả fetch calls tới Core Engine.
 * Token được lưu trong localStorage (key: "aiopc_token") và gửi qua
 * Authorization header. Khi server trả 401, tự redirect về /login.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

export async function fetchAuthConfig() {
  const res = await fetch(`${API_BASE}/api/auth/config`);
  if (!res.ok) {
    return { googleClientId: "", googleConfigured: false };
  }
  return res.json() as Promise<{ googleClientId: string; googleConfigured: boolean }>;
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
  return handleResponse(res) as Promise<{ id: string; email: string; totpEnabled: boolean }>;
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
  temperature: number;
  hasGeminiKey: boolean;
  hasOpenAiKey: boolean;
  hasAnthropicKey: boolean;
  hasCustomUrl: boolean;
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
  temperature?: number | null;
}) {
  const res = await fetch(`${API_BASE}/api/settings/llm`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(data),
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
