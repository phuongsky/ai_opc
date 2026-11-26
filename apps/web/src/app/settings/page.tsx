"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ShieldAlert,
  DollarSign,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Film,
  Building2,
  Bell,
  Send,
  Loader2,
  MessageSquare,
  Mail,
  Check,
  X,
  Scale,
  Ban,
  FileText,
  Power,
  SlidersHorizontal,
  Eye,
  EyeOff,
  CheckCheck,
  Save,
  Radio,
  ExternalLink,
  Cpu,
  Bot,
  Server,
  Key,
  Globe,
  Activity as ActivityIcon,
  Play,
  Terminal,
  BookOpen,
  Plus,
  Trash2,
  Edit3,
  Search,
  Database,
  RefreshCw,
  Copy,
  Maximize2,
  Minimize2,
  Lock,
  ShieldCheck,
  Layers,
  UserCheck,
  Users,
  UserPlus,
  Settings,
  ChevronDown,
} from "lucide-react";
import {
  fetchCompanySettings,
  updateCompanySettings,
  resetCompanyCost,
  fetchAgents,
  fetchNotificationStatus,
  fetchNotificationPreferences,
  updateNotificationPreferences,
  resetNotificationPreferences,
  sendTestNotification,
  fetchLlmSettings,
  updateLlmSettings,
  resetLlmSettings,
  testLlmConnection,
  sendChannelFarewell,
  fetchSystemLookups,
  upsertSystemLookup,
  updateSystemLookup,
  deleteSystemLookup,
  resetSystemLookups,
  fetchSystemLogs,
  clearSystemLogs,
  fetchRbacPermissions,
  updateRbacPermissions,
  resetRbacPermissions,
  fetchExternalDbSettings,
  updateExternalDbSettings,
  testExternalDbConnection,
  fetchAuthChannelsSettings,
  updateAuthChannelsSettings,
  fetchCockpitNavConfig,
  updateCockpitNavConfig,
  fetchVideoSettings,
  updateVideoSettings,
  fetchMe,
  fetchSystemAccounts,
  createSystemAccount,
  updateSystemAccount,
  resetSystemAccountPassword,
  deleteSystemAccount,
  type SystemAccount,
  type CockpitNavButtonsConfig,
  type VideoSettingsData,
  type SystemLookupItem,
  type LlmSettingsData,
  type SystemLogItem,
  type ExternalDbConfig,
  type ExternalDbEngine,
} from "@/lib/api";
import { openZaloAuthPopup, ZaloLoginModal } from "@/components/ZaloLoginModal";
import { useCompanySocket } from "@/hooks/useCompanySocket";
import type { Agent, NotificationPreferences, RbacRoleId, RbacModuleId, RbacCommandId, RbacPermissionsMatrix } from "@ai-opc/shared";
import { useI18n } from "@/context/I18nContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface NotificationStatus {
  telegram: boolean;
  email: boolean;
  zalo?: boolean;
  zaloBot?: boolean;
  zaloDetails?: {
    sessionConnected: boolean;
    uid: string | null;
    configured: boolean;
    defaultPhone: string;
    defaultGroupId: string;
  };
  channelsHealth?: {
    telegram: { inCooldown: boolean; failures: number; lastSuccess: number | null };
    zalo: { inCooldown: boolean; failures: number; lastSuccess: number | null };
    zaloBot?: { inCooldown: boolean; failures: number; lastSuccess: number | null };
    email: { inCooldown: boolean; failures: number; lastSuccess: number | null };
  };
  anyConfigured: boolean;
}

const DEFAULT_PREFS: NotificationPreferences = {
  sendToTelegram: true,
  sendToEmail: true,
  sendToZalo: true,
  sendToZaloBot: true,
  notifyBudgetCapExceeded: true,
  notifyDecisionRequired: true,
  notifyBlockedTasks: true,
  notifyWeeklyReport: true,
  notifyEmergencyStop: true,
  customTelegramChatId: "",
  customTelegramRecipients: [{ id: "1", chatId: "" }],
  customTelegramToken: "",
  customEmailRecipient: "",
  customSmtpHost: "",
  customSmtpPort: "",
  customSmtpUser: "",
  customSmtpPass: "",
  customSmtpFrom: "",
  customZaloPhone: "",
  customZaloGroupId: "",
  customZaloRecipients: [{ id: "1", phone: "", groupId: "" }],
  customZaloBotChatId: "",
  customZaloBotRecipients: [{ id: "1", chatId: "", groupId: "" }],
  customZaloBotToken: "",
};

export default function SettingsPage() {
  const { t, locale } = useI18n();
  const [capInput, setCapInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);

  // LLM / AI Gateway State
  const [llmProvider, setLlmProvider] = useState<"gemini" | "openai" | "anthropic" | "custom" | "auto">("auto");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [customLlmUrl, setCustomLlmUrl] = useState("");
  const [customLlmApiKey, setCustomLlmApiKey] = useState("");
  const [orchestratorModel, setOrchestratorModel] = useState("");
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [temperature, setTemperature] = useState(0.2);
  const [llmStatusDesc, setLlmStatusDesc] = useState("");
  const [llmMasked, setLlmMasked] = useState<{
    gemini: string | null;
    openai: string | null;
    anthropic: string | null;
    custom: string | null;
    embedding: string | null;
  }>({ gemini: null, openai: null, anthropic: null, custom: null, embedding: null });
  const [showLlmKeys, setShowLlmKeys] = useState<Record<string, boolean>>({});
  const [savingLlm, setSavingLlm] = useState(false);
  const [resettingLlm, setResettingLlm] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [llmMessage, setLlmMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs: number;
    provider?: string;
    modelUsed?: string;
    reply?: string;
    tokensUsed?: number;
    costUsd?: number;
    error?: string;
  } | null>(null);

  // Video Generation Provider State
  const [videoGenApiUrl, setVideoGenApiUrl] = useState("");
  const [videoGenApiKey, setVideoGenApiKey] = useState("");
  const [videoMaskedKey, setVideoMaskedKey] = useState<string | null>(null);
  const [hasVideoKey, setHasVideoKey] = useState(false);
  const [videoActiveProvider, setVideoActiveProvider] = useState<"http" | "simulated">("simulated");
  const [showVideoKey, setShowVideoKey] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  const [videoMessage, setVideoMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Notification State
  const [notifStatus, setNotifStatus] = useState<NotificationStatus | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFS);
  // savedPrefs = snapshot lần cuối được lưu thành công (dùng để phát hiện kênh nào vừa bị tắt khi toggle)
  const [savedPrefs, setSavedPrefs] = useState<NotificationPreferences>(DEFAULT_PREFS);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [resettingPrefs, setResettingPrefs] = useState(false);
  const [testingNotif, setTestingNotif] = useState(false);
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [notifMessage, setNotifMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [saveNotifPopup, setSaveNotifPopup] = useState<{
    isOpen: boolean;
    type: "success" | "error";
    title: string;
    message: string;
    channelsSummary?: { name: string; enabled: boolean }[];
  } | null>(null);
  const [previewOpen, setPreviewOpen] = useState<Record<string, boolean>>({
    BUDGET_CAP: true,
    DECISION: false,
    BLOCKED_TASK: false,
    WEEKLY_REPORT: false,
    EMERGENCY_STOP: false,
  });
  const [selectedTestEvent, setSelectedTestEvent] = useState<string>("BUDGET_CAP");
  const [isZaloModalOpen, setIsZaloModalOpen] = useState(false);

  // Auth Channels State (Tài khoản > Kênh login)
  const [googleLoginEnabled, setGoogleLoginEnabled] = useState(true);
  const [googleClientId, setGoogleClientId] = useState("");
  const [zaloLoginEnabled, setZaloLoginEnabled] = useState(true);
  const [savingAuthChannels, setSavingAuthChannels] = useState(false);
  const [authChannelsMessage, setAuthChannelsMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Cockpit Navigation Buttons State (Tài khoản > Hiển thị nút Executive Cockpit)
  const [currentUserEmail, setCurrentUserEmail] = useState<string>("");
  const [cockpitNavConfig, setCockpitNavConfig] = useState<CockpitNavButtonsConfig>({
    showAgents: true,
    showHireAgent: true,
    showKnowledge: true,
    showSettings: true,
    showSecurity: true,
    defaultEmail: "phuongtv2c11@gmail.com",
  });
  const [savingCockpitNav, setSavingCockpitNav] = useState(false);
  const [cockpitNavMessage, setCockpitNavMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // System Accounts State (Tài khoản > Quản lý tài khoản người dùng & Phân quyền RBAC)
  const [currentUserRole, setCurrentUserRole] = useState<string>("founder");
  const [accounts, setAccounts] = useState<SystemAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [newAccountEmail, setNewAccountEmail] = useState("");
  const [newAccountPassword, setNewAccountPassword] = useState("");
  const [newAccountFullName, setNewAccountFullName] = useState("");
  const [newAccountRole, setNewAccountRole] = useState<RbacRoleId>("operator");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [accountActionMessage, setAccountActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Modal / State for resetting password
  const [resettingPasswordAccount, setResettingPasswordAccount] = useState<SystemAccount | null>(null);
  const [newResetPassword, setNewResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [submittingResetPassword, setSubmittingResetPassword] = useState(false);

  // Modal / State for deleting account
  const [deletingAccount, setDeletingAccount] = useState<SystemAccount | null>(null);
  const [submittingDeleteAccount, setSubmittingDeleteAccount] = useState(false);

  // Dynamic System Dictionary (Từ điển quy ước) State — Bug 3 & Bug 4
  const [lookups, setLookups] = useState<SystemLookupItem[]>([]);
  const [lookupCategory, setLookupCategory] = useState("booking_status");
  const [toolDescription, setToolDescription] = useState("");
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [lookupSearch, setLookupSearch] = useState("");
  const [lookupMessage, setLookupMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [lookupModal, setLookupModal] = useState<{
    isOpen: boolean;
    mode: "create" | "edit";
    data: {
      id?: string;
      category: string;
      rawCode: number | "";
      standardKey: string;
      displayName: string;
      description: string;
      isActive: boolean;
    };
  } | null>(null);
  const [savingLookupItem, setSavingLookupItem] = useState(false);
  const [resettingLookups, setResettingLookups] = useState(false);

  // External Database Data Source State
  const [extDbConfig, setExtDbConfig] = useState<ExternalDbConfig>({
    engine: "sqlserver",
    host: "127.0.0.1",
    port: 1433,
    database: "Intelio_Sunset",
    user: "sa",
    password: "",
    passwordMasked: "",
    encrypt: false,
    trustServerCertificate: true,
    isConfigured: false,
  });
  const [extDbPasswordInput, setExtDbPasswordInput] = useState("");
  const [showExtDbPassword, setShowExtDbPassword] = useState(false);
  const [testingExtDb, setTestingExtDb] = useState(false);
  const [savingExtDb, setSavingExtDb] = useState(false);
  const [extDbTestResult, setExtDbTestResult] = useState<{
    success: boolean;
    message: string;
    version?: string;
    latencyMs?: number;
    tableCount?: number;
  } | null>(null);
  const [extDbMessage, setExtDbMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // RBAC Permissions State (Phân quyền sử dụng hệ thống)
  const [rbacMatrix, setRbacMatrix] = useState<RbacPermissionsMatrix | null>(null);
  const [loadingRbac, setLoadingRbac] = useState(false);
  const [savingRbac, setSavingRbac] = useState(false);
  const [resettingRbac, setResettingRbac] = useState(false);
  const [rbacMessage, setRbacMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // System Console Logs State
  const { lastEvent, isConnected: isWsConnected } = useCompanySocket();
  const [logs, setLogs] = useState<SystemLogItem[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logFilterLevel, setLogFilterLevel] = useState<string>("all");
  const [logSearch, setLogSearch] = useState<string>("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [isLogExpanded, setIsLogExpanded] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Collapsible Cards State (Đóng / Mở từng card trong Settings)
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem("ai_opc_settings_collapsed_cards");
      if (saved) {
        setCollapsedCards(JSON.parse(saved));
      }
    } catch {}
  }, []);

  const toggleCard = (cardKey: string) => {
    setCollapsedCards((prev) => {
      const next = { ...prev, [cardKey]: !prev[cardKey] };
      try {
        localStorage.setItem("ai_opc_settings_collapsed_cards", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const collapseAllCards = () => {
    const allCollapsed: Record<string, boolean> = {
      notifChannels: true,
      account: true,
      externalDb: true,
      systemLookups: true,
      aiGateway: true,
      videoProvider: true,
      budgetCap: true,
      costCycle: true,
      rbacMatrix: true,
      systemLogs: true,
      subTelegram: true,
      subZaloBot: true,
      subEmail: true,
      subZaloPersonal: true,
      subLoginChannels: true,
      subCockpitNav: true,
    };
    setCollapsedCards(allCollapsed);
    try {
      localStorage.setItem("ai_opc_settings_collapsed_cards", JSON.stringify(allCollapsed));
    } catch {}
  };

  const expandAllCards = () => {
    setCollapsedCards({});
    try {
      localStorage.removeItem("ai_opc_settings_collapsed_cards");
    } catch {}
  };

  async function loadLogs() {
    try {
      setLoadingLogs(true);
      const res = await fetchSystemLogs({ limit: 400 });
      setLogs(res.logs || []);
    } catch (err: any) {
      console.error("[Settings] Lỗi tải log hệ thống:", err);
    } finally {
      setLoadingLogs(false);
    }
  }

  async function handleClearLogs() {
    try {
      await clearSystemLogs();
      setLogs([]);
    } catch (err: any) {
      console.error("[Settings] Lỗi xóa log:", err);
    }
  }

  // Handle incoming WebSocket SYSTEM_LOG
  useEffect(() => {
    if (lastEvent && lastEvent.type === "SYSTEM_LOG" && lastEvent.payload) {
      const newEntry = lastEvent.payload as SystemLogItem;
      setLogs((prev) => {
        if (prev.some((x) => x.id === newEntry.id)) return prev;
        const next = [...prev, newEntry];
        if (next.length > 1000) return next.slice(-1000);
        return next;
      });
    }

    if (lastEvent && lastEvent.type === "RBAC_PERMISSIONS_UPDATED" && lastEvent.payload) {
      setRbacMatrix(lastEvent.payload as RbacPermissionsMatrix);
    }
  }, [lastEvent]);

  const [rbacActiveTab, setRbacActiveTab] = useState<"modules" | "agents" | "commands">("modules");

  // RBAC Permission Handlers
  function handleToggleRbacCommandPermission(roleId: RbacRoleId, commandId: RbacCommandId) {
    if (roleId === "founder") return;
    if (!rbacMatrix || !rbacMatrix.commandPermissions) return;
    const currentVal = rbacMatrix.commandPermissions[roleId]?.[commandId] ?? false;
    setRbacMatrix({
      ...rbacMatrix,
      commandPermissions: {
        ...rbacMatrix.commandPermissions,
        [roleId]: {
          ...(rbacMatrix.commandPermissions[roleId] || {}),
          [commandId]: !currentVal,
        },
      },
    });
  }

  function handleToggleAllRoleCommands(roleId: RbacRoleId, enable: boolean) {
    if (roleId === "founder") return;
    if (!rbacMatrix || !rbacMatrix.commands || !rbacMatrix.commandPermissions) return;
    const newCmdPerms = { ...(rbacMatrix.commandPermissions[roleId] || {}) };
    for (const cmd of rbacMatrix.commands) {
      newCmdPerms[cmd.id] = enable;
    }
    setRbacMatrix({
      ...rbacMatrix,
      commandPermissions: {
        ...rbacMatrix.commandPermissions,
        [roleId]: newCmdPerms as Record<RbacCommandId, boolean>,
      },
    });
  }
  function handleToggleRbacPermission(roleId: RbacRoleId, moduleId: RbacModuleId) {
    if (roleId === "founder") return;
    if (!rbacMatrix) return;
    const currentVal = rbacMatrix.permissions[roleId]?.[moduleId] ?? false;
    setRbacMatrix({
      ...rbacMatrix,
      permissions: {
        ...rbacMatrix.permissions,
        [roleId]: {
          ...rbacMatrix.permissions[roleId],
          [moduleId]: !currentVal,
        },
      },
    });
  }

  function handleToggleAllRolePermissions(roleId: RbacRoleId, enable: boolean) {
    if (roleId === "founder") return;
    if (!rbacMatrix) return;
    const newRolePerms = { ...rbacMatrix.permissions[roleId] };
    for (const mod of rbacMatrix.modules) {
      newRolePerms[mod.id] = enable;
    }
    setRbacMatrix({
      ...rbacMatrix,
      permissions: {
        ...rbacMatrix.permissions,
        [roleId]: newRolePerms,
      },
    });
  }

  function handleToggleAgentView(roleId: RbacRoleId, agentId: string) {
    if (roleId === "founder") return;
    if (!rbacMatrix) return;
    const current = rbacMatrix.agentPermissions?.[roleId]?.[agentId] || { canView: true, canControl: false };
    const nextView = !current.canView;
    const nextControl = nextView ? current.canControl : false;
    setRbacMatrix({
      ...rbacMatrix,
      agentPermissions: {
        ...rbacMatrix.agentPermissions,
        [roleId]: {
          ...(rbacMatrix.agentPermissions?.[roleId] || {}),
          [agentId]: { canView: nextView, canControl: nextControl },
        },
      },
    });
  }

  function handleToggleAgentControl(roleId: RbacRoleId, agentId: string) {
    if (roleId === "founder") return;
    if (!rbacMatrix) return;
    const current = rbacMatrix.agentPermissions?.[roleId]?.[agentId] || { canView: true, canControl: false };
    const nextControl = !current.canControl;
    const nextView = nextControl ? true : current.canView;
    setRbacMatrix({
      ...rbacMatrix,
      agentPermissions: {
        ...rbacMatrix.agentPermissions,
        [roleId]: {
          ...(rbacMatrix.agentPermissions?.[roleId] || {}),
          [agentId]: { canView: nextView, canControl: nextControl },
        },
      },
    });
  }

  function handleSetRoleAllAgents(roleId: RbacRoleId, mode: "full" | "view_only" | "none") {
    if (roleId === "founder") return;
    if (!rbacMatrix) return;
    const newAgentPerms = { ...(rbacMatrix.agentPermissions?.[roleId] || {}) };
    for (const a of agents) {
      if (mode === "full") {
        newAgentPerms[a.id] = { canView: true, canControl: true };
      } else if (mode === "view_only") {
        newAgentPerms[a.id] = { canView: true, canControl: false };
      } else {
        newAgentPerms[a.id] = { canView: false, canControl: false };
      }
    }
    setRbacMatrix({
      ...rbacMatrix,
      agentPermissions: {
        ...rbacMatrix.agentPermissions,
        [roleId]: newAgentPerms,
      },
    });
  }

  async function handleSaveRbac() {
    if (!rbacMatrix) return;
    setSavingRbac(true);
    setRbacMessage(null);
    try {
      const res = await updateRbacPermissions({
        permissions: rbacMatrix.permissions,
        agentPermissions: rbacMatrix.agentPermissions,
        commandPermissions: rbacMatrix.commandPermissions,
      });
      setRbacMatrix(res.matrix);
      setRbacMessage({
        type: "success",
        text: locale === "vi" ? t.settings.rbac.saveSuccess : "Saved permissions successfully!",
      });
      setTimeout(() => setRbacMessage(null), 4000);
    } catch (err: any) {
      setRbacMessage({
        type: "error",
        text: err.message || (locale === "vi" ? "Lỗi khi lưu phân quyền" : "Failed to save permissions"),
      });
    } finally {
      setSavingRbac(false);
    }
  }

  async function handleResetRbacDefaults() {
    if (
      !window.confirm(
        locale === "vi"
          ? "Xác nhận khôi phục ma trận phân quyền về mặc định tiêu chuẩn?"
          : "Restore RBAC permissions matrix to default standards?"
      )
    )
      return;
    setResettingRbac(true);
    setRbacMessage(null);
    try {
      const res = await resetRbacPermissions();
      setRbacMatrix(res.matrix);
      setRbacMessage({
        type: "success",
        text: locale === "vi" ? t.settings.rbac.resetSuccess : "Restored defaults successfully!",
      });
      setTimeout(() => setRbacMessage(null), 4000);
    } catch (err: any) {
      setRbacMessage({
        type: "error",
        text: err.message || (locale === "vi" ? "Lỗi khôi phục phân quyền" : "Failed to restore defaults"),
      });
    } finally {
      setResettingRbac(false);
    }
  }

  // Auto-scroll when new logs arrive if enabled
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  async function refreshLookups(category = lookupCategory) {
    try {
      setLoadingLookups(true);
      const res = await fetchSystemLookups(category);
      setLookups(res.items || []);
      setToolDescription(res.toolDescription || "");
    } catch (err: any) {
      console.error("[Settings] Lỗi tải từ điển quy ước:", err);
    } finally {
      setLoadingLookups(false);
    }
  }

  async function handleToggleLookupActive(item: SystemLookupItem) {
    try {
      const nextActive = !item.isActive;
      setLookups((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, isActive: nextActive } : x))
      );
      const res = await updateSystemLookup(item.id, { isActive: nextActive });
      setToolDescription(res.toolDescription);
      setLookupMessage({
        type: "success",
        text: `Đã ${nextActive ? "bật" : "tắt"} quy ước Mã ${item.rawCode} (${item.displayName}) thành công.`,
      });
    } catch (err: any) {
      setLookupMessage({ type: "error", text: err.message || "Lỗi cập nhật trạng thái quy ước" });
      await refreshLookups();
    }
  }

  async function handleSaveLookupModal(e: React.FormEvent) {
    e.preventDefault();
    if (!lookupModal) return;
    setSavingLookupItem(true);
    setLookupMessage(null);
    try {
      const rawCodeNum = Number(lookupModal.data.rawCode);
      if (isNaN(rawCodeNum)) throw new Error("Mã số quy ước (Code) phải là một số nguyên hợp lệ.");
      if (!lookupModal.data.standardKey.trim()) throw new Error("Khóa chuẩn (Standard Key) không được để trống.");
      if (!lookupModal.data.displayName.trim()) throw new Error("Tên hiển thị (Display Name) không được để trống.");

      const payload = {
        id: lookupModal.data.id,
        category: lookupModal.data.category || "booking_status",
        rawCode: rawCodeNum,
        standardKey: lookupModal.data.standardKey.trim().toUpperCase(),
        displayName: lookupModal.data.displayName.trim(),
        description: lookupModal.data.description.trim() || null,
        isActive: lookupModal.data.isActive !== false,
      };

      const res = await upsertSystemLookup(payload);
      setToolDescription(res.toolDescription);
      setLookupMessage({
        type: "success",
        text: `Đã lưu thành công quy ước Mã ${payload.rawCode} — "${payload.displayName}"!`,
      });
      setLookupModal(null);
      await refreshLookups();
    } catch (err: any) {
      setLookupMessage({ type: "error", text: err.message || "Lỗi lưu quy ước" });
    } finally {
      setSavingLookupItem(false);
    }
  }

  async function handleDeleteLookup(item: SystemLookupItem) {
    if (!window.confirm(`Xác nhận xóa quy ước Mã ${item.rawCode} (${item.displayName}) khỏi hệ thống?`)) return;
    try {
      await deleteSystemLookup(item.id);
      setLookupMessage({ type: "success", text: `Đã xóa quy ước Mã ${item.rawCode} thành công.` });
      await refreshLookups();
    } catch (err: any) {
      setLookupMessage({ type: "error", text: err.message || "Lỗi khi xóa quy ước" });
    }
  }

  async function handleResetLookups() {
    if (
      !window.confirm(
        "Xác nhận khôi phục bảng từ điển quy ước về mặc định chuẩn (Mã 0-7)? Toàn bộ sửa đổi tùy biến sẽ được đưa về giá trị gốc."
      )
    )
      return;
    setResettingLookups(true);
    setLookupMessage(null);
    try {
      const res = await resetSystemLookups();
      setLookups(res.items || []);
      setLookupMessage({
        type: "success",
        text: "Đã khôi phục toàn bộ bảng quy ước về giá trị chuẩn thành công.",
      });
      await refreshLookups();
    } catch (err: any) {
      setLookupMessage({ type: "error", text: err.message || "Lỗi khi khôi phục quy ước mặc định" });
    } finally {
      setResettingLookups(false);
    }
  }

  // External Database Handlers
  function handleExtDbEngineChange(newEngine: ExternalDbEngine) {
    let defaultPort = 1433;
    if (newEngine === "postgresql") defaultPort = 5432;
    if (newEngine === "mysql") defaultPort = 3306;
    setExtDbConfig((prev) => ({
      ...prev,
      engine: newEngine,
      port: prev.port === 1433 || prev.port === 5432 || prev.port === 3306 ? defaultPort : prev.port,
    }));
  }

  async function handleTestExtDbConnection() {
    setTestingExtDb(true);
    setExtDbTestResult(null);
    setExtDbMessage(null);
    try {
      const res = await testExternalDbConnection({
        ...extDbConfig,
        password: extDbPasswordInput || undefined,
      });
      setExtDbTestResult(res);
      if (res.success) {
        setExtDbMessage({
          type: "success",
          text: res.message,
        });
      } else {
        setExtDbMessage({
          type: "error",
          text: res.message,
        });
      }
    } catch (err: any) {
      const msg = err.message || "Lỗi kiểm tra kết nối Database";
      setExtDbTestResult({ success: false, message: msg });
      setExtDbMessage({ type: "error", text: msg });
    } finally {
      setTestingExtDb(false);
    }
  }

  async function handleSaveExtDbConfig(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSavingExtDb(true);
    setExtDbMessage(null);
    try {
      const payload: Partial<ExternalDbConfig> = {
        engine: extDbConfig.engine,
        host: extDbConfig.host.trim(),
        port: Number(extDbConfig.port),
        database: extDbConfig.database.trim(),
        user: extDbConfig.user.trim(),
        encrypt: extDbConfig.encrypt,
        trustServerCertificate: extDbConfig.trustServerCertificate,
      };
      if (extDbPasswordInput.trim()) {
        payload.password = extDbPasswordInput.trim();
      }
      const res = await updateExternalDbSettings(payload);
      setExtDbConfig(res.config);
      setExtDbPasswordInput("");
      setExtDbMessage({
        type: "success",
        text: res.message || "Đã lưu cấu hình External Database thành công!",
      });
      setTimeout(() => setExtDbMessage(null), 5000);
    } catch (err: any) {
      setExtDbMessage({
        type: "error",
        text: err.message || "Lỗi khi lưu cấu hình External Database",
      });
    } finally {
      setSavingExtDb(false);
    }
  }

  async function refresh() {
    try {
      const [s, a, n, p, llm, lk, lg, rbac, extDb, authChan, meUser, cNav, accs, vid] = await Promise.all([
        fetchCompanySettings(),
        fetchAgents(),
        fetchNotificationStatus().catch(() => null),
        fetchNotificationPreferences().catch(() => null),
        fetchLlmSettings().catch(() => null),
        fetchSystemLookups(lookupCategory).catch(() => null),
        fetchSystemLogs({ limit: 400 }).catch(() => ({ logs: [], total: 0 })),
        fetchRbacPermissions().catch(() => null),
        fetchExternalDbSettings().catch(() => null),
        fetchAuthChannelsSettings().catch(() => null),
        fetchMe().catch(() => null),
        fetchCockpitNavConfig().catch(() => null),
        fetchSystemAccounts().catch(() => []),
        fetchVideoSettings().catch(() => null),
      ]);
      setCapInput(s.monthlyBudgetCapUsd != null ? String(s.monthlyBudgetCapUsd) : "");
      setAgents(a || []);
      if (n) setNotifStatus(n as NotificationStatus);
      if (p) {
        const loaded = { ...DEFAULT_PREFS, ...p } as NotificationPreferences;
        if (!loaded.customTelegramRecipients || loaded.customTelegramRecipients.length === 0) {
          loaded.customTelegramRecipients = [
            { id: "1", chatId: loaded.customTelegramChatId || "" },
          ];
        }
        if (!loaded.customZaloRecipients || loaded.customZaloRecipients.length === 0) {
          loaded.customZaloRecipients = [
            { id: "1", phone: loaded.customZaloPhone || "", groupId: loaded.customZaloGroupId || "" },
          ];
        }
        if (!loaded.customZaloBotRecipients || loaded.customZaloBotRecipients.length === 0) {
          loaded.customZaloBotRecipients = [
            { id: "1", chatId: loaded.customZaloBotChatId || "", groupId: "" },
          ];
        }
        setPrefs(loaded);
        setSavedPrefs(loaded);
      }
      if (llm) {
        setLlmProvider(llm.llmProvider || "auto");
        setCustomLlmUrl(llm.customLlmUrl || "");
        setOrchestratorModel(llm.orchestratorModel || "");
        setTemperature(llm.temperature ?? 0.2);
        setLlmStatusDesc(llm.statusDescription || "");
        setLlmMasked({
          gemini: llm.geminiApiKeyMasked,
          openai: llm.openaiApiKeyMasked,
          anthropic: llm.anthropicApiKeyMasked,
          custom: llm.customLlmApiKeyMasked,
          embedding: llm.embeddingApiKeyMasked,
        });
      }
      if (vid) {
        setVideoGenApiUrl(vid.videoGenApiUrl || "");
        setVideoMaskedKey(vid.videoGenApiKeyMasked || null);
        setHasVideoKey(vid.hasVideoGenApiKey);
        setVideoActiveProvider(vid.activeProvider || "simulated");
      }
      if (lk) {
        setLookups(lk.items || []);
        setToolDescription(lk.toolDescription || "");
      }
      if (lg && lg.logs) {
        setLogs(lg.logs);
      }
      if (rbac) {
        setRbacMatrix(rbac);
      }
      if (extDb) {
        setExtDbConfig(extDb);
      }
      if (authChan) {
        setGoogleLoginEnabled(authChan.googleLoginEnabled);
        setGoogleClientId(authChan.googleClientId || "");
        setZaloLoginEnabled(authChan.zaloLoginEnabled !== undefined ? authChan.zaloLoginEnabled : true);
      }
      if (meUser) {
        if (meUser.email) setCurrentUserEmail(meUser.email);
        if (meUser.role) setCurrentUserRole(meUser.role);
      }
      if (accs) {
        setAccounts(accs);
      }
      if (cNav) {
        setCockpitNavConfig({
          ...cNav,
          showHireAgent: cNav.showHireAgent !== undefined ? cNav.showHireAgent : true,
        });
      }
      setLoaded(true);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Lỗi tải cài đặt" });
      setLoaded(true);
    }
  }

  useEffect(() => {
    refresh();

    // Lắng nghe tín hiệu postMessage ZALO_AUTH_SUCCESS từ Popup theo Zalo_guide.md
    function handleMessage(event: MessageEvent) {
      if (
        event.data &&
        (event.data.type === "ZALO_AUTH_SUCCESS" || event.data.event === "ZALO_AUTH_SUCCESS")
      ) {
        console.log("[Settings] Nhận ZALO_AUTH_SUCCESS từ popup:", event.data);
        const uid = event.data.userId || event.data.payload?.userId || "Zalo User";
        setNotifMessage({
          type: "success",
          text: `Liên kết tài khoản Zalo thành công! Phiên UID: ${uid} đã sẵn sàng nhận thông báo.`,
        });
        refresh();
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const totalSpentUsd = agents.reduce((sum, a) => sum + Number(a.monthlyCostUsd || 0), 0);
  const suspendedAgents = agents.filter((a) => a.status === "SUSPENDED");
  const budgetCapNumber = capInput.trim() === "" ? null : Number(capInput);
  const percentUsed =
    budgetCapNumber && budgetCapNumber > 0
      ? Math.min(100, Math.round((totalSpentUsd / budgetCapNumber) * 100))
      : null;

  const filteredLogs = logs.filter((log) => {
    const matchesLevel = logFilterLevel === "all" || log.level === logFilterLevel;
    const matchesSearch =
      !logSearch.trim() ||
      log.message.toLowerCase().includes(logSearch.toLowerCase()) ||
      (log.source && log.source.toLowerCase().includes(logSearch.toLowerCase()));
    return matchesLevel && matchesSearch;
  });

  function handleCopyLogs() {
    if (filteredLogs.length === 0) return;
    const text = filteredLogs
      .map((l) => `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.level.toUpperCase()}] ${l.message}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  }

  async function handleSaveBudget(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const value = capInput.trim() === "" ? null : Number(capInput);
      await updateCompanySettings(value);
      setMessage({ type: "success", text: "Đã cập nhật trần ngân sách toàn công ty thành công." });
      await refresh();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Lỗi khi lưu trần ngân sách" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveLlm(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSavingLlm(true);
    setLlmMessage(null);
    try {
      await updateLlmSettings({
        llmProvider: llmProvider === "auto" ? null : llmProvider,
        orchestratorModel: orchestratorModel.trim() || null,
        customLlmUrl: customLlmUrl.trim() || null,
        temperature,
        geminiApiKey: geminiApiKey.trim() || undefined,
        openaiApiKey: openaiApiKey.trim() || undefined,
        anthropicApiKey: anthropicApiKey.trim() || undefined,
        customLlmApiKey: customLlmApiKey.trim() || undefined,
        embeddingApiKey: embeddingApiKey.trim() || undefined,
      });
      setLlmMessage({ type: "success", text: "Đã lưu cấu hình AI Agent Input thành công!" });
      setGeminiApiKey("");
      setOpenaiApiKey("");
      setAnthropicApiKey("");
      setCustomLlmApiKey("");
      setEmbeddingApiKey("");
      await refresh();
    } catch (err: any) {
      setLlmMessage({ type: "error", text: err.message || "Lỗi lưu cấu hình AI" });
    } finally {
      setSavingLlm(false);
    }
  }

  async function handleSaveVideoSettings(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSavingVideo(true);
    setVideoMessage(null);
    try {
      const res = await updateVideoSettings({
        videoGenApiUrl: videoGenApiUrl.trim() || null,
        videoGenApiKey: videoGenApiKey.trim() || undefined,
      });
      setVideoGenApiUrl(res.videoGenApiUrl || "");
      setVideoMaskedKey(res.videoGenApiKeyMasked);
      setHasVideoKey(res.hasVideoGenApiKey);
      setVideoActiveProvider(res.activeProvider);
      setVideoGenApiKey("");
      setVideoMessage({
        type: "success",
        text: locale === "vi" ? "Đã lưu cấu hình dịch vụ Video AI thành công!" : "Video AI settings saved successfully!",
      });
    } catch (err: any) {
      setVideoMessage({
        type: "error",
        text: err.message || (locale === "vi" ? "Lỗi khi lưu cấu hình Video AI" : "Failed to save Video AI settings"),
      });
    } finally {
      setSavingVideo(false);
    }
  }

  async function handleResetLlm() {
    if (
      !window.confirm(
        locale === "vi"
          ? "Bạn có chắc chắn muốn đặt lại (Reset) toàn bộ cấu hình AI Agent Input & Model Gateway về mặc định?\n\nToàn bộ API Key, Custom URL và Model tùy biến đã lưu sẽ bị xóa."
          : "Are you sure you want to reset all AI Agent Input & Model Gateway settings to default?\n\nAll saved API keys, Custom URL, and custom models will be cleared."
      )
    ) {
      return;
    }
    setResettingLlm(true);
    setLlmMessage(null);
    try {
      await resetLlmSettings();
      setLlmProvider("auto");
      setGeminiApiKey("");
      setOpenaiApiKey("");
      setAnthropicApiKey("");
      setCustomLlmUrl("");
      setCustomLlmApiKey("");
      setOrchestratorModel("");
      setEmbeddingApiKey("");
      setTemperature(0.2);
      setLlmMasked({
        gemini: null,
        openai: null,
        anthropic: null,
        custom: null,
        embedding: null,
      });
      setTestResult(null);
      setLlmMessage({
        type: "success",
        text:
          locale === "vi"
            ? "Đã xóa toàn bộ cấu hình AI Agent Input & Model Gateway về mặc định thành công!"
            : "Successfully reset all AI Agent Input & Model Gateway settings to default!",
      });
      await refresh();
    } catch (err: any) {
      setLlmMessage({
        type: "error",
        text: err.message || (locale === "vi" ? "Lỗi khi reset cấu hình AI" : "Error resetting AI settings"),
      });
    } finally {
      setResettingLlm(false);
    }
  }

  async function handleTestLlm() {
    setTestingLlm(true);
    setTestResult(null);
    setLlmMessage(null);
    try {
      let activeKey = "";
      if (llmProvider === "gemini") activeKey = geminiApiKey;
      else if (llmProvider === "openai") activeKey = openaiApiKey;
      else if (llmProvider === "anthropic") activeKey = anthropicApiKey;

      const res = await testLlmConnection({
        provider: llmProvider === "auto" ? undefined : llmProvider,
        model: orchestratorModel.trim() || undefined,
        apiKey: activeKey.trim() || undefined,
        customLlmUrl: customLlmUrl.trim() || undefined,
        customLlmApiKey: customLlmApiKey.trim() || undefined,
        temperature,
      });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        latencyMs: 0,
        error: err.message || "Kiểm tra kết nối thất bại",
      });
    } finally {
      setTestingLlm(false);
    }
  }

  async function handleResetCompanyCost() {
    if (
      !window.confirm(
        "Xác nhận Reset chi phí TOÀN BỘ agent về $0 và tự động mở lại các agent đang bị khoá do vượt ngân sách?"
      )
    )
      return;
    setResetting(true);
    setMessage(null);
    try {
      const result = await resetCompanyCost();
      setMessage({
        type: "success",
        text: `Đã reset chi phí ${result.agentCount} agent, tự động mở lại ${result.unsuspendedCount} agent bị khoá do ngân sách.`,
      });
      await refresh();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Lỗi khi reset chi phí" });
    } finally {
      setResetting(false);
    }
  }

  async function handleSaveAuthChannels(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSavingAuthChannels(true);
    setAuthChannelsMessage(null);
    try {
      const res = await updateAuthChannelsSettings({
        googleLoginEnabled,
        googleClientId: googleClientId.trim(),
        zaloLoginEnabled,
      });
      setGoogleLoginEnabled(res.config.googleLoginEnabled);
      setGoogleClientId(res.config.googleClientId || "");
      setZaloLoginEnabled(res.config.zaloLoginEnabled !== undefined ? res.config.zaloLoginEnabled : true);
      setAuthChannelsMessage({
        type: "success",
        text: "Đã lưu cấu hình Kênh login thành công!",
      });
    } catch (err: any) {
      setAuthChannelsMessage({
        type: "error",
        text: err.message || "Lỗi khi lưu cấu hình Kênh login.",
      });
    } finally {
      setSavingAuthChannels(false);
    }
  }

  async function handleSaveCockpitNav(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSavingCockpitNav(true);
    setCockpitNavMessage(null);
    try {
      const isFounderUser = !currentUserEmail || currentUserEmail.toLowerCase() === "phuongtv2c11@gmail.com";
      const payloadToSave = {
        ...cockpitNavConfig,
        showSettings: isFounderUser ? true : cockpitNavConfig.showSettings,
      };
      const res = await updateCockpitNavConfig(payloadToSave, currentUserEmail);
      setCockpitNavConfig(res.config);
      setCockpitNavMessage({
        type: "success",
        text: "Đã lưu cấu hình hiển thị các nút bấm Executive Cockpit thành công!",
      });
    } catch (err: any) {
      setCockpitNavMessage({
        type: "error",
        text: err.message || "Lỗi khi lưu cấu hình hiển thị các nút bấm.",
      });
    } finally {
      setSavingCockpitNav(false);
    }
  }

  function generateRandomPassword() {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*";
    let pass = "";
    for (let i = 0; i < 12; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pass;
  }

  async function handleCreateAccount(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!newAccountEmail.trim()) {
      setAccountActionMessage({ type: "error", text: "Vui lòng nhập địa chỉ email tài khoản." });
      return;
    }
    if (!newAccountPassword.trim() || newAccountPassword.trim().length < 6) {
      setAccountActionMessage({ type: "error", text: "Mật khẩu phải có ít nhất 6 ký tự." });
      return;
    }

    setCreatingAccount(true);
    setAccountActionMessage(null);
    try {
      const res = await createSystemAccount({
        email: newAccountEmail.trim(),
        password: newAccountPassword.trim(),
        fullName: newAccountFullName.trim() || undefined,
        role: newAccountRole,
      });
      setAccountActionMessage({
        type: "success",
        text: `Đã tạo tài khoản ${res.account.email} với vai trò ${res.account.role.toUpperCase()} thành công!`,
      });
      setNewAccountEmail("");
      setNewAccountPassword("");
      setNewAccountFullName("");
      setNewAccountRole("operator");
      const updatedList = await fetchSystemAccounts().catch(() => []);
      setAccounts(updatedList);
    } catch (err: any) {
      setAccountActionMessage({
        type: "error",
        text: err.message || "Lỗi khi tạo tài khoản người dùng.",
      });
    } finally {
      setCreatingAccount(false);
    }
  }

  async function handleUpdateAccountRole(accountId: string, role: string) {
    try {
      const res = await updateSystemAccount(accountId, { role });
      setAccounts((prev) =>
        prev.map((acc) => (acc.id === accountId ? { ...acc, role: res.account.role } : acc))
      );
      setAccountActionMessage({
        type: "success",
        text: `Đã đổi vai trò tài khoản ${res.account.email} thành ${res.account.role.toUpperCase()}!`,
      });
    } catch (err: any) {
      setAccountActionMessage({
        type: "error",
        text: err.message || "Lỗi khi đổi vai trò tài khoản.",
      });
    }
  }

  async function handleResetPasswordSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!resettingPasswordAccount) return;
    if (!newResetPassword.trim() || newResetPassword.trim().length < 6) {
      setAccountActionMessage({ type: "error", text: "Mật khẩu mới phải có ít nhất 6 ký tự." });
      return;
    }

    setSubmittingResetPassword(true);
    try {
      await resetSystemAccountPassword(resettingPasswordAccount.id, newResetPassword.trim());
      setAccountActionMessage({
        type: "success",
        text: `Đã đặt lại mật khẩu thành công cho ${resettingPasswordAccount.email}!`,
      });
      setResettingPasswordAccount(null);
      setNewResetPassword("");
    } catch (err: any) {
      setAccountActionMessage({
        type: "error",
        text: err.message || "Lỗi khi đặt lại mật khẩu tài khoản.",
      });
    } finally {
      setSubmittingResetPassword(false);
    }
  }

  async function handleDeleteAccountSubmit() {
    if (!deletingAccount) return;
    setSubmittingDeleteAccount(true);
    try {
      await deleteSystemAccount(deletingAccount.id);
      setAccountActionMessage({
        type: "success",
        text: `Đã xóa tài khoản ${deletingAccount.email} thành công!`,
      });
      setAccounts((prev) => prev.filter((acc) => acc.id !== deletingAccount.id));
      setDeletingAccount(null);
    } catch (err: any) {
      setAccountActionMessage({
        type: "error",
        text: err.message || "Lỗi khi xóa tài khoản.",
      });
    } finally {
      setSubmittingDeleteAccount(false);
    }
  }

  async function handleSavePreferences(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSavingPrefs(true);
    setNotifMessage(null);
    try {
      const sanitizedPrefs = {
        ...prefs,
        customTelegramToken: cleanTelegramTokenInput(prefs.customTelegramToken || ""),
        customTelegramChatId: cleanTelegramChatIdInput(prefs.customTelegramChatId || ""),
        customTelegramRecipients: (prefs.customTelegramRecipients || []).map((r) => ({
          ...r,
          chatId: cleanTelegramChatIdInput(r.chatId || ""),
        })),
        customSmtpHost: prefs.customSmtpHost ? prefs.customSmtpHost.trim() : "",
        customSmtpPort: prefs.customSmtpPort ? String(prefs.customSmtpPort).trim() : "",
        customSmtpUser: prefs.customSmtpUser ? prefs.customSmtpUser.trim() : "",
        customSmtpPass: prefs.customSmtpPass ? prefs.customSmtpPass.trim() : "",
        customSmtpFrom: prefs.customSmtpFrom ? prefs.customSmtpFrom.trim() : "",
        customEmailRecipient: prefs.customEmailRecipient ? prefs.customEmailRecipient.trim() : "",
      };
      await updateNotificationPreferences(sanitizedPrefs);
      setPrefs(sanitizedPrefs);
      setSavedPrefs(sanitizedPrefs); // Đồng bộ snapshot sau khi lưu thành công
      const text = "Đã lưu cấu hình bộ lọc sự kiện và kênh thông báo của Founder.";
      setNotifMessage({
        type: "success",
        text,
      });
      setSaveNotifPopup({
        isOpen: true,
        type: "success",
        title: "Lưu cấu hình thành công",
        message: "Cấu hình kênh tiếp nhận và bộ lọc sự kiện thông báo của Founder đã được cập nhật thành công.",
        channelsSummary: [
          { name: "Telegram Bot", enabled: !!prefs.sendToTelegram },
          { name: "Zalo Bot", enabled: !!prefs.sendToZaloBot },
          { name: "Zalo Auth", enabled: !!prefs.sendToZalo },
          { name: "Email (SMTP)", enabled: !!prefs.sendToEmail },
        ],
      });
    } catch (err: any) {
      const errMsg = err.message || "Lỗi khi lưu cấu hình thông báo.";
      setNotifMessage({
        type: "error",
        text: errMsg,
      });
      setSaveNotifPopup({
        isOpen: true,
        type: "error",
        title: "Lưu cấu hình thất bại",
        message: errMsg,
      });
    } finally {
      setSavingPrefs(false);
    }
  }

  async function handleResetPreferences() {
    if (
      !window.confirm(
        "Bạn có chắc chắn muốn đặt lại toàn bộ cấu hình kênh thông báo về mặc định?\n\nToàn bộ token Bot, Chat ID, số điện thoại và phiên Zalo Auth sẽ bị xóa sạch để cài đặt từ đầu."
      )
    ) {
      return;
    }

    setResettingPrefs(true);
    setNotifMessage(null);
    try {
      const res = await resetNotificationPreferences();
      const resetData = { ...DEFAULT_PREFS, ...(res.preferences || {}) } as NotificationPreferences;
      if (!resetData.customTelegramRecipients || resetData.customTelegramRecipients.length === 0) {
        resetData.customTelegramRecipients = [
          { id: "1", chatId: "" },
        ];
      }
      if (!resetData.customZaloRecipients || resetData.customZaloRecipients.length === 0) {
        resetData.customZaloRecipients = [
          { id: "1", phone: "", groupId: "" },
        ];
      }
      if (!resetData.customZaloBotRecipients || resetData.customZaloBotRecipients.length === 0) {
        resetData.customZaloBotRecipients = [
          { id: "1", chatId: "", groupId: "" },
        ];
      }
      if (!resetData.customSmtpHost) resetData.customSmtpHost = "";
      if (!resetData.customSmtpPort) resetData.customSmtpPort = "";
      if (!resetData.customSmtpUser) resetData.customSmtpUser = "";
      if (!resetData.customSmtpPass) resetData.customSmtpPass = "";
      if (!resetData.customSmtpFrom) resetData.customSmtpFrom = "";
      if (!resetData.customEmailRecipient) resetData.customEmailRecipient = "";
      setPrefs(resetData);
      setSavedPrefs(resetData);
      if (res.status) {
        setNotifStatus(res.status);
      }
      setNotifMessage({
        type: "success",
        text: "Đã đặt lại toàn bộ cấu hình thông báo & xóa sạch token/session Zalo thành công!",
      });
      await refresh();
    } catch (err: any) {
      setNotifMessage({
        type: "error",
        text: err.message || "Lỗi khi đặt lại cấu hình thông báo.",
      });
    } finally {
      setResettingPrefs(false);
    }
  }

  const cleanTelegramTokenInput = (val: string) => {
    if (!val) return "";
    let token = val.trim();
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")) ||
      (token.startsWith("`") && token.endsWith("`"))
    ) {
      token = token.slice(1, -1).trim();
    }
    const prefixMatch = token.match(/^(?:TELEGRAM_BOT_TOKEN|TELEGRAM_TOKEN|BOT_TOKEN|TOKEN)\s*=\s*(.*)$/i);
    if (prefixMatch) {
      token = prefixMatch[1].trim();
    }
    const urlMatch = token.match(/api\.telegram\.org\/bot([^/?#\s]+)/i);
    if (urlMatch) {
      token = urlMatch[1].trim();
    }
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")) ||
      (token.startsWith("`") && token.endsWith("`"))
    ) {
      token = token.slice(1, -1).trim();
    }
    if (/^bot\d+:[A-Za-z0-9_-]+$/i.test(token)) {
      token = token.slice(3).trim();
    }
    return token.trim();
  };

  const cleanTelegramChatIdInput = (val: string) => {
    if (!val) return "";
    let id = val.trim();
    if (
      (id.startsWith('"') && id.endsWith('"')) ||
      (id.startsWith("'") && id.endsWith("'")) ||
      (id.startsWith("`") && id.endsWith("`"))
    ) {
      id = id.slice(1, -1).trim();
    }
    const prefixMatch = id.match(/^(?:TELEGRAM_CHAT_ID|CHAT_ID)\s*=\s*(.*)$/i);
    if (prefixMatch) {
      id = prefixMatch[1].trim();
    }
    if (
      (id.startsWith('"') && id.endsWith('"')) ||
      (id.startsWith("'") && id.endsWith("'")) ||
      (id.startsWith("`") && id.endsWith("`"))
    ) {
      id = id.slice(1, -1).trim();
    }
    return id.trim();
  };

  const handleAddTelegramRecipient = () => {
    setPrefs((p) => {
      const list =
        p.customTelegramRecipients && p.customTelegramRecipients.length > 0
          ? [...p.customTelegramRecipients]
          : [{ id: "1", chatId: p.customTelegramChatId || "" }];
      const newItem = { id: String(Date.now()), chatId: "" };
      return { ...p, customTelegramRecipients: [...list, newItem] };
    });
  };

  const handleUpdateTelegramRecipient = (id: string, value: string) => {
    const cleanedValue =
      value.includes("=") || value.includes('"') || value.includes("'")
        ? cleanTelegramChatIdInput(value)
        : value;
    setPrefs((p) => {
      const list =
        p.customTelegramRecipients && p.customTelegramRecipients.length > 0
          ? [...p.customTelegramRecipients]
          : [{ id: "1", chatId: p.customTelegramChatId || "" }];
      const updated = list.map((item) => (item.id === id ? { ...item, chatId: cleanedValue } : item));
      return {
        ...p,
        customTelegramRecipients: updated,
        customTelegramChatId: updated[0]?.chatId || "",
      };
    });
  };

  const handleRemoveTelegramRecipient = (id: string) => {
    setPrefs((p) => {
      const list = p.customTelegramRecipients || [];
      let updated = list.filter((item) => item.id !== id);
      if (updated.length === 0) {
        updated = [{ id: "1", chatId: "" }];
      }
      return {
        ...p,
        customTelegramRecipients: updated,
        customTelegramChatId: updated[0]?.chatId || "",
      };
    });
  };

  const handleAddZaloRecipient = () => {
    setPrefs((p) => {
      const list =
        p.customZaloRecipients && p.customZaloRecipients.length > 0
          ? [...p.customZaloRecipients]
          : [{ id: "1", phone: p.customZaloPhone || "", groupId: p.customZaloGroupId || "" }];
      const newItem = { id: String(Date.now()), phone: "", groupId: "" };
      return { ...p, customZaloRecipients: [...list, newItem] };
    });
  };

  const handleUpdateZaloRecipient = (id: string, field: "phone" | "groupId", value: string) => {
    setPrefs((p) => {
      const list =
        p.customZaloRecipients && p.customZaloRecipients.length > 0
          ? [...p.customZaloRecipients]
          : [{ id: "1", phone: p.customZaloPhone || "", groupId: p.customZaloGroupId || "" }];
      const updated = list.map((item) => (item.id === id ? { ...item, [field]: value } : item));
      return {
        ...p,
        customZaloRecipients: updated,
        customZaloPhone: updated[0]?.phone || "",
        customZaloGroupId: updated[0]?.groupId || "",
      };
    });
  };

  const handleRemoveZaloRecipient = (id: string) => {
    setPrefs((p) => {
      const list = p.customZaloRecipients || [];
      let updated = list.filter((item) => item.id !== id);
      if (updated.length === 0) {
        updated = [{ id: "1", phone: "", groupId: "" }];
      }
      return {
        ...p,
        customZaloRecipients: updated,
        customZaloPhone: updated[0]?.phone || "",
        customZaloGroupId: updated[0]?.groupId || "",
      };
    });
  };

  const handleAddZaloBotRecipient = () => {
    setPrefs((p) => {
      const list =
        p.customZaloBotRecipients && p.customZaloBotRecipients.length > 0
          ? [...p.customZaloBotRecipients]
          : [{ id: "1", chatId: p.customZaloBotChatId || "", groupId: "" }];
      const newItem = { id: String(Date.now()), chatId: "", groupId: "" };
      return { ...p, customZaloBotRecipients: [...list, newItem] };
    });
  };

  const handleUpdateZaloBotRecipient = (id: string, field: "chatId" | "groupId", value: string) => {
    setPrefs((p) => {
      const list =
        p.customZaloBotRecipients && p.customZaloBotRecipients.length > 0
          ? [...p.customZaloBotRecipients]
          : [{ id: "1", chatId: p.customZaloBotChatId || "", groupId: "" }];
      const updated = list.map((item) => (item.id === id ? { ...item, [field]: value } : item));
      return {
        ...p,
        customZaloBotRecipients: updated,
        customZaloBotChatId: updated[0]?.chatId || "",
      };
    });
  };

  const handleRemoveZaloBotRecipient = (id: string) => {
    setPrefs((p) => {
      const list = p.customZaloBotRecipients || [];
      let updated = list.filter((item) => item.id !== id);
      if (updated.length === 0) {
        updated = [{ id: "1", chatId: "", groupId: "" }];
      }
      return {
        ...p,
        customZaloBotRecipients: updated,
        customZaloBotChatId: updated[0]?.chatId || "",
      };
    });
  };

  function toggleAllEvents(enabled: boolean) {
    setPrefs((prev) => ({
      ...prev,
      notifyBudgetCapExceeded: enabled,
      notifyDecisionRequired: enabled,
      notifyBlockedTasks: enabled,
      notifyWeeklyReport: enabled,
      notifyEmergencyStop: enabled,
    }));
  }

  const sampleMessages: Record<
    string,
    { title: string; preview: string; rawText: string; severity: string; badge: string; badgeColor: string }
  > = {
    BUDGET_CAP: {
      title: "Vượt trần ngân sách AI (Budget Cap)",
      badge: "Cực kỳ quan trọng",
      badgeColor: "border-rose-500/30 bg-rose-500/10 text-rose-400",
      severity: "warning",
      preview: "Agent \"ai_analyst\" vượt trần ngân sách riêng ($9.00 / $0.01) — tự động SUSPENDED. Founder vào trang chi tiết Agent để tăng trần hoặc reset chi phí.",
      rawText: "🚨 *BUDGET CAP EXCEEDED*\n\nAgent \"ai_analyst\" vượt trần ngân sách riêng ($9.00 / $0.01) — tự động SUSPENDED.\n\nFounder vào trang chi tiết Agent để tăng trần hoặc reset chi phí.",
    },
    DECISION: {
      title: "Quyết định rủi ro cao (Decision Package R3/R4)",
      badge: "Cần phê duyệt",
      badgeColor: "border-amber-500/30 bg-amber-500/10 text-amber-400",
      severity: "warning",
      preview: "Agent \"ai_finance\" yêu cầu chạy tool \"execute_payment\". Risk: R3.\n\nVào Web app (cột \"Chờ phê duyệt\") để duyệt hoặc từ chối.",
      rawText: "⚠️ *Cần duyệt: execute_payment (R3)*\n\nAgent \"ai_finance\" yêu cầu chạy tool \"execute_payment\".\nRisk: R3\n\nVào Web app (cột \"Chờ phê duyệt\") để duyệt hoặc từ chối.",
    },
    BLOCKED_TASK: {
      title: "Task bị Blocked quá lâu (Stuck Tasks)",
      badge: "Cảnh báo trễ hạn",
      badgeColor: "border-orange-500/30 bg-orange-500/10 text-orange-400",
      severity: "warning",
      preview: "\"Triển khai chiến dịch marketing Q3\"\n\nAgent phụ trách: ai_marketer (Blocked > 60 phút)",
      rawText: "⚠️ *Task bị Blocked quá 60 phút*\n\n\"Triển khai chiến dịch marketing Q3\"\n\nAgent phụ trách: ai_marketer",
    },
    WEEKLY_REPORT: {
      title: "Báo cáo tổng kết tuần (Weekly Executive Digest)",
      badge: "Định kỳ thứ 2",
      badgeColor: "border-sky-500/30 bg-sky-500/10 text-sky-400",
      severity: "info",
      preview: "Tuần 2026-W38 — Đã hoàn thành 18 tasks, 2 Decision Packages đã duyệt. Tổng chi phí: $5.23 / $50.00.",
      rawText: "ℹ️ *Weekly Report sẵn sàng*\n\n=== AI-OPC WEEKLY REPORT (Tuần 2026-W38) ===\n• Tasks hoàn thành: 18\n• Decision Packages: 2 đã duyệt\n• Chi phí tiêu thụ: $5.23 / $50.00 trần\n• Agent trạng thái: 6 Ready, 0 Suspended",
    },
    EMERGENCY_STOP: {
      title: "Dừng khẩn cấp toàn hệ thống (/stop Killswitch)",
      badge: "Khẩn cấp hệ thống",
      badgeColor: "border-rose-500/30 bg-rose-500/10 text-rose-400",
      severity: "critical",
      preview: "Founder vừa gọi /stop — toàn bộ Agent đang hoạt động đã chuyển sang SUSPENDED ngay lập tức.",
      rawText: "🚨 *Emergency Stop đã kích hoạt*\n\nFounder vừa gọi /stop — toàn bộ Agent đang hoạt động đã chuyển sang SUSPENDED.",
    },
  };

  async function handleTestNotification() {
    setTestingNotif(true);
    setNotifMessage(null);
    try {
      const sample = sampleMessages[selectedTestEvent] || sampleMessages.BUDGET_CAP;
      const res = await sendTestNotification({
        category: selectedTestEvent,
        title: sample.title,
        message: sample.preview,
        severity: sample.severity,
      });
      const channelName = res?.deliveredChannel || "Kênh tiếp nhận";
      setNotifMessage({
        type: "success",
        text: `Đã gửi tin thử nghiệm [${sample.title}] thành công qua ${channelName}! (Hệ thống điều phối tuần tự failover 10s).`,
      });
    } catch (err: any) {
      setNotifMessage({
        type: "error",
        text: err.message || "Gửi thông báo thử nghiệm thất bại sau khi thử các kênh.",
      });
    } finally {
      setTestingNotif(false);
    }
  }

  function togglePreview(key: string) {
    setPreviewOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 pb-16">
      {/* Top navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" /> {t.settings.backLink}
        </Link>
        <div className="flex items-center gap-3">
          {/* Quick Expand / Collapse All Cards */}
          <div className="flex items-center rounded-xl border border-border/70 bg-panel/75 p-0.5 shadow-sm text-xs">
            <button
              type="button"
              onClick={expandAllCards}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-all cursor-pointer font-medium"
              title={locale === "vi" ? "Mở rộng toàn bộ các card" : "Expand all cards"}
            >
              <Maximize2 className="h-3 w-3 text-accent" />
              <span>{locale === "vi" ? "Mở tất cả" : "Expand all"}</span>
            </button>
            <span className="h-3 w-[1px] bg-border/60 mx-0.5" />
            <button
              type="button"
              onClick={collapseAllCards}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-all cursor-pointer font-medium"
              title={locale === "vi" ? "Thu hẹp toàn bộ các card" : "Collapse all cards"}
            >
              <Minimize2 className="h-3 w-3 text-zinc-400" />
              <span>{locale === "vi" ? "Thu hẹp tất cả" : "Collapse all"}</span>
            </button>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
            <Sparkles className="h-3.5 w-3.5" /> Company Governance &amp; Controls
          </span>
          <LanguageSwitcher />
        </div>
      </div>

      {/* Header Banner */}
      <div className="rounded-2xl border border-border/80 bg-panel/90 p-6 backdrop-blur-sm shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-inner">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-zinc-100">{t.settings.title}</h1>
                <p className="text-xs text-zinc-400">
                  {locale === "vi" ? "Kiểm soát chi tiêu AI toàn diện & Đẩy thông báo có chọn lọc ra Telegram / Email khi phát sinh sự kiện trọng yếu" : "Comprehensive AI spending control & real-time alerts dispatched via Telegram / Email on key events"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Global Stats Overview */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border/60 bg-canvas/60 p-4 transition-colors hover:border-border">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-emerald-400" /> Tổng chi phí đã dùng
              </span>
              <span className="font-mono text-[11px] text-zinc-500">{agents.length} agents</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-zinc-100">${totalSpentUsd.toFixed(4)}</p>
            {percentUsed !== null && (
              <div className="mt-2 space-y-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${percentUsed >= 100 ? "bg-rose-500" : percentUsed >= 80 ? "bg-amber-500" : "bg-emerald-500"
                      }`}
                    style={{ width: `${percentUsed}%` }}
                  />
                </div>
                <p className="text-right text-[10px] text-zinc-500">Đã dùng {percentUsed}% trần công ty</p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border/60 bg-canvas/60 p-4 transition-colors hover:border-border">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Building2 className="h-3.5 w-3.5 text-cyan-400" /> Trần ngân sách công ty
            </div>
            <p className="mt-2 text-2xl font-bold text-zinc-100">
              {budgetCapNumber != null ? `$${budgetCapNumber.toFixed(2)}` : "Không giới hạn"}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">Áp dụng cho toàn bộ hoạt động AI</p>
          </div>

          <div className="rounded-xl border border-border/60 bg-canvas/60 p-4 transition-colors hover:border-border">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Trạng thái khoá Agent
            </div>
            <p className="mt-2 text-2xl font-bold text-zinc-100">
              {suspendedAgents.length}{" "}
              <span className="text-xs font-normal text-zinc-400">/ {agents.length} agent tạm dừng</span>
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              {suspendedAgents.length > 0 ? "Cần tăng trần hoặc reset" : "Hoạt động bình thường"}
            </p>
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`flex items-center gap-2.5 rounded-xl border p-4 text-sm ${message.type === "success"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            : "border-rose-500/30 bg-rose-500/10 text-rose-300"
            }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Founder Notification System Configuration */}
      <div className={`rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl transition-all ${collapsedCards.notifChannels ? "space-y-0" : "space-y-6"}`}>
        {/* Section Header */}
        <div className={`flex flex-wrap items-center justify-between gap-4 ${collapsedCards.notifChannels ? "" : "border-b border-border/60 pb-4"}`}>
          <div
            className="space-y-0.5 cursor-pointer select-none"
            onClick={() => toggleCard("notifChannels")}
          >
            <div className="flex items-center gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                <Bell className="h-4 w-4 text-accent" /> Kênh tiếp nhận &amp; thông báo Founder
              </h2>
              {collapsedCards.notifChannels && (
                <span className="rounded-full border border-border/70 bg-canvas/70 px-2.5 py-0.5 text-[11px] font-mono text-zinc-300">
                  Telegram, Zalo, Email...
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400">
              Tùy chọn nhận thông báo qua Telegram / Email theo từng danh mục sự kiện cụ thể kèm xem trước nội dung mẫu.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!collapsedCards.notifChannels && (
              <>
                <button
                  type="button"
                  onClick={handleResetPreferences}
                  disabled={resettingPrefs || savingPrefs}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 transition-all hover:border-rose-500/50 hover:bg-rose-500/20 hover:text-rose-200 disabled:opacity-50"
                  title="Xóa toàn bộ token/cache/session Zalo để cài đặt từ đầu"
                >
                  {resettingPrefs ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5 text-rose-400" />
                  )}
                  <span>{resettingPrefs ? "Đang đặt lại..." : "Reset"}</span>
                </button>

                <button
                  onClick={handleSavePreferences}
                  disabled={savingPrefs || resettingPrefs}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-50"
                >
                  {savingPrefs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  <span>{savingPrefs ? "Đang lưu..." : "Lưu cấu hình"}</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => toggleCard("notifChannels")}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-canvas/60 text-zinc-400 hover:text-zinc-100 hover:border-border transition-all cursor-pointer shadow-sm"
              title={collapsedCards.notifChannels ? "Mở rộng card" : "Thu hẹp card"}
            >
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${collapsedCards.notifChannels ? "-rotate-90 text-zinc-400" : "rotate-0 text-accent"}`} />
            </button>
          </div>
        </div>

        {!collapsedCards.notifChannels && (
          <>
            {/* Channels Control Grid */}
            <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
              1. Kênh tiếp nhận thông báo
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Telegram Card */}
            <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-zinc-200">Telegram Bot</p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${notifStatus?.channelsHealth?.telegram?.inCooldown
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                          : notifStatus?.telegram
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-zinc-800 text-zinc-500 border-zinc-700"
                          }`}
                      >
                        {notifStatus?.channelsHealth?.telegram?.inCooldown
                          ? "Mạng chập chờn — Tự động Failover"
                          : notifStatus?.telegram
                            ? "Đã kết nối"
                            : "Chưa cấu hình .env"}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">Khuyên dùng — tức thì, 0 độ trễ</p>
                  </div>
                </div>

                {/* Switch Toggle */}
                <button
                  type="button"
                  onClick={() => {
                    const willDisable = prefs.sendToTelegram;
                    if (willDisable && savedPrefs.sendToTelegram) {
                      // Kênh hiện đang BẬT và đã được lưu — gửi lời tạm biệt ngay
                      void sendChannelFarewell("telegram");
                    }
                    setPrefs((p) => ({ ...p, sendToTelegram: !p.sendToTelegram }));
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.sendToTelegram ? "bg-accent" : "bg-zinc-800"
                    }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.sendToTelegram ? "translate-x-5" : "translate-x-0"
                      }`}
                  />
                </button>
              </div>

              {/* Ô nhập TELEGRAM_BOT_TOKEN (Luôn ẩn nội dung đã nhập) */}
              <div className="mt-3 border-t border-border/40 pt-2.5">
                <label className="text-[11px] text-zinc-300 font-medium block mb-1">
                  🔑 Telegram Bot Token (Ghi đè token trong <code>.env</code>):
                </label>
                <input
                  type="password"
                  placeholder="Nhập Telegram Bot Token (để trống để dùng token mặc định trong .env)"
                  value={prefs.customTelegramToken || ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const cleaned =
                      raw.includes("=") || raw.includes('"') || raw.includes("'") || raw.includes("api.telegram.org")
                        ? cleanTelegramTokenInput(raw)
                        : raw;
                    setPrefs((p) => ({ ...p, customTelegramToken: cleaned }));
                  }}
                  onBlur={(e) => {
                    const cleaned = cleanTelegramTokenInput(e.target.value);
                    setPrefs((p) => ({ ...p, customTelegramToken: cleaned }));
                  }}
                  className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-sky-500 font-mono tracking-wider"
                  autoComplete="off"
                />
                <p className="mt-1 text-[10px] text-zinc-500">
                  Token này sẽ được ưu tiên sử dụng thay thế cho <code>TELEGRAM_BOT_TOKEN</code> trong file <code>.env</code>.
                </p>
              </div>

              {/* Danh sách người nhận Telegram Bot động */}
              <div className="mt-3 border-t border-border/40 pt-2.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-zinc-300 font-medium">
                    Danh sách Telegram Chat ID nhận tin:
                  </span>
                  <button
                    type="button"
                    onClick={handleAddTelegramRecipient}
                    className="text-xs font-medium text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 rounded-lg px-2.5 py-1 flex items-center gap-1 transition-all shadow-sm cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Thêm nữa</span>
                  </button>
                </div>

                {(
                  prefs.customTelegramRecipients && prefs.customTelegramRecipients.length > 0
                    ? prefs.customTelegramRecipients
                    : [{ id: "1", chatId: prefs.customTelegramChatId || "" }]
                ).map((rec, index) => (
                  <div
                    key={rec.id || index}
                    className="relative rounded-lg border border-border/50 bg-zinc-950/40 p-2.5 transition-all hover:border-border/80"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-semibold text-sky-400/90 flex items-center gap-1">
                        <span>🤖 Đích nhận Telegram Bot #{index + 1}</span>
                        {index === 0 && <span className="text-[9px] text-zinc-500 font-normal">(Mặc định / Ưu tiên)</span>}
                      </span>
                      {(prefs.customTelegramRecipients?.length || 1) > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveTelegramRecipient(rec.id)}
                          className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-rose-500/10 transition-colors cursor-pointer"
                          title="Xóa đích nhận này"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Xóa</span>
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-1">
                        Telegram Chat ID nhận tin:
                      </label>
                      <input
                        type="text"
                        placeholder={
                          index === 0
                            ? "Để trống dùng Chat ID mặc định trong .env"
                            : "vd: 123456789 (Chat ID cá nhân hoặc nhóm)"
                        }
                        value={rec.chatId || ""}
                        onChange={(e) => handleUpdateTelegramRecipient(rec.id, e.target.value)}
                        onBlur={(e) =>
                          handleUpdateTelegramRecipient(rec.id, cleanTelegramChatIdInput(e.target.value))
                        }
                        className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Zalo Bot Card (Bot Platform) */}
            <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
                    <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.08L2 22l5.12-1.35C8.55 21.49 10.23 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-zinc-200">Zalo Bot</p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${notifStatus?.channelsHealth?.zaloBot?.inCooldown
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                            : notifStatus?.zaloBot
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-zinc-800 text-zinc-500 border-zinc-700"
                          }`}
                      >
                        {notifStatus?.channelsHealth?.zaloBot?.inCooldown
                          ? "Mạng chập chờn — Tự động Failover"
                          : notifStatus?.zaloBot
                            ? "Đã kết nối"
                            : "Chưa cấu hình .env"}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">Bot Platform (giống Telegram) — Long Polling</p>
                  </div>
                </div>

                {/* Switch Toggle */}
                <button
                  type="button"
                  onClick={() => {
                    const willDisable = prefs.sendToZaloBot;
                    if (willDisable && savedPrefs.sendToZaloBot) {
                      void sendChannelFarewell("zaloBot");
                    }
                    setPrefs((p) => ({ ...p, sendToZaloBot: !p.sendToZaloBot }));
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.sendToZaloBot ? "bg-teal-500" : "bg-zinc-800"
                    }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.sendToZaloBot ? "translate-x-5" : "translate-x-0"
                      }`}
                  />
                </button>
              </div>

              {/* Ô nhập ZALO_BOT_TOKEN (Luôn ẩn nội dung đã nhập) */}
              <div className="mt-3 border-t border-border/40 pt-2.5">
                <label className="text-[11px] text-zinc-300 font-medium block mb-1">
                  🔑 Zalo Bot Token (Ghi đè token trong <code>.env</code>):
                </label>
                <input
                  type="password"
                  placeholder="Nhập Zalo Bot Token (để trống để dùng token mặc định trong .env)"
                  value={prefs.customZaloBotToken || ""}
                  onChange={(e) => setPrefs((p) => ({ ...p, customZaloBotToken: e.target.value }))}
                  className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-teal-500 font-mono tracking-wider"
                  autoComplete="off"
                />
                <p className="mt-1 text-[10px] text-zinc-500">
                  Token này sẽ được ưu tiên sử dụng thay thế cho <code>ZALO_BOT_TOKEN</code> trong file <code>.env</code>.
                </p>
              </div>

              {/* Danh sách người nhận / Nhóm Zalo Bot động */}
              <div className="mt-3 border-t border-border/40 pt-2.5 space-y-2.5">
                {(
                  prefs.customZaloBotRecipients && prefs.customZaloBotRecipients.length > 0
                    ? prefs.customZaloBotRecipients
                    : [{ id: "1", chatId: prefs.customZaloBotChatId || "", groupId: "" }]
                ).map((rec, index) => (
                  <div
                    key={rec.id || index}
                    className="relative rounded-lg border border-border/50 bg-zinc-950/40 p-2.5 transition-all hover:border-border/80"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-semibold text-teal-400/90 flex items-center gap-1">
                        <span>🤖 Đích nhận Zalo Bot #{index + 1}</span>
                        {index === 0 && <span className="text-[9px] text-zinc-500 font-normal">(Mặc định / Ưu tiên)</span>}
                      </span>
                      {(prefs.customZaloBotRecipients?.length || 1) > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveZaloBotRecipient(rec.id)}
                          className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-rose-500/10 transition-colors cursor-pointer"
                          title="Xóa đích nhận này"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Xóa</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className="text-[10px] text-zinc-400 block mb-1">
                          1. Zalo Chat ID nhận tin:
                        </label>
                        <input
                          type="text"
                          placeholder={
                            index === 0
                              ? "Để trống dùng Chat ID mặc định trong .env"
                              : "vd: 1234567890 (Chat ID người nhận)"
                          }
                          value={rec.chatId || ""}
                          onChange={(e) => handleUpdateZaloBotRecipient(rec.id, "chatId", e.target.value)}
                          className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-teal-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-400 block mb-1">
                          2. Nhập text / ID nhóm Zalo:
                        </label>
                        <input
                          type="text"
                          placeholder="vd: group_bot_123 hoặc ID nhóm"
                          value={rec.groupId || ""}
                          onChange={(e) => handleUpdateZaloBotRecipient(rec.id, "groupId", e.target.value)}
                          className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-teal-500"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {/* Nút Thêm nữa */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleAddZaloBotRecipient}
                    className="text-xs font-medium text-teal-400 hover:text-teal-300 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Thêm nữa</span>
                  </button>
                  <span className="text-[10px] text-zinc-500">
                    Lệnh: <code>/status</code>, <code>/stop</code>, <code>/goal</code>, <code>duyệt &lt;MÃ&gt;</code>, <code>từ chối &lt;MÃ&gt;</code>
                  </span>
                </div>
              </div>
            </div>

            {/* Email Card (SMTP) */}
            <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all hover:border-border sm:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-zinc-200">Email (SMTP)</p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${notifStatus?.email
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-zinc-800 text-zinc-500 border-zinc-700"
                          }`}
                      >
                        {notifStatus?.email ? "Đã kết nối" : "Chưa cấu hình"}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">Gmail App Password, SMTP Relay — Tùy biến hoặc lấy mặc định từ <code>.env</code></p>
                  </div>
                </div>

                {/* Switch Toggle */}
                <button
                  type="button"
                  onClick={() => {
                    const willDisable = prefs.sendToEmail;
                    if (willDisable && savedPrefs.sendToEmail) {
                      void sendChannelFarewell("email");
                    }
                    setPrefs((p) => ({ ...p, sendToEmail: !p.sendToEmail }));
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.sendToEmail ? "bg-accent" : "bg-zinc-800"
                    }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.sendToEmail ? "translate-x-5" : "translate-x-0"
                      }`}
                  />
                </button>
              </div>

              {/* Form cấu hình Email SMTP */}
              <div className="mt-3 border-t border-border/40 pt-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-[11px] text-zinc-300 font-medium">
                    ⚙️ Cấu hình thông số máy chủ Email SMTP (Ghi đè giá trị trong <code>.env</code>):
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    * Để trống ô nào hệ thống sẽ tự động dùng giá trị mặc định từ file <code>.env</code>
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {/* SMTP_HOST */}
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">
                      1. SMTP Host (<code>SMTP_HOST</code>):
                    </label>
                    <input
                      type="text"
                      placeholder="vd: smtp.gmail.com"
                      value={prefs.customSmtpHost || ""}
                      onChange={(e) => setPrefs((p) => ({ ...p, customSmtpHost: e.target.value }))}
                      className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-purple-500"
                    />
                  </div>

                  {/* SMTP_PORT */}
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">
                      2. SMTP Port (<code>SMTP_PORT</code>):
                    </label>
                    <input
                      type="text"
                      placeholder="vd: 587 (TLS) hoặc 465 (SSL)"
                      value={prefs.customSmtpPort !== undefined && prefs.customSmtpPort !== null ? String(prefs.customSmtpPort) : ""}
                      onChange={(e) => setPrefs((p) => ({ ...p, customSmtpPort: e.target.value }))}
                      className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-purple-500"
                    />
                  </div>

                  {/* SMTP_USER */}
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">
                      3. SMTP User / Email gửi (<code>SMTP_USER</code>):
                    </label>
                    <input
                      type="text"
                      placeholder="vd: your-email@gmail.com"
                      value={prefs.customSmtpUser || ""}
                      onChange={(e) => setPrefs((p) => ({ ...p, customSmtpUser: e.target.value }))}
                      className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-purple-500"
                    />
                  </div>

                  {/* SMTP_PASS */}
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">
                      4. SMTP Pass / App Password (<code>SMTP_PASS</code>):
                    </label>
                    <div className="relative">
                      <input
                        type={showSmtpPass ? "text" : "password"}
                        placeholder="Mật khẩu ứng dụng Gmail (16 ký tự)"
                        value={prefs.customSmtpPass || ""}
                        onChange={(e) => setPrefs((p) => ({ ...p, customSmtpPass: e.target.value }))}
                        className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1.5 pr-8 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-purple-500 font-mono tracking-wider"
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSmtpPass((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                        title={showSmtpPass ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                      >
                        {showSmtpPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* SMTP_FROM */}
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">
                      5. Tên / Email người gửi (<code>SMTP_FROM</code>):
                    </label>
                    <input
                      type="text"
                      placeholder="vd: AI-OPC Founder <notifications@company.com>"
                      value={prefs.customSmtpFrom || ""}
                      onChange={(e) => setPrefs((p) => ({ ...p, customSmtpFrom: e.target.value }))}
                      className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-purple-500"
                    />
                  </div>

                  {/* FOUNDER_NOTIFY_EMAIL */}
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">
                      6. Email Founder nhận tin (<code>FOUNDER_NOTIFY_EMAIL</code>):
                    </label>
                    <input
                      type="email"
                      placeholder="founder@company.com"
                      value={prefs.customEmailRecipient || ""}
                      onChange={(e) => setPrefs((p) => ({ ...p, customEmailRecipient: e.target.value }))}
                      className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Zalo Auth Card */}
            <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all hover:border-border sm:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0068FF]/15 text-[#0068FF] border border-blue-500/30">
                    <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.08L2 22l5.12-1.35C8.55 21.49 10.23 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-zinc-200">Zalo Auth</p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${notifStatus?.zaloDetails?.sessionConnected
                          ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                          : "bg-zinc-800 text-zinc-500 border-zinc-700"
                          }`}
                      >
                        {notifStatus?.zaloDetails?.sessionConnected
                          ? `Đã kết nối (UID: ${notifStatus.zaloDetails.uid || "Sẵn sàng"})`
                          : "Chưa có phiên Zalo"}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Sử dụng phiên Zalo đã đăng nhập làm nguồn gửi tin nhắn thông báo tự động
                    </p>
                  </div>
                </div>

                {/* Switch Toggle */}
                <button
                  type="button"
                  onClick={() => {
                    const willDisable = prefs.sendToZalo;
                    if (willDisable && savedPrefs.sendToZalo) {
                      void sendChannelFarewell("zalo");
                    }
                    setPrefs((p) => ({ ...p, sendToZalo: !p.sendToZalo }));
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.sendToZalo ? "bg-[#0068FF]" : "bg-zinc-800"
                    }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.sendToZalo ? "translate-x-5" : "translate-x-0"
                      }`}
                  />
                </button>
              </div>

              {/* Zalo Founder nhận tin (mặc định lấy từ .env) */}
              <div className="mt-3 border-t border-border/40 pt-2.5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-zinc-300">
                    Zalo Founder nhận tin (mặc định lấy từ <code>.env</code>):
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        openZaloAuthPopup();
                      }}
                      className="text-[10px] font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-lg px-2 py-1 flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <span>{notifStatus?.zaloDetails?.sessionConnected ? "Quét lại mã QR (Popup)" : "Xác thực qua Zalo (Popup)"}</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsZaloModalOpen(true)}
                      className="text-[10px] text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
                    >
                      Hướng dẫn API
                    </button>
                  </div>
                </div>

                {/* Danh sách người nhận / Nhóm Zalo động */}
                <div className="space-y-2.5">
                  {(
                    prefs.customZaloRecipients && prefs.customZaloRecipients.length > 0
                      ? prefs.customZaloRecipients
                      : [{ id: "1", phone: prefs.customZaloPhone || "", groupId: prefs.customZaloGroupId || "" }]
                  ).map((rec, index) => (
                    <div
                      key={rec.id || index}
                      className="relative rounded-lg border border-border/50 bg-zinc-950/40 p-2.5 transition-all hover:border-border/80"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-semibold text-blue-400/90 flex items-center gap-1">
                          <span>👤 Đích nhận #{index + 1}</span>
                          {index === 0 && <span className="text-[9px] text-zinc-500 font-normal">(Mặc định / Ưu tiên)</span>}
                        </span>
                        {(prefs.customZaloRecipients?.length || 1) > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveZaloRecipient(rec.id)}
                            className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title="Xóa đích nhận này"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Xóa</span>
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <div>
                          <label className="text-[10px] text-zinc-400 block mb-1">
                            1. Nhập số điện thoại người nhận:
                          </label>
                          <input
                            type="text"
                            placeholder={
                              index === 0 && notifStatus?.zaloDetails?.defaultPhone
                                ? `Mặc định .env: ${notifStatus.zaloDetails.defaultPhone}`
                                : "vd: 0912345678 (để trống dùng .env)"
                            }
                            value={rec.phone || ""}
                            onChange={(e) => handleUpdateZaloRecipient(rec.id, "phone", e.target.value)}
                            className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-zinc-400 block mb-1">
                            2. Nhập text / ID nhóm Zalo:
                          </label>
                          <input
                            type="text"
                            placeholder={
                              index === 0 && notifStatus?.zaloDetails?.defaultGroupId
                                ? `Mặc định .env: ${notifStatus.zaloDetails.defaultGroupId}`
                                : "vd: group_id_xyz (để trống dùng .env)"
                            }
                            value={rec.groupId || ""}
                            onChange={(e) => handleUpdateZaloRecipient(rec.id, "groupId", e.target.value)}
                            className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Nút Thêm nữa */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleAddZaloRecipient}
                    className="text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Thêm nữa</span>
                  </button>
                  <span className="text-[10px] text-zinc-500">
                    Hệ thống sẽ broadcast đồng thời tới tất cả SĐT & Nhóm Zalo được thêm
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Event Triggers Filter Section */}
        <div className="space-y-3 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5 text-accent" /> 2. Bộ lọc sự kiện gửi báo cáo
            </span>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => toggleAllEvents(true)}
                className="text-accent hover:underline flex items-center gap-1 text-[11px]"
              >
                <CheckCheck className="h-3 w-3" /> Bật tất cả
              </button>
              <span className="text-zinc-600">•</span>
              <button
                type="button"
                onClick={() => toggleAllEvents(false)}
                className="text-zinc-400 hover:text-zinc-200 text-[11px]"
              >
                Tắt tất cả
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {/* Event 1: Budget Cap Exceeded */}
            <div
              className={`rounded-xl border transition-all ${prefs.notifyBudgetCapExceeded
                ? "border-rose-500/30 bg-rose-500/5"
                : "border-border/60 bg-canvas/40 opacity-70"
                } p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <DollarSign className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xs font-semibold text-zinc-100">
                        Vượt trần ngân sách AI (BUDGET CAP EXCEEDED)
                      </h3>
                      <span className="inline-flex rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-400">
                        Cực kỳ quan trọng
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Gửi ngay khi một Agent vượt trần riêng hoặc Toàn bộ công ty chạm trần chi phí tháng (tự động SUSPENDED).
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => togglePreview("BUDGET_CAP")}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-white/5"
                  >
                    {previewOpen.BUDGET_CAP ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    <span className="hidden sm:inline">{previewOpen.BUDGET_CAP ? "Ẩn mẫu" : "Xem mẫu"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPrefs((p) => ({ ...p, notifyBudgetCapExceeded: !p.notifyBudgetCapExceeded }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.notifyBudgetCapExceeded ? "bg-accent" : "bg-zinc-800"
                      }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.notifyBudgetCapExceeded ? "translate-x-5" : "translate-x-0"
                        }`}
                    />
                  </button>
                </div>
              </div>

              {previewOpen.BUDGET_CAP && (
                <div className="mt-3 rounded-lg border border-border/80 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 leading-relaxed shadow-inner">
                  <div className="text-zinc-500 text-[10px] mb-1 flex items-center justify-between">
                    <span>MẪU THÔNG BÁO THỰC TẾ (TELEGRAM / EMAIL):</span>
                    <span className="text-rose-400 font-semibold">🚨 SEVERITY: WARNING / CRITICAL</span>
                  </div>
                  <p className="text-rose-400 font-semibold">🚨 *BUDGET CAP EXCEEDED*</p>
                  <p className="mt-1 text-zinc-300">
                    Agent "ai_analyst" (ai_analyst) vượt trần ngân sách riêng ($9.00 / $0.01) — tự động SUSPENDED.
                  </p>
                  <p className="mt-1 text-zinc-400 text-[10px]">
                    Founder vào trang chi tiết Agent để tăng trần hoặc reset chi phí.
                  </p>
                </div>
              )}
            </div>

            {/* Event 2: High Risk Decision Required */}
            <div
              className={`rounded-xl border transition-all ${prefs.notifyDecisionRequired
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-border/60 bg-canvas/40 opacity-70"
                } p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Scale className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xs font-semibold text-zinc-100">
                        Quyết định rủi ro cao &amp; Phê duyệt (DECISION PACKAGE R3/R4)
                      </h3>
                      <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                        Cần phê duyệt
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Gửi khi Agent cần chạy các tool rủi ro cao hoặc vượt thẩm quyền tự chủ cần Founder duyệt.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => togglePreview("DECISION")}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-white/5"
                  >
                    {previewOpen.DECISION ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    <span className="hidden sm:inline">{previewOpen.DECISION ? "Ẩn mẫu" : "Xem mẫu"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPrefs((p) => ({ ...p, notifyDecisionRequired: !p.notifyDecisionRequired }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.notifyDecisionRequired ? "bg-accent" : "bg-zinc-800"
                      }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.notifyDecisionRequired ? "translate-x-5" : "translate-x-0"
                        }`}
                    />
                  </button>
                </div>
              </div>

              {previewOpen.DECISION && (
                <div className="mt-3 rounded-lg border border-border/80 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 leading-relaxed shadow-inner">
                  <div className="text-zinc-500 text-[10px] mb-1 flex items-center justify-between">
                    <span>MẪU THÔNG BÁO THỰC TẾ (TELEGRAM / EMAIL):</span>
                    <span className="text-amber-400 font-semibold">⚠️ SEVERITY: WARNING / CRITICAL</span>
                  </div>
                  <p className="text-amber-400 font-semibold">⚠️ *Cần duyệt: execute_payment (R3)*</p>
                  <p className="mt-1 text-zinc-300">
                    Agent "ai_finance" yêu cầu chạy tool "execute_payment". Risk: R3
                  </p>
                  <p className="mt-1 text-zinc-400 text-[10px]">
                    Vào Web app (cột "Chờ phê duyệt") để duyệt hoặc từ chối.
                  </p>
                </div>
              )}
            </div>

            {/* Event 3: Blocked Tasks */}
            <div
              className={`rounded-xl border transition-all ${prefs.notifyBlockedTasks
                ? "border-orange-500/30 bg-orange-500/5"
                : "border-border/60 bg-canvas/40 opacity-70"
                } p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20">
                    <Ban className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xs font-semibold text-zinc-100">
                        Nhiệm vụ bị nghẽn quá lâu (BLOCKED TASKS)
                      </h3>
                      <span className="inline-flex rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-400">
                        Cảnh báo trễ hạn
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Gửi khi một task bị tắc ở trạng thái BLOCKED quá thời gian cấu hình (mặc định 60 phút) chưa xử lý.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => togglePreview("BLOCKED_TASK")}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-white/5"
                  >
                    {previewOpen.BLOCKED_TASK ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    <span className="hidden sm:inline">{previewOpen.BLOCKED_TASK ? "Ẩn mẫu" : "Xem mẫu"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPrefs((p) => ({ ...p, notifyBlockedTasks: !p.notifyBlockedTasks }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.notifyBlockedTasks ? "bg-accent" : "bg-zinc-800"
                      }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.notifyBlockedTasks ? "translate-x-5" : "translate-x-0"
                        }`}
                    />
                  </button>
                </div>
              </div>

              {previewOpen.BLOCKED_TASK && (
                <div className="mt-3 rounded-lg border border-border/80 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 leading-relaxed shadow-inner">
                  <div className="text-zinc-500 text-[10px] mb-1 flex items-center justify-between">
                    <span>MẪU THÔNG BÁO THỰC TẾ (TELEGRAM / EMAIL):</span>
                    <span className="text-orange-400 font-semibold">⚠️ SEVERITY: WARNING</span>
                  </div>
                  <p className="text-orange-400 font-semibold">⚠️ *Task bị Blocked quá 60 phút*</p>
                  <p className="mt-1 text-zinc-300">
                    "Tích hợp cổng thanh toán MoMo và VietQR cho khách sạn"
                  </p>
                  <p className="mt-1 text-zinc-400 text-[10px]">Agent phụ trách: ai_engineer</p>
                </div>
              )}
            </div>

            {/* Event 4: Weekly Report */}
            <div
              className={`rounded-xl border transition-all ${prefs.notifyWeeklyReport
                ? "border-sky-500/30 bg-sky-500/5"
                : "border-border/60 bg-canvas/40 opacity-70"
                } p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xs font-semibold text-zinc-100">
                        Báo cáo tổng kết tuần (WEEKLY EXECUTIVE DIGEST)
                      </h3>
                      <span className="inline-flex rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-400">
                        Định kỳ thứ 2 &amp; /report
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Tự động gửi báo cáo tổng kết tiến độ tasks, chi phí và trạng thái agent vào 8h-10h sáng thứ 2 hàng tuần hoặc khi gõ /report.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => togglePreview("WEEKLY_REPORT")}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-white/5"
                  >
                    {previewOpen.WEEKLY_REPORT ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    <span className="hidden sm:inline">{previewOpen.WEEKLY_REPORT ? "Ẩn mẫu" : "Xem mẫu"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPrefs((p) => ({ ...p, notifyWeeklyReport: !p.notifyWeeklyReport }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.notifyWeeklyReport ? "bg-accent" : "bg-zinc-800"
                      }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.notifyWeeklyReport ? "translate-x-5" : "translate-x-0"
                        }`}
                    />
                  </button>
                </div>
              </div>

              {previewOpen.WEEKLY_REPORT && (
                <div className="mt-3 rounded-lg border border-border/80 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 leading-relaxed shadow-inner">
                  <div className="text-zinc-500 text-[10px] mb-1 flex items-center justify-between">
                    <span>MẪU THÔNG BÁO THỰC TẾ (TELEGRAM / EMAIL):</span>
                    <span className="text-sky-400 font-semibold">ℹ️ SEVERITY: INFO</span>
                  </div>
                  <p className="text-sky-400 font-semibold">ℹ️ *Weekly Report sẵn sàng*</p>
                  <p className="mt-1 text-zinc-300 whitespace-pre-line">
                    === AI-OPC WEEKLY REPORT (Tuần 2026-W38) ==={"\n"}
                    • Tasks hoàn thành tuần này: 14{"\n"}
                    • Decision Packages: 3 đã duyệt, 0 từ chối{"\n"}
                    • Chi phí tiêu thụ: $4.85 / $50.00 trần{"\n"}
                    • Trạng thái Agent: 6 Ready, 0 Suspended
                  </p>
                </div>
              )}
            </div>

            {/* Event 5: Emergency Stop */}
            <div
              className={`rounded-xl border transition-all ${prefs.notifyEmergencyStop
                ? "border-rose-500/30 bg-rose-500/5"
                : "border-border/60 bg-canvas/40 opacity-70"
                } p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <Power className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xs font-semibold text-zinc-100">
                        Dừng khẩn cấp toàn hệ thống (EMERGENCY STOP /STOP)
                      </h3>
                      <span className="inline-flex rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-400">
                        Khẩn cấp hệ thống
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Gửi cảnh báo tức thời khi Founder ra lệnh /stop để đình chỉ khẩn cấp mọi hoạt động Agent.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => togglePreview("EMERGENCY_STOP")}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-white/5"
                  >
                    {previewOpen.EMERGENCY_STOP ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    <span className="hidden sm:inline">{previewOpen.EMERGENCY_STOP ? "Ẩn mẫu" : "Xem mẫu"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPrefs((p) => ({ ...p, notifyEmergencyStop: !p.notifyEmergencyStop }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${prefs.notifyEmergencyStop ? "bg-accent" : "bg-zinc-800"
                      }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${prefs.notifyEmergencyStop ? "translate-x-5" : "translate-x-0"
                        }`}
                    />
                  </button>
                </div>
              </div>

              {previewOpen.EMERGENCY_STOP && (
                <div className="mt-3 rounded-lg border border-border/80 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 leading-relaxed shadow-inner">
                  <div className="text-zinc-500 text-[10px] mb-1 flex items-center justify-between">
                    <span>MẪU THÔNG BÁO THỰC TẾ (TELEGRAM / EMAIL):</span>
                    <span className="text-rose-400 font-semibold">🚨 SEVERITY: CRITICAL</span>
                  </div>
                  <p className="text-rose-400 font-semibold">🚨 *Emergency Stop đã kích hoạt*</p>
                  <p className="mt-1 text-zinc-300">
                    Founder vừa gọi /stop — toàn bộ Agent đang hoạt động đã chuyển sang SUSPENDED.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Live Test Notification Box */}
        <div className="rounded-xl border border-border/60 bg-zinc-950/40 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5 text-accent" /> Thử nghiệm gửi thông báo trực tiếp
              </h3>
              <p className="text-[11px] text-zinc-400">
                Chọn loại sự kiện để gửi ngay một tin nhắn mẫu thực tế về Telegram Bot / Email đã cấu hình.
              </p>
            </div>

            <button
              onClick={handleTestNotification}
              disabled={testingNotif || !notifStatus?.anyConfigured}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-50"
            >
              {testingNotif ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Đang gửi test...</span>
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  <span>Gửi tin mẫu ngay</span>
                </>
              )}
            </button>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {Object.entries(sampleMessages).map(([key, item]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedTestEvent(key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-all ${selectedTestEvent === key
                  ? "bg-accent/15 border-accent text-accent"
                  : "bg-white/5 border-border/60 text-zinc-400 hover:text-zinc-200 hover:border-border"
                  }`}
              >
                {item.title}
              </button>
            ))}
          </div>

          {notifStatus && !notifStatus.anyConfigured && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Chưa có kênh nào (Telegram hoặc Email) được cấu hình trong <code>services/api/.env</code>. Vui lòng cấu hình ít nhất 1 kênh để nhận thông báo.
              </span>
            </div>
          )}
        </div>

        {notifMessage && (
          <div
            className={`flex items-center gap-2 rounded-xl border p-3.5 text-xs ${notifMessage.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
          >
            {notifMessage.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            )}
            <span>{notifMessage.text}</span>
          </div>
        )}
          </>
        )}
      </div>

      {/* Card Tài khoản & Kênh login */}
      <div className={`rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl backdrop-blur-sm transition-all ${collapsedCards.account ? "space-y-0" : "space-y-6"}`}>
        {/* Section Header */}
        <div className={`flex flex-wrap items-center justify-between gap-4 ${collapsedCards.account ? "" : "border-b border-border/60 pb-4"}`}>
          <div
            className="space-y-0.5 cursor-pointer select-none"
            onClick={() => toggleCard("account")}
          >
            <div className="flex items-center gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                <UserCheck className="h-4 w-4 text-accent" /> Tài khoản
              </h2>
              {collapsedCards.account && (
                <span className="rounded-full border border-border/70 bg-canvas/70 px-2.5 py-0.5 text-[11px] font-mono text-zinc-300">
                  {currentUserEmail || "phuongtv2c11@gmail.com"}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400">
              Quản lý tài khoản đăng nhập, phương thức xác thực và các kênh liên kết của Founder.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!collapsedCards.account && (
              <button
                type="button"
                onClick={handleSaveAuthChannels}
                disabled={savingAuthChannels}
                className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                {savingAuthChannels ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                <span>{savingAuthChannels ? "Đang lưu..." : "Lưu cấu hình"}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => toggleCard("account")}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-canvas/60 text-zinc-400 hover:text-zinc-100 hover:border-border transition-all cursor-pointer shadow-sm"
              title={collapsedCards.account ? "Mở rộng card" : "Thu hẹp card"}
            >
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${collapsedCards.account ? "-rotate-90 text-zinc-400" : "rotate-0 text-accent"}`} />
            </button>
          </div>
        </div>

        {!collapsedCards.account && (
          <>
            {/* Card Kênh login */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
              <span>Kênh login</span>
            </span>
            <span className="text-[11px] text-zinc-500">
              Bật/tắt các phương thức đăng nhập và cấu hình mã định danh bảo mật
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {/* Google Login Card */}
            <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all hover:border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10 text-red-400 border border-red-500/20">
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-zinc-200">Google Login</p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${
                          googleLoginEnabled && googleClientId
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : !googleLoginEnabled
                            ? "bg-zinc-800 text-zinc-500 border-zinc-700"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        }`}
                      >
                        {googleLoginEnabled && googleClientId
                          ? "Đã kích hoạt"
                          : !googleLoginEnabled
                          ? "Đang tắt"
                          : "Chưa cấu hình Client ID"}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Google Identity Services (GIS) — Đăng nhập 1 chạm an toàn bằng tài khoản Google của Founder
                    </p>
                  </div>
                </div>

                {/* Nút kích hoạt Google Login: Switch Toggle */}
                <button
                  type="button"
                  onClick={() => setGoogleLoginEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    googleLoginEnabled ? "bg-accent" : "bg-zinc-800"
                  }`}
                  title={googleLoginEnabled ? "Tắt đăng nhập bằng Google" : "Bật đăng nhập bằng Google"}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${
                      googleLoginEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Ô nhập GOOGLE_CLIENT_ID */}
              <div className="mt-3 border-t border-border/40 pt-2.5">
                <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                  <label className="text-[11px] text-zinc-300 font-medium block">
                    🔑 Google Client ID (<code>GOOGLE_CLIENT_ID</code>):
                  </label>
                  <span className="text-[10px] text-zinc-500">
                    * Giá trị này sẽ thay thế giá trị fix cứng trong <code>services/api/.env</code>
                  </span>
                </div>
                <input
                  type="text"
                  placeholder="vd: 10911139267-caqe3ne7mmqs352mv7flop9d9lj56h3s.apps.googleusercontent.com"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-accent font-mono"
                  autoComplete="off"
                />
                <p className="mt-1 text-[10px] text-zinc-500">
                  Lấy Client ID từ Google Cloud Console &gt; APIs &amp; Services &gt; Credentials &gt; OAuth 2.0 Client IDs.
                </p>
              </div>
            </div>

            {/* Zalo Auth Login Card */}
            <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all hover:border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0068FF] text-white">
                      <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.08L2 22l5.12-1.35C8.55 21.49 10.23 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/>
                      </svg>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-zinc-200">Sign in with Zalo Auth</p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${
                          zaloLoginEnabled
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-zinc-800 text-zinc-500 border-zinc-700"
                        }`}
                      >
                        {zaloLoginEnabled ? "Đã kích hoạt" : "Đang tắt"}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Đăng nhập nhanh không cần mật khẩu bằng cách quét mã QR trên ứng dụng Zalo di động của Founder
                    </p>
                  </div>
                </div>

                {/* Nút kích hoạt Zalo Login: Switch Toggle */}
                <button
                  type="button"
                  onClick={() => setZaloLoginEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    zaloLoginEnabled ? "bg-accent" : "bg-zinc-800"
                  }`}
                  title={zaloLoginEnabled ? "Tắt đăng nhập bằng Zalo Auth trên giao diện đăng nhập" : "Bật hiển thị đăng nhập bằng Zalo Auth trên giao diện đăng nhập"}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${
                      zaloLoginEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="mt-2.5 border-t border-border/40 pt-2 flex items-center justify-between text-[11px] text-zinc-400">
                <span>Trạng thái hiển thị trên trang Đăng nhập (/login):</span>
                <span className={`font-semibold ${zaloLoginEnabled ? "text-emerald-400" : "text-zinc-500"}`}>
                  {zaloLoginEnabled ? "Đang hiển thị nút Quét mã QR" : "Đã ẩn nút Zalo"}
                </span>
              </div>
            </div>
          </div>

          {authChannelsMessage && (
            <div
              className={`flex items-center gap-2 rounded-xl border p-3.5 text-xs ${
                authChannelsMessage.type === "success"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
            >
              {authChannelsMessage.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              )}
              <span>{authChannelsMessage.text}</span>
            </div>
          )}
        </div>

        {/* Card Hiển thị các nút bấm trong trang chủ 'AI-OPC Executive Cockpit' */}
        <div className="space-y-4 border-t border-border/40 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5 text-accent" />
                <span>Hiển thị nút bấm Executive Cockpit</span>
              </span>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Cấu hình hiển thị hoặc ẩn các nút bấm trên thanh điều hướng đầu trang chủ "AI-OPC Executive Cockpit".
              </p>
            </div>
            <button
              type="button"
              onClick={handleSaveCockpitNav}
              disabled={savingCockpitNav}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {savingCockpitNav ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span>{savingCockpitNav ? "Đang lưu..." : "Lưu cấu hình nút"}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* 1. Nút Agents */}
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all hover:border-border">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-zinc-200">Nút Agents</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${
                        cockpitNavConfig.showAgents
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-zinc-800 text-zinc-500 border-zinc-700"
                      }`}
                    >
                      {cockpitNavConfig.showAgents ? "Đang hiện" : "Đang ẩn"}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Nút chuyển tới danh sách AI Agents (<code>/agents</code>)
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setCockpitNavConfig((prev) => ({ ...prev, showAgents: !prev.showAgents }))
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  cockpitNavConfig.showAgents ? "bg-accent" : "bg-zinc-800"
                }`}
                title={cockpitNavConfig.showAgents ? "Ẩn nút Agents trên trang chủ" : "Hiện nút Agents trên trang chủ"}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${
                    cockpitNavConfig.showAgents ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* 2. Nút "Hire Agent" (Tuyển Agent) */}
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all hover:border-border">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
                  <UserPlus className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-zinc-200">Nút "Hire Agent" (Tuyển Agent)</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${
                        cockpitNavConfig.showHireAgent
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-zinc-800 text-zinc-500 border-zinc-700"
                      }`}
                    >
                      {cockpitNavConfig.showHireAgent ? "Đang hiện" : "Đang ẩn"}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Nút chuyển tới trang tuyển dụng AI Agent mới (<code>/agents/new</code>) ở cột Org Chart
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setCockpitNavConfig((prev) => ({
                    ...prev,
                    showHireAgent: prev.showHireAgent !== undefined ? !prev.showHireAgent : false,
                  }))
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  cockpitNavConfig.showHireAgent ? "bg-accent" : "bg-zinc-800"
                }`}
                title={cockpitNavConfig.showHireAgent ? "Ẩn nút Hire Agent trên trang chủ" : "Hiện nút Hire Agent trên trang chủ"}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${
                    cockpitNavConfig.showHireAgent ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* 3. Nút Knowledge */}
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all hover:border-border">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <BookOpen className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-zinc-200">Nút Knowledge</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${
                        cockpitNavConfig.showKnowledge
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-zinc-800 text-zinc-500 border-zinc-700"
                      }`}
                    >
                      {cockpitNavConfig.showKnowledge ? "Đang hiện" : "Đang ẩn"}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Nút mở cơ sở tri thức công ty (<code>/knowledge</code>)
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setCockpitNavConfig((prev) => ({ ...prev, showKnowledge: !prev.showKnowledge }))
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  cockpitNavConfig.showKnowledge ? "bg-accent" : "bg-zinc-800"
                }`}
                title={cockpitNavConfig.showKnowledge ? "Ẩn nút Knowledge trên trang chủ" : "Hiện nút Knowledge trên trang chủ"}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${
                    cockpitNavConfig.showKnowledge ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* 3. Nút Settings */}
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all hover:border-border">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Settings className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-semibold text-zinc-200">Nút Settings</p>
                    {(!currentUserEmail || currentUserEmail.toLowerCase() === "phuongtv2c11@gmail.com") ? (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border bg-amber-500/10 text-amber-400 border-amber-500/20">
                        Luôn hiện (Cố định cho phuongtv2c11@gmail.com)
                      </span>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                          cockpitNavConfig.showSettings
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-zinc-800 text-zinc-500 border-zinc-700"
                        }`}
                      >
                        {cockpitNavConfig.showSettings ? "Đang hiện" : "Đang ẩn"}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Nút Cài đặt toàn hệ thống (<code>/settings</code>)
                  </p>
                </div>
              </div>

              {(!currentUserEmail || currentUserEmail.toLowerCase() === "phuongtv2c11@gmail.com") ? (
                <button
                  type="button"
                  disabled
                  className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent bg-amber-500/80 opacity-90 transition-colors duration-200 ease-in-out focus:outline-none"
                  title="Luôn luôn hiển thị cho tài khoản Super Admin phuongtv2c11@gmail.com (không thể tắt)"
                >
                  <span className="pointer-events-none inline-block h-5 w-5 transform translate-x-5 rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setCockpitNavConfig((prev) => ({ ...prev, showSettings: !prev.showSettings }))
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    cockpitNavConfig.showSettings ? "bg-accent" : "bg-zinc-800"
                  }`}
                  title={cockpitNavConfig.showSettings ? "Ẩn nút Settings trên trang chủ" : "Hiện nút Settings trên trang chủ"}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${
                      cockpitNavConfig.showSettings ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              )}
            </div>

            {/* 4. Nút icon khiên xác thực */}
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-canvas/60 p-4 transition-all hover:border-border">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-zinc-200">Nút icon khiên xác thực</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${
                        cockpitNavConfig.showSecurity
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-zinc-800 text-zinc-500 border-zinc-700"
                      }`}
                    >
                      {cockpitNavConfig.showSecurity ? "Đang hiện" : "Đang ẩn"}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Icon khiên bảo mật 2FA và phiên đăng nhập (<code>/security</code>)
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setCockpitNavConfig((prev) => ({ ...prev, showSecurity: !prev.showSecurity }))
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  cockpitNavConfig.showSecurity ? "bg-accent" : "bg-zinc-800"
                }`}
                title={cockpitNavConfig.showSecurity ? "Ẩn nút icon khiên trên trang chủ" : "Hiện nút icon khiên trên trang chủ"}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${
                    cockpitNavConfig.showSecurity ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {cockpitNavMessage && (
            <div
              className={`flex items-center gap-2 rounded-xl border p-3.5 text-xs ${
                cockpitNavMessage.type === "success"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
            >
              {cockpitNavMessage.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              )}
              <span>{cockpitNavMessage.text}</span>
            </div>
          )}
        </div>

        {/* 3. Quản lý tài khoản người dùng & Phân quyền thao tác hệ thống */}
        <div className="space-y-4 border-t border-border/40 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-accent" />
                <span>Quản lý tài khoản người dùng & Phân quyền RBAC</span>
              </span>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Thêm mới tài khoản, phân vai trò vận hành và cấp quyền thao tác các chức năng hệ thống theo ma trận RBAC.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                setLoadingAccounts(true);
                try {
                  const accs = await fetchSystemAccounts();
                  setAccounts(accs);
                } finally {
                  setLoadingAccounts(false);
                }
              }}
              disabled={loadingAccounts}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-canvas/60 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-zinc-100 hover:border-border transition-all cursor-pointer shadow-sm"
              title="Làm mới danh sách tài khoản"
            >
              <RefreshCw className={`h-3 w-3 ${loadingAccounts ? "animate-spin text-accent" : ""}`} />
              <span>{loadingAccounts ? "Đang tải..." : "Làm mới danh sách"}</span>
            </button>
          </div>

          {/* Form thêm mới tài khoản */}
          <form
            onSubmit={handleCreateAccount}
            className="rounded-xl border border-border/60 bg-canvas/60 p-4 space-y-3.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <UserPlus className="h-3.5 w-3.5 text-accent" />
                <span>Thêm mới tài khoản</span>
              </span>
              <span className="text-[11px] text-zinc-500">
                * Mật khẩu tối thiểu 6 ký tự
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Email */}
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1 font-medium">
                  1. Email đăng nhập (<span className="text-rose-400">*</span>):
                </label>
                <input
                  type="email"
                  required
                  placeholder="user@company.com"
                  value={newAccountEmail}
                  onChange={(e) => setNewAccountEmail(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-accent"
                />
              </div>

              {/* Họ tên */}
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1 font-medium">
                  2. Họ và tên / Tên hiển thị:
                </label>
                <input
                  type="text"
                  placeholder="vd: Nguyễn Văn Quản Trị"
                  value={newAccountFullName}
                  onChange={(e) => setNewAccountFullName(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-accent"
                />
              </div>

              {/* Vai trò RBAC */}
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1 font-medium">
                  3. Vai trò phân quyền (Role):
                </label>
                <select
                  value={newAccountRole}
                  onChange={(e) => setNewAccountRole(e.target.value as RbacRoleId)}
                  className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-accent"
                >
                  <option value="founder">Founder / Quản trị tối cao (Super Admin)</option>
                  <option value="manager">Department Manager (Trưởng phòng ban)</option>
                  <option value="operator">Operator / Staff (Vận hành tác vụ)</option>
                  <option value="viewer">Viewer / Auditor (Người xem / Kiểm toán)</option>
                </select>
              </div>

              {/* Mật khẩu khởi tạo */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-zinc-400 font-medium">
                    4. Mật khẩu (<span className="text-rose-400">*</span>):
                  </label>
                  <button
                    type="button"
                    onClick={() => setNewAccountPassword(generateRandomPassword())}
                    className="text-[10px] text-accent hover:underline cursor-pointer"
                    title="Tạo mật khẩu mạnh ngẫu nhiên"
                  >
                    🎲 Sinh ngẫu nhiên
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    required
                    placeholder="Mật khẩu khởi tạo"
                    value={newAccountPassword}
                    onChange={(e) => setNewAccountPassword(e.target.value)}
                    className="w-full rounded-lg border border-border/60 bg-zinc-950/60 px-3 py-1.5 pr-8 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-accent font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                    title={showNewPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  >
                    {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-zinc-500">
                Tài khoản mới sẽ có quyền thao tác các chức năng dựa trên vai trò tương ứng trong Ma trận RBAC.
              </span>
              <button
                type="submit"
                disabled={creatingAccount}
                className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                {creatingAccount ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                <span>{creatingAccount ? "Đang tạo..." : "Tạo tài khoản mới"}</span>
              </button>
            </div>
          </form>

          {/* Thông báo thao tác tài khoản */}
          {accountActionMessage && (
            <div
              className={`flex items-center justify-between rounded-xl border p-3.5 text-xs ${
                accountActionMessage.type === "success"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
            >
              <div className="flex items-center gap-2">
                {accountActionMessage.type === "success" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                )}
                <span>{accountActionMessage.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setAccountActionMessage(null)}
                className="text-zinc-400 hover:text-zinc-200 text-xs p-1 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Bảng danh sách tài khoản */}
          <div className="rounded-xl border border-border/60 bg-canvas/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between bg-zinc-950/40">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-200">Danh sách tài khoản hệ thống</span>
                <span className="rounded-full bg-accent/15 text-accent border border-accent/30 px-2 py-0.2 text-[10px] font-mono font-medium">
                  {accounts.length} tài khoản
                </span>
              </div>
              <span className="text-[10px] text-zinc-500">
                Founder quản trị tối cao được bảo vệ không thể xóa
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/40 text-[10px] uppercase font-semibold text-zinc-400 bg-white/[0.02]">
                    <th className="px-4 py-2.5">Tài khoản & Email</th>
                    <th className="px-3 py-2.5">Họ và tên</th>
                    <th className="px-3 py-2.5">Vai trò hệ thống</th>
                    <th className="px-3 py-2.5">Bảo mật 2FA</th>
                    <th className="px-3 py-2.5">Ngày tạo</th>
                    <th className="px-4 py-2.5 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {accounts.map((acc) => {
                    const isPrimary = acc.isPrimaryFounder || acc.email.toLowerCase() === "phuongtv2c11@gmail.com";
                    return (
                      <tr key={acc.id} className="hover:bg-white/[0.02] transition-colors">
                        {/* Email */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-zinc-200 font-medium">{acc.email}</span>
                            {isPrimary && (
                              <span className="rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 px-1.5 py-0.2 text-[9px] font-medium select-none">
                                Super Admin
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-zinc-500 font-mono">ID: {acc.id}</span>
                        </td>

                        {/* Họ tên */}
                        <td className="px-3 py-3 text-zinc-300">
                          {acc.fullName || "—"}
                        </td>

                        {/* Vai trò RBAC */}
                        <td className="px-3 py-3">
                          {isPrimary ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold border bg-amber-500/15 text-amber-400 border-amber-500/30">
                              Founder
                            </span>
                          ) : (
                            <select
                              value={acc.role}
                              onChange={(e) => handleUpdateAccountRole(acc.id, e.target.value)}
                              className="rounded-lg border border-border/60 bg-zinc-950/80 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-accent cursor-pointer"
                            >
                              <option value="founder">Founder / Super Admin</option>
                              <option value="manager">Department Manager</option>
                              <option value="operator">Operator / Staff</option>
                              <option value="viewer">Viewer / Auditor</option>
                            </select>
                          )}
                        </td>

                        {/* 2FA */}
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium border ${
                              acc.totpEnabled
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-zinc-800 text-zinc-500 border-zinc-700"
                            }`}
                          >
                            {acc.totpEnabled ? "Đã bật 2FA" : "Chưa bật"}
                          </span>
                        </td>

                        {/* Ngày tạo */}
                        <td className="px-3 py-3 text-[11px] text-zinc-500 font-mono">
                          {acc.createdAt ? new Date(acc.createdAt).toLocaleDateString("vi-VN") : "—"}
                        </td>

                        {/* Hành động */}
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Đổi mật khẩu */}
                            <button
                              type="button"
                              onClick={() => {
                                setResettingPasswordAccount(acc);
                                setNewResetPassword("");
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-white/5 px-2 py-1 text-[11px] text-zinc-300 hover:text-zinc-100 hover:bg-white/10 transition-colors cursor-pointer"
                              title="Đặt lại mật khẩu cho tài khoản này"
                            >
                              <Key className="h-3 w-3 text-amber-400" />
                              <span className="hidden sm:inline">Đổi pass</span>
                            </button>

                            {/* Xóa tài khoản */}
                            {!isPrimary && (
                              <button
                                type="button"
                                onClick={() => setDeletingAccount(acc)}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-400 hover:bg-rose-500/20 transition-colors cursor-pointer"
                                title="Xóa tài khoản này khỏi hệ thống"
                              >
                                <Trash2 className="h-3 w-3" />
                                <span className="hidden sm:inline">Xóa</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {accounts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-xs text-zinc-500">
                        Chưa có dữ liệu tài khoản nào.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
          </>
        )}
      </div>

      {/* External Data Source (Database bên ngoài cho Agent thao tác) */}
      {loaded && (
        <div className={`rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl backdrop-blur-sm transition-all ${collapsedCards.externalDb ? "space-y-0" : "space-y-6"}`}>
          {/* Section Header */}
          <div className={`flex flex-wrap items-center justify-between gap-4 ${collapsedCards.externalDb ? "" : "border-b border-border/60 pb-4"}`}>
            <div
              className="space-y-1 cursor-pointer select-none"
              onClick={() => toggleCard("externalDb")}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 shadow-inner">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-zinc-100">
                      Cấu hình Database Nguồn Dữ liệu Bên Ngoài (External Data Source)
                    </h2>
                    {extDbConfig.isConfigured ? (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 font-mono flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Đã cấu hình ({extDbConfig.engine.toUpperCase()})
                      </span>
                    ) : (
                      <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400 font-mono">
                        Chưa cấu hình
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400">
                    Cấu hình kết nối Cơ sở dữ liệu nghiệp vụ (SQL Server / PostgreSQL / MySQL) để AI Agent trực tiếp truy vấn số liệu, phân tích doanh thu và xuất báo cáo.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {!collapsedCards.externalDb && (
                <>
                  <button
                    type="button"
                    onClick={handleTestExtDbConnection}
                    disabled={testingExtDb || savingExtDb}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 hover:text-cyan-200 transition-all cursor-pointer disabled:opacity-50 shadow-sm"
                    title="Kiểm tra kết nối tới Database"
                  >
                    {testingExtDb ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                    ) : (
                      <Radio className="h-3.5 w-3.5 text-cyan-400" />
                    )}
                    <span>{testingExtDb ? "Đang kiểm tra..." : "Kiểm tra kết nối"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveExtDbConfig}
                    disabled={savingExtDb || testingExtDb}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black hover:bg-accent/90 transition-all shadow-md shadow-accent/20 cursor-pointer disabled:opacity-50"
                  >
                    {savingExtDb ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    <span>{savingExtDb ? "Đang lưu..." : "Lưu cấu hình"}</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => toggleCard("externalDb")}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-canvas/60 text-zinc-400 hover:text-zinc-100 hover:border-border transition-all cursor-pointer shadow-sm"
                title={collapsedCards.externalDb ? "Mở rộng card" : "Thu hẹp card"}
              >
                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${collapsedCards.externalDb ? "-rotate-90 text-zinc-400" : "rotate-0 text-accent"}`} />
              </button>
            </div>
          </div>

          {!collapsedCards.externalDb && (
            <form onSubmit={handleSaveExtDbConfig} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Engine */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <Server className="h-3.5 w-3.5 text-zinc-400" />
                  Hệ quản trị CSDL (Engine)
                </label>
                <select
                  value={extDbConfig.engine}
                  onChange={(e) => handleExtDbEngineChange(e.target.value as ExternalDbEngine)}
                  className="w-full rounded-xl border border-border/80 bg-canvas/90 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-accent transition-all cursor-pointer"
                >
                  <option value="sqlserver">Microsoft SQL Server (mssql)</option>
                  <option value="postgresql">PostgreSQL (pg)</option>
                  <option value="mysql">MySQL (mysql2)</option>
                </select>
              </div>

              {/* Database Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-zinc-400" />
                  Tên Cơ sở dữ liệu (Database)
                </label>
                <input
                  type="text"
                  placeholder="vd: Intelio_Sunset hoặc hotel_dbs"
                  value={extDbConfig.database}
                  onChange={(e) => setExtDbConfig({ ...extDbConfig, database: e.target.value })}
                  className="w-full rounded-xl border border-border/80 bg-canvas/90 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-accent transition-all font-mono"
                  required
                />
              </div>

              {/* Host / Server IP */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-zinc-400" />
                  Địa chỉ Máy chủ (Host / Server IP)
                </label>
                <input
                  type="text"
                  placeholder="vd: 127.0.0.1 hoặc db.example.com"
                  value={extDbConfig.host}
                  onChange={(e) => setExtDbConfig({ ...extDbConfig, host: e.target.value })}
                  className="w-full rounded-xl border border-border/80 bg-canvas/90 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-accent transition-all font-mono"
                  required
                />
              </div>

              {/* Port */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-400" />
                  Cổng kết nối (Port)
                </label>
                <input
                  type="number"
                  placeholder="1433"
                  value={extDbConfig.port}
                  onChange={(e) => setExtDbConfig({ ...extDbConfig, port: Number(e.target.value) })}
                  className="w-full rounded-xl border border-border/80 bg-canvas/90 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-accent transition-all font-mono"
                  required
                />
              </div>

              {/* User */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <Key className="h-3.5 w-3.5 text-zinc-400" />
                  Tên tài khoản (User)
                </label>
                <input
                  type="text"
                  placeholder="vd: sa hoặc postgres"
                  value={extDbConfig.user}
                  onChange={(e) => setExtDbConfig({ ...extDbConfig, user: e.target.value })}
                  className="w-full rounded-xl border border-border/80 bg-canvas/90 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-accent transition-all font-mono"
                  required
                />
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5 text-zinc-400" />
                    Mật khẩu (Password)
                  </span>
                  {extDbConfig.passwordMasked && !extDbPasswordInput && (
                    <span className="text-[10px] text-emerald-400 font-mono">Đã lưu mật khẩu</span>
                  )}
                </label>
                <div className="relative">
                  <input
                    type={showExtDbPassword ? "text" : "password"}
                    placeholder={extDbConfig.passwordMasked ? "•••••••• (Nhập để thay đổi)" : "Nhập mật khẩu..."}
                    value={extDbPasswordInput}
                    onChange={(e) => setExtDbPasswordInput(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3 pr-9 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-accent transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowExtDbPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                    title={showExtDbPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  >
                    {showExtDbPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Advanced SSL / Certificate Switches */}
            <div className="rounded-xl border border-border/60 bg-canvas/50 p-4 space-y-3">
              <div className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
                Tùy chọn Bảo mật & Chứng chỉ SSL/TLS
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={extDbConfig.encrypt}
                    onChange={(e) => setExtDbConfig({ ...extDbConfig, encrypt: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-border bg-canvas text-accent focus:ring-accent cursor-pointer"
                  />
                  <div className="space-y-0.5">
                    <span className="font-medium text-zinc-200">Mã hóa kết nối (Encrypt / SSL)</span>
                    <p className="text-[11px] text-zinc-500">
                      Bật nếu máy chủ CSDL yêu cầu mã hóa SSL/TLS. Tắt nếu kết nối nội bộ SQL Server không cài đặt chứng chỉ SSL.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={extDbConfig.trustServerCertificate}
                    onChange={(e) => setExtDbConfig({ ...extDbConfig, trustServerCertificate: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-border bg-canvas text-accent focus:ring-accent cursor-pointer"
                  />
                  <div className="space-y-0.5">
                    <span className="font-medium text-zinc-200">Tin cậy chứng chỉ máy chủ (Trust Server Certificate)</span>
                    <p className="text-[11px] text-zinc-500">
                      Bật khi kết nối máy chủ local/nội bộ sử dụng chứng chỉ tự ký (Self-signed Certificate) để tránh lỗi bắt tay SSL.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Status / Message Banner */}
            {extDbMessage && (
              <div
                className={`flex items-center gap-2.5 rounded-xl border p-3 text-xs animate-in fade-in duration-150 ${
                  extDbMessage.type === "success"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                }`}
              >
                {extDbMessage.type === "success" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                )}
                <span>{extDbMessage.text}</span>
              </div>
            )}

            {/* Test Connection Details Card if tested */}
            {extDbTestResult && extDbTestResult.success && extDbTestResult.version && (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3.5 text-xs text-cyan-200 space-y-1.5 font-mono">
                <div className="flex items-center gap-2 text-cyan-300 font-semibold font-sans">
                  <CheckCheck className="h-4 w-4 text-cyan-400" />
                  <span>Chi tiết máy chủ CSDL kết nối thành công:</span>
                </div>
                <div className="text-[11px] text-zinc-300 pl-6 leading-relaxed">
                  <p>• Phiên bản: <span className="text-white">{extDbTestResult.version}</span></p>
                  {extDbTestResult.tableCount !== undefined && (
                    <p>• Số lượng bảng dữ liệu: <span className="text-accent font-bold">{extDbTestResult.tableCount} bảng</span></p>
                  )}
                  {extDbTestResult.latencyMs !== undefined && (
                    <p>• Độ trễ phản hồi mạng: <span className="text-emerald-400 font-bold">{extDbTestResult.latencyMs} ms</span></p>
                  )}
                </div>
              </div>
            )}
          </form>
          )}
        </div>
      )}

      {/* Dynamic System Dictionary (Từ điển quy ước động) — Bug 3 & Bug 4 */}
      {loaded && (
        <div className={`rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl backdrop-blur-sm transition-all ${collapsedCards.systemLookups ? "space-y-0" : "space-y-6"}`}>
          {/* Section Header */}
          <div className={`flex flex-wrap items-center justify-between gap-4 ${collapsedCards.systemLookups ? "" : "border-b border-border/60 pb-4"}`}>
            <div
              className="space-y-1 cursor-pointer select-none"
              onClick={() => toggleCard("systemLookups")}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/30 shadow-inner">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-zinc-100">
                      Cấu hình Quy ước Số liệu (Dynamic System Dictionary)
                    </h2>
                    {collapsedCards.systemLookups ? (
                      <span className="rounded-full border border-border/70 bg-canvas/70 px-2.5 py-0.5 text-[11px] font-mono text-zinc-300">
                        {lookups.length} mục quy ước
                      </span>
                    ) : (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 font-mono">
                        In-Memory RAM Cache (0.00001s)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400">
                    Bảng từ điển chuyển đổi các mã số thô từ Database (Status 0, 1, 2, 3, 4, 5...) sang ngôn ngữ rõ nghĩa cho AI Agent hiểu ngay lập tức mà không cần sửa code hay huấn luyện lại AI.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {!collapsedCards.systemLookups && (
                <>
                  <button
                    type="button"
                    onClick={handleResetLookups}
                    disabled={resettingLookups}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-white/5 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-white/10 hover:text-zinc-100 transition-all cursor-pointer disabled:opacity-50"
                    title="Khôi phục bảng quy ước về mặc định chuẩn"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${resettingLookups ? "animate-spin" : ""}`} />
                    <span>Khôi phục mặc định</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setLookupModal({
                        isOpen: true,
                        mode: "create",
                        data: {
                          category: lookupCategory,
                          rawCode: "",
                          standardKey: "",
                          displayName: "",
                          description: "",
                          isActive: true,
                        },
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black hover:bg-accent/90 transition-all shadow-md shadow-accent/20 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Thêm quy ước mới</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => toggleCard("systemLookups")}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-canvas/60 text-zinc-400 hover:text-zinc-100 hover:border-border transition-all cursor-pointer shadow-sm"
                title={collapsedCards.systemLookups ? "Mở rộng card" : "Thu hẹp card"}
              >
                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${collapsedCards.systemLookups ? "-rotate-90 text-zinc-400" : "rotate-0 text-accent"}`} />
              </button>
            </div>
          </div>

          {!collapsedCards.systemLookups && (
            <>

          {/* Category Tabs & Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {[
                { id: "booking_status", label: "Trạng thái phòng (booking_status)", icon: "🏨" },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setLookupCategory(cat.id);
                    refreshLookups(cat.id);
                  }}
                  className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                    lookupCategory === cat.id
                      ? "bg-accent/15 border border-accent/40 text-accent shadow-sm"
                      : "bg-canvas/60 border border-border/60 text-zinc-400 hover:text-zinc-200 hover:border-border"
                  }`}
                >
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                  <span className="rounded-full bg-black/40 px-2 py-0.2 text-[10px] font-mono text-zinc-300">
                    {lookups.filter((x) => x.category === cat.id).length}
                  </span>
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Tìm mã số, khóa chuẩn, tên..."
                value={lookupSearch}
                onChange={(e) => setLookupSearch(e.target.value)}
                className="w-full rounded-xl border border-border/70 bg-canvas/80 py-1.5 pl-9 pr-3 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-accent transition-all"
              />
            </div>
          </div>

          {/* Feedback Message */}
          {lookupMessage && (
            <div
              className={`flex items-center gap-2 rounded-xl border p-3 text-xs animate-in fade-in duration-150 ${
                lookupMessage.type === "success"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
            >
              {lookupMessage.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              )}
              <span>{lookupMessage.text}</span>
            </div>
          )}

          {/* Lookups Table */}
          <div className="overflow-hidden rounded-xl border border-border/70 bg-canvas/40 shadow-inner">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border/70 bg-white/[0.03] text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4 w-16 text-center">Mã (Code)</th>
                    <th className="py-3 px-4 w-28">Khóa chuẩn</th>
                    <th className="py-3 px-4 w-48">Tên hiển thị (Display Name)</th>
                    <th className="py-3 px-4">Ý nghĩa cho AI hiểu (Prompt Context)</th>
                    <th className="py-3 px-4 w-24 text-center">Trạng thái</th>
                    <th className="py-3 px-4 w-24 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {lookups
                    .filter((item) => {
                      if (!lookupSearch.trim()) return true;
                      const q = lookupSearch.toLowerCase();
                      return (
                        String(item.rawCode).includes(q) ||
                        item.standardKey.toLowerCase().includes(q) ||
                        item.displayName.toLowerCase().includes(q) ||
                        (item.description && item.description.toLowerCase().includes(q))
                      );
                    })
                    .map((item) => (
                      <tr
                        key={item.id}
                        className={`transition-colors hover:bg-white/[0.02] ${
                          !item.isActive ? "opacity-50" : ""
                        }`}
                      >
                        <td className="py-3 px-4 text-center">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 border border-accent/30 font-mono font-bold text-accent">
                            {item.rawCode}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="rounded-md border border-border/60 bg-black/40 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                            {item.standardKey}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                item.rawCode === 1
                                  ? "bg-sky-400 ring-2 ring-sky-500/20"
                                  : item.rawCode === 2
                                  ? "bg-emerald-400 ring-2 ring-emerald-500/20"
                                  : item.rawCode === 3
                                  ? "bg-amber-400 ring-2 ring-amber-500/20"
                                  : item.rawCode === 5
                                  ? "bg-indigo-400 ring-2 ring-indigo-500/20"
                                  : item.rawCode === 6
                                  ? "bg-rose-400 ring-2 ring-rose-500/20"
                                  : item.rawCode === 7
                                  ? "bg-orange-400 ring-2 ring-orange-500/20"
                                  : "bg-zinc-400"
                              }`}
                            />
                            <span className="font-semibold text-zinc-100">{item.displayName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-zinc-400">
                          {item.description || <span className="text-zinc-600 italic">Chưa có mô tả</span>}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleLookupActive(item)}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              item.isActive ? "bg-accent" : "bg-zinc-800"
                            }`}
                            title={item.isActive ? "Đang kích hoạt — Bấm để tắt" : "Đã tắt — Bấm để bật"}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${
                                item.isActive ? "translate-x-4" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setLookupModal({
                                  isOpen: true,
                                  mode: "edit",
                                  data: {
                                    id: item.id,
                                    category: item.category,
                                    rawCode: item.rawCode,
                                    standardKey: item.standardKey,
                                    displayName: item.displayName,
                                    description: item.description || "",
                                    isActive: item.isActive,
                                  },
                                })
                              }
                              className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 transition-colors cursor-pointer"
                              title="Sửa quy ước"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteLookup(item)}
                              className="rounded-lg p-1.5 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400 transition-colors cursor-pointer"
                              title="Xóa quy ước"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  {lookups.length === 0 && !loadingLookups && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-zinc-500">
                        Chưa có quy ước nào. Bấm &ldquo;Thêm quy ước mới&rdquo; hoặc &ldquo;Khôi phục mặc định&rdquo; để khởi tạo.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live AI Prompt & Tool Preview Card */}
          <div className="space-y-3 rounded-xl border border-border/80 bg-zinc-950 p-4 shadow-inner">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                <span className="text-xs font-semibold text-zinc-200">
                  Xem trước Trực quan AI Agent (Live AI Prompt &amp; Data Enrichment Simulator)
                </span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">
                Cập nhật tức thời khi thay đổi bất kỳ quy ước nào
              </span>
            </div>

            {/* 1. Tool Description injected into LLM */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-zinc-400">
                  1. Câu mô tả tham số Tool tự động sinh cho AI Prompt (Chiều AI &rarr; Gọi Tool):
                </span>
                <span className="rounded bg-accent/10 px-2 py-0.5 text-[9px] font-mono text-accent">
                  RAM Cache
                </span>
              </div>
              <div className="rounded-lg border border-border/60 bg-black/60 p-3 font-mono text-[11px] text-accent leading-relaxed">
                {toolDescription || "(Đang tải mô tả schema...)"}
              </div>
            </div>

            {/* 2. Auto-enrichment Data preview */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[11px] font-medium text-zinc-400 block">
                2. Dữ liệu thô từ Database được tự động dịch sang Text rõ nghĩa trong 0.00001s (Chiều DB &rarr; AI):
              </span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 font-mono text-[10px]">
                <div className="rounded-lg border border-border/60 bg-black/40 p-2.5">
                  <div className="text-zinc-500 mb-1 flex items-center justify-between">
                    <span>DỮ LIỆU THÔ DATABASE (SQL SERVER / SQLITE):</span>
                    <span className="text-amber-400">Raw Input</span>
                  </div>
                  <pre className="text-zinc-400 whitespace-pre-wrap">
{JSON.stringify(
  [
    { ResCode: "51106", RoomNo: 903, FromDate: 20260911, ToDate: 20260912, Status: 5, TotalRate: 1500000 },
    { ResCode: "51107", RoomNo: 402, FromDate: 20260915, ToDate: 20260918, Status: 1, TotalRate: 3600000 },
  ],
  null,
  2
)}
                  </pre>
                </div>

                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
                  <div className="text-emerald-400 mb-1 flex items-center justify-between">
                    <span>DỮ LIỆU TỰ ĐỘNG ENRICH NẠP CHO AI AGENT:</span>
                    <span className="text-emerald-400 font-bold">Enriched (0.00001s)</span>
                  </div>
                  <pre className="text-emerald-200/90 whitespace-pre-wrap">
{JSON.stringify(
  [
    {
      ResCode: "51106",
      RoomNo: 903,
      FromDate: 20260911,
      ToDate: 20260912,
      Status: 5,
      StatusText: lookups.find((x) => x.rawCode === 5 && x.isActive)?.displayName || "Check-out / Đã trả phòng (Completed)",
      TotalRate: 1500000,
    },
    {
      ResCode: "51107",
      RoomNo: 402,
      FromDate: 20260915,
      ToDate: 20260918,
      Status: 1,
      StatusText: lookups.find((x) => x.rawCode === 1 && x.isActive)?.displayName || "Check-in / Đang ở (In-House)",
      TotalRate: 3600000,
    },
  ],
  null,
  2
)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
            </>
          )}
        </div>
      )}

      {/* Add / Edit System Lookup Modal */}
      {lookupModal?.isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setLookupModal(null)}
        >
          <div
            className="relative w-full max-w-lg rounded-2xl border border-border/80 bg-panel/95 p-6 shadow-2xl backdrop-blur-md transition-all animate-in zoom-in-95 duration-200 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-accent" />
                <h3 className="text-base font-semibold text-zinc-100">
                  {lookupModal.mode === "create" ? "Thêm quy ước mới" : "Chỉnh sửa quy ước số liệu"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setLookupModal(null)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-100 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveLookupModal} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-300">
                    Mã số thô trong DB (Raw Code) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    placeholder="vd: 5"
                    value={lookupModal.data.rawCode}
                    onChange={(e) =>
                      setLookupModal({
                        ...lookupModal,
                        data: { ...lookupModal.data, rawCode: e.target.value === "" ? "" : Number(e.target.value) },
                      })
                    }
                    className="w-full rounded-xl border border-border/80 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 font-mono outline-none focus:border-accent"
                  />
                  <p className="text-[10px] text-zinc-500">Giá trị số lưu trong cột Status / TrangThai</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-300">
                    Khóa chuẩn (Standard Key) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="vd: NOSHOW, CANCELLED"
                    value={lookupModal.data.standardKey}
                    onChange={(e) =>
                      setLookupModal({
                        ...lookupModal,
                        data: { ...lookupModal.data, standardKey: e.target.value.toUpperCase() },
                      })
                    }
                    className="w-full rounded-xl border border-border/80 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 font-mono uppercase outline-none focus:border-accent"
                  />
                  <p className="text-[10px] text-zinc-500">Mã định danh tiếng Anh viết hoa</p>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-300">
                  Tên hiển thị (Display Name) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="vd: No-Show (Khách không đến nhận phòng)"
                  value={lookupModal.data.displayName}
                  onChange={(e) =>
                    setLookupModal({
                      ...lookupModal,
                      data: { ...lookupModal.data, displayName: e.target.value },
                    })
                  }
                  className="w-full rounded-xl border border-border/80 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-300">
                  Ý nghĩa &amp; Ngữ cảnh cho AI hiểu (Description for AI)
                </label>
                <textarea
                  rows={2}
                  placeholder="vd: Khách đã đặt phòng nhưng quá hạn không đến và không thông báo trước. Đơn này tính doanh thu 0đ hoặc phạt cọc."
                  value={lookupModal.data.description}
                  onChange={(e) =>
                    setLookupModal({
                      ...lookupModal,
                      data: { ...lookupModal.data, description: e.target.value },
                    })
                  }
                  className="w-full rounded-xl border border-border/80 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-accent resize-none"
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/60 bg-white/[0.02] p-3">
                <div>
                  <p className="text-xs font-semibold text-zinc-200">Kích hoạt quy ước này</p>
                  <p className="text-[11px] text-zinc-400">Tự động nạp vào RAM cache và truyền cho AI Agent</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setLookupModal({
                      ...lookupModal,
                      data: { ...lookupModal.data, isActive: !lookupModal.data.isActive },
                    })
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    lookupModal.data.isActive ? "bg-accent" : "bg-zinc-800"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${
                      lookupModal.data.isActive ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setLookupModal(null)}
                  className="rounded-xl border border-border/70 bg-white/5 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/10 hover:text-zinc-100 transition-colors cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingLookupItem}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-black hover:bg-accent/90 transition-all shadow-md shadow-accent/20 cursor-pointer disabled:opacity-50"
                >
                  {savingLookupItem ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  <span>{savingLookupItem ? "Đang lưu..." : "Lưu quy ước"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Agent Input & Model Gateway Configuration */}
      {loaded && (
        <div className={`rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl backdrop-blur-sm transition-all ${collapsedCards.aiGateway ? "space-y-0" : "space-y-6"}`}>
          <div className={`flex flex-wrap items-center justify-between gap-4 ${collapsedCards.aiGateway ? "" : "border-b border-border/60 pb-4"}`}>
            <div
              className="space-y-0.5 cursor-pointer select-none"
              onClick={() => toggleCard("aiGateway")}
            >
              <div className="flex items-center gap-2">
                <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                  <Cpu className="h-5 w-5 text-accent" /> {t.settings.aiGateway.title}
                </h2>
                <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent font-mono">
                  {llmProvider.toUpperCase()} • {llmStatusDesc || (locale === "vi" ? "Đang phát hiện" : "Detecting")}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                {t.settings.aiGateway.desc}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!collapsedCards.aiGateway && (
                <button
                  type="button"
                  onClick={handleResetLlm}
                  disabled={resettingLlm || savingLlm}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 transition-all hover:border-rose-500/50 hover:bg-rose-500/20 hover:text-rose-200 disabled:opacity-50 cursor-pointer shadow-sm"
                  title={locale === "vi" ? "Xóa hết các giá trị đã thiết lập trong AI Gateway về mặc định" : "Reset all AI Gateway settings to default"}
                >
                  {resettingLlm ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5 text-rose-400" />
                  )}
                  <span>{resettingLlm ? (locale === "vi" ? "Đang đặt lại..." : "Resetting...") : "Reset"}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => toggleCard("aiGateway")}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-canvas/60 text-zinc-400 hover:text-zinc-100 hover:border-border transition-all cursor-pointer shadow-sm"
                title={collapsedCards.aiGateway ? "Mở rộng card" : "Thu hẹp card"}
              >
                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${collapsedCards.aiGateway ? "-rotate-90 text-zinc-400" : "rotate-0 text-accent"}`} />
              </button>
            </div>
          </div>

          {!collapsedCards.aiGateway && (
            <>
              {/* 1. Provider Cards */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
              {t.settings.aiGateway.providerSection}
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { id: "auto", name: t.settings.aiGateway.providers.auto.name, desc: t.settings.aiGateway.providers.auto.desc, badge: t.settings.aiGateway.providers.auto.badge },
                { id: "gemini", name: t.settings.aiGateway.providers.gemini.name, desc: t.settings.aiGateway.providers.gemini.desc, badge: t.settings.aiGateway.providers.gemini.badge },
                { id: "openai", name: t.settings.aiGateway.providers.openai.name, desc: t.settings.aiGateway.providers.openai.desc, badge: t.settings.aiGateway.providers.openai.badge },
                { id: "anthropic", name: t.settings.aiGateway.providers.anthropic.name, desc: t.settings.aiGateway.providers.anthropic.desc, badge: t.settings.aiGateway.providers.anthropic.badge },
                { id: "custom", name: t.settings.aiGateway.providers.custom.name, desc: t.settings.aiGateway.providers.custom.desc, badge: t.settings.aiGateway.providers.custom.badge },
              ].map((p) => {
                const selected = llmProvider === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setLlmProvider(p.id as any)}
                    className={`cursor-pointer rounded-xl border p-3.5 transition-all relative ${selected
                      ? "border-accent bg-accent/10 shadow-md ring-1 ring-accent/50"
                      : "border-border/60 bg-canvas/60 hover:border-border hover:bg-canvas/90"
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold ${selected ? "text-accent" : "text-zinc-200"}`}>
                        {p.name}
                      </span>
                      {selected && <Check className="h-3.5 w-3.5 text-accent" />}
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-400 line-clamp-1">{p.desc}</p>
                    <span className="mt-2 inline-block rounded bg-white/5 px-1.5 py-0.2 text-[9px] text-zinc-500 font-mono">
                      {p.badge}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. Model and Hyperparameters */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  2. Model mặc định (Default Model)
                </label>
                <span className="text-[11px] text-zinc-500">Để trống = Tự dùng model chuẩn</span>
              </div>
              <input
                type="text"
                placeholder={
                  llmProvider === "gemini"
                    ? "vd: gemini-3.7-flash"
                    : llmProvider === "openai"
                      ? "vd: gpt-4o"
                      : llmProvider === "anthropic"
                        ? "vd: claude-3-5-sonnet-20241022"
                        : llmProvider === "custom"
                          ? "vd: llama3.3 hoặc deepseek-r1"
                          : "vd: gemini-3.7-flash (hoặc để trống)"
                }
                value={orchestratorModel}
                onChange={(e) => setOrchestratorModel(e.target.value)}
                className="w-full rounded-xl border border-border/80 bg-canvas/90 px-3.5 py-2.5 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
              />
              {/* Quick model suggestion pills */}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {(llmProvider === "gemini" || llmProvider === "auto"
                  ? ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.1-pro-preview"]
                  : llmProvider === "openai"
                    ? ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"]
                    : llmProvider === "anthropic"
                      ? ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"]
                      : ["llama3.3", "deepseek-r1", "qwen2.5:14b", "mistral-nemo"]
                ).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setOrchestratorModel(m)}
                    className="rounded-lg border border-border/60 bg-white/5 px-2 py-0.5 text-[10px] font-mono text-zinc-400 hover:border-accent/40 hover:text-accent transition-colors"
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Nhiệt độ sáng tạo (Temperature: {temperature})
                </label>
                <span className="text-[11px] text-zinc-500">0.0 (Logic) - 1.0 (Sáng tạo)</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-accent"
              />
              <p className="text-[11px] text-zinc-500">
                Khuyến nghị: <strong>0.2</strong> cho AI-COO và phân rã task chính xác theo cấu trúc JSON.
              </p>
            </div>
          </div>

          {/* 3. Custom Endpoint URL (for Local / Self-hosted / Custom) */}
          {(llmProvider === "custom" || llmProvider === "auto") && (
            <div className="space-y-2 border-t border-border/60 pt-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-accent" /> URL Endpoint Tùy Chỉnh / Local AI (OpenAI Compatible)
                </label>
                <span className="text-[11px] text-zinc-500">Hỗ trợ Ollama, LM Studio, vLLM, Groq, DeepSeek</span>
              </div>
              <input
                type="text"
                placeholder="vd: http://localhost:11434/v1 (Ollama) hoặc https://api.groq.com/openai/v1"
                value={customLlmUrl}
                onChange={(e) => setCustomLlmUrl(e.target.value)}
                className="w-full rounded-xl border border-border/80 bg-canvas/90 px-3.5 py-2.5 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCustomLlmUrl("http://localhost:11434/v1")}
                  className="rounded-lg border border-border/60 bg-white/5 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                >
                  Gợi ý: Ollama (localhost:11434/v1)
                </button>
                <button
                  type="button"
                  onClick={() => setCustomLlmUrl("http://localhost:1234/v1")}
                  className="rounded-lg border border-border/60 bg-white/5 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                >
                  Gợi ý: LM Studio (localhost:1234/v1)
                </button>
                <button
                  type="button"
                  onClick={() => setCustomLlmUrl("https://api.groq.com/openai/v1")}
                  className="rounded-lg border border-border/60 bg-white/5 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                >
                  Gợi ý: Groq Cloud
                </button>
              </div>
            </div>
          )}

          {/* 3. API Keys Configuration */}
          <div className="space-y-3 border-t border-border/60 pt-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
                3. Nhập Khóa API (API Keys)
              </label>
              <span className="text-[11px] text-zinc-400">
                {llmProvider === "auto"
                  ? "Cấu hình khóa cho chế độ Tự động (Multi-provider)"
                  : `Chỉ yêu cầu khóa cho: ${llmProvider === "gemini"
                    ? "Google Gemini"
                    : llmProvider === "openai"
                      ? "OpenAI GPT"
                      : llmProvider === "anthropic"
                        ? "Anthropic Claude"
                        : "Custom / Local AI"
                  }`}
              </span>
            </div>

            {/* Gemini Key Only */}
            {llmProvider === "gemini" && (
              <div className="space-y-1.5 max-w-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5 text-accent" /> Google Gemini API Key
                  </span>
                  {llmMasked.gemini && (
                    <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.gemini}</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showLlmKeys.gemini ? "text" : "password"}
                    placeholder={llmMasked.gemini ? "Nhập để thay đổi key mới..." : "AIzaSy..."}
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLlmKeys({ ...showLlmKeys, gemini: !showLlmKeys.gemini })}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showLlmKeys.gemini ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {/* OpenAI Key Only */}
            {llmProvider === "openai" && (
              <div className="space-y-1.5 max-w-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5 text-sky-400" /> OpenAI API Key
                  </span>
                  {llmMasked.openai && (
                    <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.openai}</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showLlmKeys.openai ? "text" : "password"}
                    placeholder={llmMasked.openai ? "Nhập để thay đổi key mới..." : "sk-..."}
                    value={openaiApiKey}
                    onChange={(e) => setOpenaiApiKey(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLlmKeys({ ...showLlmKeys, openai: !showLlmKeys.openai })}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showLlmKeys.openai ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {/* Anthropic Key Only */}
            {llmProvider === "anthropic" && (
              <div className="space-y-1.5 max-w-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5 text-amber-400" /> Anthropic Claude Key
                  </span>
                  {llmMasked.anthropic && (
                    <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.anthropic}</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showLlmKeys.anthropic ? "text" : "password"}
                    placeholder={llmMasked.anthropic ? "Nhập để thay đổi key mới..." : "sk-ant-..."}
                    value={anthropicApiKey}
                    onChange={(e) => setAnthropicApiKey(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLlmKeys({ ...showLlmKeys, anthropic: !showLlmKeys.anthropic })}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showLlmKeys.anthropic ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {/* Custom LLM Key Only */}
            {llmProvider === "custom" && (
              <div className="space-y-1.5 max-w-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5 text-purple-400" /> Custom / Bearer Token
                  </span>
                  {llmMasked.custom && (
                    <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.custom}</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showLlmKeys.custom ? "text" : "password"}
                    placeholder={llmMasked.custom ? "Nhập để thay đổi token..." : "Tùy chọn (để trống nếu Ollama/LM Studio không yêu cầu token)..."}
                    value={customLlmApiKey}
                    onChange={(e) => setCustomLlmApiKey(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLlmKeys({ ...showLlmKeys, custom: !showLlmKeys.custom })}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showLlmKeys.custom ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {/* Auto Mode: Show all 4 in a responsive grid */}
            {llmProvider === "auto" && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Gemini Key */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-accent" /> Google Gemini API Key
                    </span>
                    {llmMasked.gemini && (
                      <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.gemini}</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showLlmKeys.gemini ? "text" : "password"}
                      placeholder={llmMasked.gemini ? "Nhập để thay đổi key mới..." : "AIzaSy..."}
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLlmKeys({ ...showLlmKeys, gemini: !showLlmKeys.gemini })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      {showLlmKeys.gemini ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* OpenAI Key */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-sky-400" /> OpenAI API Key
                    </span>
                    {llmMasked.openai && (
                      <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.openai}</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showLlmKeys.openai ? "text" : "password"}
                      placeholder={llmMasked.openai ? "Nhập để thay đổi key mới..." : "sk-..."}
                      value={openaiApiKey}
                      onChange={(e) => setOpenaiApiKey(e.target.value)}
                      className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLlmKeys({ ...showLlmKeys, openai: !showLlmKeys.openai })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      {showLlmKeys.openai ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Anthropic Key */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-amber-400" /> Anthropic Claude Key
                    </span>
                    {llmMasked.anthropic && (
                      <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.anthropic}</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showLlmKeys.anthropic ? "text" : "password"}
                      placeholder={llmMasked.anthropic ? "Nhập để thay đổi key mới..." : "sk-ant-..."}
                      value={anthropicApiKey}
                      onChange={(e) => setAnthropicApiKey(e.target.value)}
                      className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLlmKeys({ ...showLlmKeys, anthropic: !showLlmKeys.anthropic })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      {showLlmKeys.anthropic ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Custom LLM Key */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-purple-400" /> Custom / Bearer Token
                    </span>
                    {llmMasked.custom && (
                      <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {llmMasked.custom}</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showLlmKeys.custom ? "text" : "password"}
                      placeholder={llmMasked.custom ? "Nhập để thay đổi token..." : "Tùy chọn cho Groq/Local..."}
                      value={customLlmApiKey}
                      onChange={(e) => setCustomLlmApiKey(e.target.value)}
                      className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLlmKeys({ ...showLlmKeys, custom: !showLlmKeys.custom })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      {showLlmKeys.custom ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 4. Embedding / Vector Search Key (Knowledge Base) */}
            <div className="space-y-3 border-t border-border/60 pt-5 mt-4 rounded-xl bg-white/[0.015] p-4 border border-border/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5 uppercase tracking-wider">
                      <Database className="h-4 w-4 text-accent" /> {t.settings.aiGateway.embeddingKeyTitle}
                    </label>
                    {llmMasked.embedding ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 font-mono">
                        <CheckCircle2 className="h-3 w-3" /> {t.settings.aiGateway.embeddingActive} ({llmMasked.embedding})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                        <AlertTriangle className="h-3 w-3" /> {t.settings.aiGateway.embeddingFallback}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed max-w-2xl">
                    {t.settings.aiGateway.embeddingKeyDesc}
                  </p>
                </div>
              </div>
              <div className="relative max-w-xl">
                <input
                  type={showLlmKeys.embedding ? "text" : "password"}
                  placeholder={llmMasked.embedding ? "Nhập để thay đổi key mới..." : "AIzaSy... (Gemini API Key) hoặc sk-... (OpenAI Key)"}
                  value={embeddingApiKey}
                  onChange={(e) => setEmbeddingApiKey(e.target.value)}
                  className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2.5 pl-3.5 pr-9 text-xs text-zinc-100 font-mono placeholder-zinc-600 outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowLlmKeys({ ...showLlmKeys, embedding: !showLlmKeys.embedding })}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  title={showLlmKeys.embedding ? "Ẩn key" : "Hiện key"}
                >
                  {showLlmKeys.embedding ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* 4. Bottom Action Footer */}
          <div className="space-y-4 border-t border-border/60 pt-4 mt-2 bg-white/[0.02] -mx-6 -mb-6 p-6 rounded-b-2xl">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Sparkles className="h-4 w-4 text-accent shrink-0" />
                <span>
                  {t.settings.aiGateway.footerNotice}
                </span>
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={handleTestLlm}
                  disabled={testingLlm}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 transition-all cursor-pointer shadow-sm"
                >
                  {testingLlm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  <span>{testingLlm ? t.settings.aiGateway.testingConnection : t.settings.aiGateway.testConnection}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveLlm}
                  disabled={savingLlm}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-black hover:bg-accent/90 disabled:opacity-50 transition-all shadow-lg shadow-accent/25 hover:shadow-accent/40 cursor-pointer font-medium"
                >
                  {savingLlm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  <span>{savingLlm ? t.settings.aiGateway.savingConfig : t.settings.aiGateway.saveConfig}</span>
                </button>
              </div>
            </div>

            {/* Feedback message (Đã lưu / Thông báo lỗi) */}
            {llmMessage && (
              <div
                className={`flex items-center gap-2.5 rounded-xl border p-3.5 text-xs ${llmMessage.type === "success"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  }`}
              >
                {llmMessage.type === "success" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                )}
                <span>{llmMessage.text}</span>
              </div>
            )}

            {/* Live Test Result (Kết nối thành công / Phản hồi test từ model) */}
            {testResult && (
              <div
                className={`rounded-xl border p-4 text-xs space-y-2.5 ${testResult.success
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-rose-500/40 bg-rose-500/10 text-rose-200"
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1.5">
                    {testResult.success ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        {t.settings.aiGateway.testSuccess.replace("{provider}", testResult.provider?.toUpperCase() || "").replace("{model}", testResult.modelUsed || "")}
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4 text-rose-400" />
                        {t.settings.aiGateway.testFailed}
                      </>
                    )}
                  </span>
                  <span className="font-mono text-[11px] bg-black/40 px-2.5 py-0.5 rounded-md border border-white/10">
                    {t.common.latency}: {testResult.latencyMs} ms
                  </span>
                </div>
                {testResult.reply && (
                  <div className="rounded-lg bg-black/50 p-3 font-mono text-[11px] text-zinc-300 border border-white/10 leading-relaxed">
                    {t.settings.aiGateway.aiReply} &ldquo;{testResult.reply}&rdquo;
                  </div>
                )}
                {testResult.error && (
                  <p className="text-rose-300/90 leading-relaxed font-mono text-[11px] bg-black/50 p-3 rounded-lg border border-rose-500/20">
                    {testResult.error}
                  </p>
                )}
              </div>
            )}
          </div>
            </>
          )}
        </div>
      )}

      {/* Video Generation AI Provider Card */}
      {loaded && (
        <form
          onSubmit={handleSaveVideoSettings}
          className={`rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl transition-all ${
            collapsedCards.videoProvider ? "space-y-0" : "space-y-4"
          }`}
        >
          <div
            className={`flex flex-wrap items-center justify-between gap-4 ${
              collapsedCards.videoProvider ? "" : "border-b border-border/60 pb-4"
            }`}
          >
            <div
              className="space-y-0.5 cursor-pointer select-none"
              onClick={() => toggleCard("videoProvider")}
            >
              <div className="flex items-center gap-2">
                <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                  <Film className="h-5 w-5 text-accent" />
                  {locale === "vi" ? "Dịch vụ Sinh Video AI (Video Provider)" : "Video Generation AI Provider"}
                </h2>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-mono font-medium ${
                    videoActiveProvider === "http"
                      ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                      : "border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
                  }`}
                >
                  {videoActiveProvider === "http"
                    ? "HTTP ADAPTER"
                    : (locale === "vi" ? "MÔ PHỎNG (MOCK)" : "SIMULATED")}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                {locale === "vi"
                  ? "Cấu hình API kết nối dịch vụ sinh video (Veo, Runway, Kling, Luma) hoặc dùng Mock Provider mô phỏng"
                  : "Configure video generation API (Veo, Runway, Kling, Luma) or use internal mock simulation"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleCard("videoProvider")}
                className="rounded-xl border border-border/70 bg-canvas/70 p-2 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
                title={collapsedCards.videoProvider ? "Mở rộng" : "Thu gọn"}
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-200 ${
                    collapsedCards.videoProvider ? "" : "rotate-180"
                  }`}
                />
              </button>
            </div>
          </div>

          {!collapsedCards.videoProvider && (
            <div className="space-y-4 pt-1">
              {/* Presets banner */}
              <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 text-xs text-zinc-300 space-y-1.5">
                <div className="font-semibold text-accent flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  {locale === "vi" ? "Chế độ hoạt động & Nhà cung cấp" : "Operational Mode & Providers"}
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  {locale === "vi"
                    ? "• Để trống API URL: Chạy ở chế độ Mô phỏng (Simulated) — hoàn toàn miễn phí, Agent vẫn kiểm tra kịch bản và tiến trình đầy đủ.\n• Điền API URL: Kết nối adapter tương thích HTTP (hỗ trợ tích hợp Runway Gen-3, Kling AI, Luma Dream Machine, Google Veo...)"
                    : "• Leave URL empty: Simulated mock mode — completely free, Agent tests scripts and review workflow.\n• Fill URL: Connect to HTTP adapter (compatible with Runway Gen-3, Kling, Luma, Google Veo...)"}
                </p>
              </div>

              {/* API URL Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-200 flex items-center justify-between">
                  <span>{locale === "vi" ? "Video Generator API URL" : "Video Generator API URL"}</span>
                  <span className="text-[11px] font-normal text-zinc-500">
                    {locale === "vi" ? "Để trống = Mock Simulation" : "Empty = Mock Simulation"}
                  </span>
                </label>
                <input
                  type="url"
                  value={videoGenApiUrl}
                  onChange={(e) => setVideoGenApiUrl(e.target.value)}
                  placeholder="https://api.your-video-service.com/v1/generate"
                  className="w-full rounded-xl border border-border/80 bg-canvas/90 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono"
                />
              </div>

              {/* API Key Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-200 flex items-center justify-between">
                  <span>{locale === "vi" ? "API Key / Bearer Token" : "API Key / Bearer Token"}</span>
                  {hasVideoKey && (
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      {locale === "vi" ? "Đã lưu key" : "Key configured"} ({videoMaskedKey})
                    </span>
                  )}
                </label>
                <div className="relative">
                  <input
                    type={showVideoKey ? "text" : "password"}
                    value={videoGenApiKey}
                    onChange={(e) => setVideoGenApiKey(e.target.value)}
                    placeholder={hasVideoKey ? (videoMaskedKey || "••••••••") : (locale === "vi" ? "Nhập Bearer API Token (nếu dịch vụ yêu cầu)..." : "Enter Bearer API Token...")}
                    className="w-full rounded-xl border border-border/80 bg-canvas/90 px-3.5 py-2.5 pr-10 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowVideoKey(!showVideoKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showVideoKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Status Message */}
              {videoMessage && (
                <div
                  className={`rounded-xl border p-3 text-xs flex items-center gap-2 ${
                    videoMessage.type === "success"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  }`}
                >
                  {videoMessage.type === "success" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                  )}
                  <span>{videoMessage.text}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between pt-2">
                <div className="text-[11px] text-zinc-500">
                  {locale === "vi" ? "Biến môi trường tương đương: " : "Equivalent env variables: "}
                  <code className="text-zinc-400">VIDEO_GEN_API_URL</code>, <code className="text-zinc-400">VIDEO_GEN_API_KEY</code>
                </div>
                <button
                  type="submit"
                  disabled={savingVideo}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-canvas transition-all hover:bg-accent/90 disabled:opacity-50 cursor-pointer shadow-lg shadow-accent/20"
                >
                  {savingVideo ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {locale === "vi" ? "Lưu Cấu Hình Video" : "Save Video Settings"}
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      {/* Main Budget Guardrail Form */}
      {loaded && (
        <form onSubmit={handleSaveBudget} className={`rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl transition-all ${collapsedCards.budgetCap ? "space-y-0" : "space-y-4"}`}>
          <div className={`flex flex-wrap items-center justify-between gap-4 ${collapsedCards.budgetCap ? "" : "border-b border-border/60 pb-3"}`}>
            <div
              className="space-y-1 cursor-pointer select-none"
              onClick={() => toggleCard("budgetCap")}
            >
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-zinc-100">{t.settings.budget.title}</h2>
                {collapsedCards.budgetCap && (
                  <span className="rounded-full border border-border/70 bg-canvas/70 px-2.5 py-0.5 text-[11px] font-mono text-zinc-300">
                    Trần: {capInput ? `$${capInput}` : (budgetCapNumber != null ? `$${budgetCapNumber.toFixed(2)}` : "Không giới hạn")}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400">
                {t.settings.budget.desc}
              </p>
            </div>

            <button
              type="button"
              onClick={() => toggleCard("budgetCap")}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-canvas/60 text-zinc-400 hover:text-zinc-100 hover:border-border transition-all cursor-pointer shadow-sm"
              title={collapsedCards.budgetCap ? "Mở rộng card" : "Thu hẹp card"}
            >
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${collapsedCards.budgetCap ? "-rotate-90 text-zinc-400" : "rotate-0 text-accent"}`} />
            </button>
          </div>

          {!collapsedCards.budgetCap && (
            <>
              <div className="space-y-2 pt-1">
                <div className="relative max-w-xs">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g.: 50.00"
                    value={capInput}
                    onChange={(e) => setCapInput(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-canvas/90 py-2.5 pl-8 pr-4 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-all focus:border-accent focus:ring-1 focus:ring-accent"
                  />
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  💡 {t.settings.budget.autoBlockNotice}
                </p>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                {saving ? t.common.saving : t.settings.budget.saveCap}
              </button>
            </>
          )}
        </form>
      )}

      {/* Reset Monthly Cost Section */}
      <div className={`rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl transition-all ${collapsedCards.costCycle ? "space-y-0" : "space-y-3"}`}>
        <div className={`flex flex-wrap items-center justify-between gap-4 ${collapsedCards.costCycle ? "" : "border-b border-border/60 pb-3"}`}>
          <div
            className="space-y-1 cursor-pointer select-none"
            onClick={() => toggleCard("costCycle")}
          >
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-zinc-100">{locale === "vi" ? "Chu kỳ & Reset đầu tháng" : "Cycle & Monthly Cost Reset"}</h2>
              {collapsedCards.costCycle && (
                <span className="rounded-full border border-border/70 bg-canvas/70 px-2.5 py-0.5 text-[11px] font-mono text-zinc-300">
                  Reset định kỳ $0
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400">
              {locale === "vi" ? "Đặt lại số dư tiêu thụ tích luỹ về $0 để bắt đầu kỳ tính toán mới." : "Reset accumulated AI cost counter to $0 to start a new billing cycle."}
            </p>
          </div>

          <button
            type="button"
            onClick={() => toggleCard("costCycle")}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-canvas/60 text-zinc-400 hover:text-zinc-100 hover:border-border transition-all cursor-pointer shadow-sm"
            title={collapsedCards.costCycle ? "Mở rộng card" : "Thu hẹp card"}
          >
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${collapsedCards.costCycle ? "-rotate-90 text-zinc-400" : "rotate-0 text-accent"}`} />
          </button>
        </div>

        {!collapsedCards.costCycle && (
          <>
            <p className="text-xs text-zinc-500 leading-relaxed pt-1">
              {locale === "vi"
                ? "Nút này sẽ reset monthlyCostUsd của tất cả Agent về $0, đồng thời tự động mở lại (chuyển về READY) các agent đang bị khoá do Budget Guardrail (cả trần riêng lẫn trần công ty)."
                : "This resets monthlyCostUsd for all agents back to $0, and unlocks (restores to READY) agents that were suspended due to Budget Guardrails."}
            </p>

            <button
              onClick={handleResetCompanyCost}
              disabled={resetting}
              className="flex items-center gap-2 rounded-xl border border-border/80 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/10 hover:text-zinc-100 disabled:opacity-50 cursor-pointer shadow-sm"
            >
              <RotateCcw className={`h-4 w-4 ${resetting ? "animate-spin" : ""}`} />
              <span>{resetting ? t.common.loading : t.settings.budget.resetCostBtn}</span>
            </button>
          </>
        )}
      </div>

      {/* RBAC System Permissions Matrix Card (Phân quyền sử dụng hệ thống) */}
      <div className={`rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl backdrop-blur-sm transition-all ${collapsedCards.rbacMatrix ? "space-y-0" : "space-y-6"}`}>
        {/* Card Header */}
        <div className={`flex flex-wrap items-center justify-between gap-4 ${collapsedCards.rbacMatrix ? "" : "border-b border-border/60 pb-4"}`}>
          <div
            className="space-y-0.5 cursor-pointer select-none"
            onClick={() => toggleCard("rbacMatrix")}
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-inner">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-zinc-100">
                    {t.settings.rbac.title}
                  </h2>
                  <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 text-[10px] font-medium text-indigo-400 font-mono">
                    {t.settings.rbac.badge}
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  {t.settings.rbac.desc}
                </p>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2.5">
            {!collapsedCards.rbacMatrix && (
              <>
                <button
                  type="button"
                  onClick={handleResetRbacDefaults}
                  disabled={resettingRbac || loadingRbac}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-white/5 px-3.5 py-2 text-xs font-medium text-zinc-300 transition-all hover:bg-white/10 hover:text-zinc-100 disabled:opacity-50 cursor-pointer"
                  title={t.settings.rbac.resetDefaultsBtn}
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${resettingRbac ? "animate-spin text-accent" : ""}`} />
                  <span>{resettingRbac ? t.settings.rbac.resettingDefaultsBtn : t.settings.rbac.resetDefaultsBtn}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveRbac}
                  disabled={savingRbac || loadingRbac}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-50 cursor-pointer shadow-md shadow-accent/20 font-medium"
                >
                  {savingRbac ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  <span>{savingRbac ? t.settings.rbac.savingBtn : t.settings.rbac.saveBtn}</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => toggleCard("rbacMatrix")}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-canvas/60 text-zinc-400 hover:text-zinc-100 hover:border-border transition-all cursor-pointer shadow-sm"
              title={collapsedCards.rbacMatrix ? "Mở rộng card" : "Thu hẹp card"}
            >
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${collapsedCards.rbacMatrix ? "-rotate-90 text-zinc-400" : "rotate-0 text-accent"}`} />
            </button>
          </div>
        </div>

        {!collapsedCards.rbacMatrix && (
          <>

        {/* Feedback Message */}
        {rbacMessage && (
          <div
            className={`flex items-center gap-2.5 rounded-xl border p-3.5 text-xs ${
              rbacMessage.type === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-300"
            }`}
          >
            {rbacMessage.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            )}
            <span>{rbacMessage.text}</span>
          </div>
        )}

        {/* Tab Switcher Pills */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-3">
          <button
            type="button"
            onClick={() => setRbacActiveTab("modules")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
              rbacActiveTab === "modules"
                ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/40 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
            }`}
          >
            <Layers className="h-4 w-4 text-indigo-400" />
            <span>{t.settings.rbac.tabModules}</span>
          </button>

          <button
            type="button"
            onClick={() => setRbacActiveTab("agents")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
              rbacActiveTab === "agents"
                ? "bg-accent/15 text-accent border border-accent/40 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
            }`}
          >
            <Bot className="h-4 w-4 text-accent" />
            <span>{t.settings.rbac.tabAgents}</span>
            <span className="rounded-full bg-accent/20 px-2 py-0.2 text-[10px] font-mono text-accent">
              {agents.length} Agents
            </span>
          </button>

          <button
            type="button"
            onClick={() => setRbacActiveTab("commands")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
              rbacActiveTab === "commands"
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
            }`}
          >
            <Terminal className="h-4 w-4 text-emerald-400" />
            <span>{t.settings.rbac.tabCommands}</span>
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.2 text-[10px] font-mono text-emerald-300">
              {rbacMatrix?.commands?.length || 12} Commands
            </span>
          </button>
        </div>

        {/* Matrix Table */}
        {loadingRbac && !rbacMatrix ? (
          <div className="flex h-48 items-center justify-center text-zinc-500 space-x-2">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <span className="text-xs">Đang tải ma trận phân quyền...</span>
          </div>
        ) : (
          rbacMatrix && (
            <div className="space-y-4">
              {/* TAB 1: System Modules Matrix */}
              {rbacActiveTab === "modules" && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="overflow-x-auto rounded-xl border border-border/70 bg-zinc-950/60 shadow-inner">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border/80 bg-white/[0.03]">
                          <th className="py-3 px-4 text-xs font-semibold text-zinc-300 min-w-[240px]">
                            {t.settings.rbac.columnModule}
                          </th>
                          {rbacMatrix.roles.map((role) => {
                            const isFounder = role.id === "founder";
                            const grantedCount = rbacMatrix.modules.filter(
                              (m) => rbacMatrix.permissions[role.id]?.[m.id]
                            ).length;
                            const totalCount = rbacMatrix.modules.length;

                            return (
                              <th
                                key={role.id}
                                className="py-3 px-4 text-xs font-semibold text-zinc-200 text-center min-w-[150px]"
                              >
                                <div className="flex flex-col items-center gap-1">
                                  <div className="flex items-center gap-1.5">
                                    <span>{locale === "vi" ? role.nameVi : role.name}</span>
                                    {isFounder && (
                                      <span title={locale === "vi" ? "Toàn quyền bảo mật" : "Full Governance"}>
                                        <Lock className="h-3 w-3 text-amber-400" />
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className={`rounded-full px-2 py-0.2 text-[9px] font-mono border ${
                                        isFounder
                                          ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                                          : role.id === "manager"
                                          ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/30"
                                          : role.id === "operator"
                                          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                                          : "bg-zinc-800 text-zinc-400 border-zinc-700"
                                      }`}
                                    >
                                      {grantedCount}/{totalCount} quyền
                                    </span>
                                  </div>

                                  {/* Quick Column Toggles (for non-founder) */}
                                  {!isFounder && (
                                    <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-500 font-normal">
                                      <button
                                        type="button"
                                        onClick={() => handleToggleAllRolePermissions(role.id, true)}
                                        className="text-accent hover:underline cursor-pointer"
                                      >
                                        {t.settings.rbac.selectAll}
                                      </button>
                                      <span>•</span>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleAllRolePermissions(role.id, false)}
                                        className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
                                      >
                                        {t.settings.rbac.clearAll}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {rbacMatrix.modules.map((mod, idx) => {
                          return (
                            <tr
                              key={mod.id}
                              className={`hover:bg-white/[0.02] transition-colors ${
                                idx % 2 === 0 ? "bg-transparent" : "bg-white/[0.01]"
                              }`}
                            >
                              {/* Module info cell */}
                              <td className="py-3 px-4">
                                <div className="space-y-0.5">
                                  <p className="font-medium text-zinc-200">
                                    {locale === "vi" ? mod.nameVi : mod.name}
                                  </p>
                                  <p className="text-[11px] text-zinc-500 line-clamp-1">
                                    {locale === "vi" ? mod.descriptionVi : mod.description}
                                  </p>
                                </div>
                              </td>

                              {/* Role checkboxes */}
                              {rbacMatrix.roles.map((role) => {
                                const isFounder = role.id === "founder";
                                const isChecked = isFounder
                                  ? true
                                  : Boolean(rbacMatrix.permissions[role.id]?.[mod.id]);

                                return (
                                  <td key={role.id} className="py-3 px-4 text-center">
                                    <div className="flex items-center justify-center">
                                      {isFounder ? (
                                        <div
                                          className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 cursor-not-allowed"
                                          title="Founder luôn có đầy đủ quyền hạn"
                                        >
                                          <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => handleToggleRbacPermission(role.id, mod.id)}
                                          className={`flex h-6 w-6 items-center justify-center rounded-lg border transition-all cursor-pointer ${
                                            isChecked
                                              ? "bg-accent border-accent text-black shadow-sm shadow-accent/30 font-bold"
                                              : "bg-zinc-900 border-border/80 text-transparent hover:border-zinc-500"
                                          }`}
                                          title={`${isChecked ? "Bỏ quyền" : "Cấp quyền"} ${locale === "vi" ? mod.nameVi : mod.name} cho ${locale === "vi" ? role.nameVi : role.name}`}
                                        >
                                          <Check className={`h-3.5 w-3.5 stroke-[2.5] ${isChecked ? "opacity-100" : "opacity-0"}`} />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Security Guardrail Note */}
                  <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-zinc-400">
                    <Lock className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>{t.settings.rbac.immutableAdminNotice}</span>
                  </div>
                </div>
              )}

              {/* TAB 2: AI Agent Scopes & Controls Matrix */}
              {rbacActiveTab === "agents" && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="overflow-x-auto rounded-xl border border-border/70 bg-zinc-950/60 shadow-inner">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border/80 bg-white/[0.03]">
                          <th className="py-3 px-4 text-xs font-semibold text-zinc-300 min-w-[240px]">
                            {t.settings.rbac.columnAgent}
                          </th>
                          {rbacMatrix.roles.map((role) => {
                            const isFounder = role.id === "founder";
                            const controlCount = agents.filter(
                              (a) => rbacMatrix.agentPermissions?.[role.id]?.[a.id]?.canControl
                            ).length;
                            const totalCount = agents.length;

                            return (
                              <th
                                key={role.id}
                                className="py-3 px-4 text-xs font-semibold text-zinc-200 text-center min-w-[175px]"
                              >
                                <div className="flex flex-col items-center gap-1">
                                  <div className="flex items-center gap-1.5">
                                    <span>{locale === "vi" ? role.nameVi : role.name}</span>
                                    {isFounder && (
                                      <span title={locale === "vi" ? "Toàn quyền bảo mật" : "Full Governance"}>
                                        <Lock className="h-3 w-3 text-amber-400" />
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className={`rounded-full px-2 py-0.2 text-[9px] font-mono border ${
                                        isFounder
                                          ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                                          : role.id === "manager"
                                          ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/30"
                                          : role.id === "operator"
                                          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                                          : "bg-zinc-800 text-zinc-400 border-zinc-700"
                                      }`}
                                    >
                                      {controlCount}/{totalCount} {locale === "vi" ? "điều khiển" : "control"}
                                    </span>
                                  </div>

                                  {/* Quick Column Toggles for Agents (for non-founder) */}
                                  {!isFounder && (
                                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-zinc-500 font-normal">
                                      <button
                                        type="button"
                                        onClick={() => handleSetRoleAllAgents(role.id, "full")}
                                        className="text-accent hover:underline cursor-pointer"
                                      >
                                        {t.settings.rbac.fullAccess}
                                      </button>
                                      <span>•</span>
                                      <button
                                        type="button"
                                        onClick={() => handleSetRoleAllAgents(role.id, "view_only")}
                                        className="text-sky-400 hover:underline cursor-pointer"
                                      >
                                        {t.settings.rbac.viewOnly}
                                      </button>
                                      <span>•</span>
                                      <button
                                        type="button"
                                        onClick={() => handleSetRoleAllAgents(role.id, "none")}
                                        className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
                                      >
                                        {t.settings.rbac.noAccess}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {agents.map((agent, idx) => {
                          return (
                            <tr
                              key={agent.id}
                              className={`hover:bg-white/[0.02] transition-colors ${
                                idx % 2 === 0 ? "bg-transparent" : "bg-white/[0.01]"
                              }`}
                            >
                              {/* Agent info cell */}
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2.5">
                                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 border border-white/10 text-zinc-300 font-mono text-xs font-bold">
                                    {agent.name.slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="font-semibold text-zinc-100 truncate">{agent.name}</p>
                                      <span className="rounded bg-white/5 px-1.5 py-0.2 text-[9px] font-mono text-zinc-400 border border-white/5">
                                        {agent.id}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-zinc-500 truncate">{agent.title}</p>
                                  </div>
                                </div>
                              </td>

                              {/* Role Agent Checkboxes */}
                              {rbacMatrix.roles.map((role) => {
                                const isFounder = role.id === "founder";
                                const perm = rbacMatrix.agentPermissions?.[role.id]?.[agent.id] || {
                                  canView: isFounder,
                                  canControl: isFounder,
                                };

                                return (
                                  <td key={role.id} className="py-3 px-4 text-center">
                                    <div className="flex items-center justify-center gap-1.5">
                                      {/* View Toggle */}
                                      <button
                                        type="button"
                                        disabled={isFounder}
                                        onClick={() => handleToggleAgentView(role.id, agent.id)}
                                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium border transition-all ${
                                          isFounder || perm.canView
                                            ? "bg-sky-500/15 border-sky-500/30 text-sky-300"
                                            : "bg-zinc-900 border-border/80 text-zinc-600 hover:border-zinc-500 hover:text-zinc-400"
                                        } ${isFounder ? "cursor-not-allowed opacity-90" : "cursor-pointer"}`}
                                        title={`${t.settings.rbac.viewPermTitle}: ${agent.name} (${role.name})`}
                                      >
                                        <Eye className={`h-3 w-3 ${isFounder || perm.canView ? "text-sky-400" : "text-zinc-600"}`} />
                                        <span>{t.settings.rbac.viewPerm}</span>
                                      </button>

                                      {/* Control Toggle */}
                                      <button
                                        type="button"
                                        disabled={isFounder}
                                        onClick={() => handleToggleAgentControl(role.id, agent.id)}
                                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium border transition-all ${
                                          isFounder || perm.canControl
                                            ? "bg-amber-500/15 border-amber-500/30 text-amber-300 font-semibold"
                                            : "bg-zinc-900 border-border/80 text-zinc-600 hover:border-zinc-500 hover:text-zinc-400"
                                        } ${isFounder ? "cursor-not-allowed opacity-90" : "cursor-pointer"}`}
                                        title={`${t.settings.rbac.controlPermTitle}: ${agent.name} (${role.name})`}
                                      >
                                        <Bot className={`h-3 w-3 ${isFounder || perm.canControl ? "text-amber-400" : "text-zinc-600"}`} />
                                        <span>{t.settings.rbac.controlPerm}</span>
                                      </button>
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                        {agents.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-zinc-500">
                              {locale === "vi" ? "Chưa có Agent nào trong hệ thống." : "No agents registered yet."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Security Guardrail Note for Agents */}
                  <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-zinc-400">
                    <Lock className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>{t.settings.rbac.immutableFounderAgentNotice}</span>
                  </div>
                </div>
              )}

              {/* TAB 3: Suggested Commands & Quick Nav Matrix */}
              {rbacActiveTab === "commands" && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="overflow-x-auto rounded-xl border border-border/70 bg-zinc-950/60 shadow-inner">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border/80 bg-white/[0.03]">
                          <th className="py-3 px-4 text-xs font-semibold text-zinc-300 min-w-[260px]">
                            {t.settings.rbac.columnCommand}
                          </th>
                          {rbacMatrix.roles.map((role) => {
                            const isFounder = role.id === "founder";
                            const commandsList = rbacMatrix.commands || [];
                            const grantedCount = commandsList.filter(
                              (cmd) => rbacMatrix.commandPermissions?.[role.id]?.[cmd.id]
                            ).length;
                            const totalCount = commandsList.length;

                            return (
                              <th
                                key={role.id}
                                className="py-3 px-4 text-xs font-semibold text-zinc-200 text-center min-w-[150px]"
                              >
                                <div className="flex flex-col items-center gap-1">
                                  <div className="flex items-center gap-1.5">
                                    <span>{locale === "vi" ? role.nameVi : role.name}</span>
                                    {isFounder && (
                                      <span title={locale === "vi" ? "Toàn quyền bảo mật" : "Full Governance"}>
                                        <Lock className="h-3 w-3 text-amber-400" />
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className={`rounded-full px-2 py-0.2 text-[9px] font-mono border ${
                                        isFounder
                                          ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                                          : role.id === "manager"
                                          ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/30"
                                          : role.id === "operator"
                                          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                                          : "bg-zinc-800 text-zinc-400 border-zinc-700"
                                      }`}
                                    >
                                      {t.settings.rbac.commandCount
                                        .replace("{count}", String(grantedCount))
                                        .replace("{total}", String(totalCount))}
                                    </span>
                                  </div>

                                  {/* Quick Column Toggles (for non-founder) */}
                                  {!isFounder && (
                                    <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-500 font-normal">
                                      <button
                                        type="button"
                                        onClick={() => handleToggleAllRoleCommands(role.id, true)}
                                        className="text-accent hover:underline cursor-pointer"
                                      >
                                        {t.settings.rbac.selectAll}
                                      </button>
                                      <span>•</span>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleAllRoleCommands(role.id, false)}
                                        className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
                                      >
                                        {t.settings.rbac.clearAll}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {(rbacMatrix.commands || []).map((cmd, idx) => {
                          return (
                            <tr
                              key={cmd.id}
                              className={`hover:bg-white/[0.02] transition-colors ${
                                idx % 2 === 0 ? "bg-transparent" : "bg-white/[0.01]"
                              }`}
                            >
                              {/* Command info cell */}
                              <td className="py-3 px-4">
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 text-xs">
                                      {cmd.command}
                                    </span>
                                    {cmd.danger && (
                                      <span className="rounded bg-rose-500/20 border border-rose-500/30 px-1.5 py-0.2 text-[9px] font-mono text-rose-300">
                                        Rule 12 Emergency
                                      </span>
                                    )}
                                    {cmd.isNav && (
                                      <span className="text-[10px] text-zinc-500 flex items-center gap-0.5">
                                        <ExternalLink className="h-2.5 w-2.5" /> Quick Nav
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-zinc-400">
                                    {locale === "vi" ? cmd.nameVi : cmd.name}
                                  </p>
                                  <p className="text-[10px] text-zinc-500 line-clamp-1">
                                    {locale === "vi" ? cmd.descriptionVi : cmd.description}
                                  </p>
                                </div>
                              </td>

                              {/* Role checkboxes */}
                              {rbacMatrix.roles.map((role) => {
                                const isFounder = role.id === "founder";
                                const isChecked = isFounder
                                  ? true
                                  : Boolean(rbacMatrix.commandPermissions?.[role.id]?.[cmd.id]);

                                return (
                                  <td key={role.id} className="py-3 px-4 text-center">
                                    <div className="flex items-center justify-center">
                                      {isFounder ? (
                                        <div
                                          className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 cursor-not-allowed"
                                          title="Founder luôn có đầy đủ quyền hạn"
                                        >
                                          <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => handleToggleRbacCommandPermission(role.id, cmd.id)}
                                          className={`flex h-6 w-6 items-center justify-center rounded-lg border transition-all cursor-pointer ${
                                            isChecked
                                              ? "bg-accent border-accent text-black shadow-sm shadow-accent/30 font-bold"
                                              : "bg-zinc-900 border-border/80 text-transparent hover:border-zinc-500"
                                          }`}
                                          title={`${isChecked ? "Bỏ quyền" : "Cấp quyền"} lệnh ${cmd.command} cho ${locale === "vi" ? role.nameVi : role.name}`}
                                        >
                                          <Check className={`h-3.5 w-3.5 stroke-[2.5] ${isChecked ? "opacity-100" : "opacity-0"}`} />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Security Guardrail Note */}
                  <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-zinc-400">
                    <Lock className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>{t.settings.rbac.immutableFounderCommandNotice}</span>
                  </div>
                </div>
              )}
            </div>
          )
        )}
          </>
        )}
      </div>

      {/* System Console Logs Section */}
      <div className={`rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-xl transition-all ${collapsedCards.systemLogs ? "space-y-0" : "space-y-4"}`}>
        <div className={`flex flex-wrap items-center justify-between gap-4 ${collapsedCards.systemLogs ? "" : "border-b border-border/60 pb-4"}`}>
          <div
            className="space-y-0.5 cursor-pointer select-none"
            onClick={() => toggleCard("systemLogs")}
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-inner">
                <Terminal className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-semibold text-zinc-100">
                    {locale === "vi" ? "Logs (Nhật ký Console hệ thống)" : "Logs (System & Console)"}
                  </h2>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                      isWsConnected
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isWsConnected ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"
                      }`}
                    />
                    {isWsConnected
                      ? locale === "vi"
                        ? "Live Streaming"
                        : "Live Streaming"
                      : locale === "vi"
                      ? "Chưa kết nối WS"
                      : "Disconnected"}
                  </span>
                  {collapsedCards.systemLogs && (
                    <span className="rounded-full border border-border/70 bg-canvas/70 px-2 py-0.5 text-[11px] font-mono text-zinc-400">
                      {filteredLogs.length} logs
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-400">
                  {locale === "vi"
                    ? "Hiển thị luồng console log máy chủ thời gian thực (LookupService, Zalo/Telegram Inbound, AI Worker, bootstrap...)"
                    : "Real-time server console stream (LookupService, Zalo/Telegram Inbound, AI Worker, bootstrap...)"}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {!collapsedCards.systemLogs && (
              <>
                <button
                  type="button"
                  onClick={() => setAutoScroll((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                    autoScroll
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-border/60 bg-white/5 text-zinc-400 hover:text-zinc-200"
                  }`}
                  title={locale === "vi" ? "Tự động cuộn theo log mới" : "Auto-scroll to latest"}
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${autoScroll ? "text-accent" : ""}`} />
                  <span>Auto-scroll {autoScroll ? (locale === "vi" ? "BẬT" : "ON") : (locale === "vi" ? "TẮT" : "OFF")}</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyLogs}
                  disabled={filteredLogs.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-zinc-100 disabled:opacity-40 cursor-pointer"
                  title={locale === "vi" ? "Sao chép toàn bộ log đang hiển thị" : "Copy logs"}
                >
                  {copiedLogs ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedLogs ? (locale === "vi" ? "Đã chép!" : "Copied!") : (locale === "vi" ? "Sao chép" : "Copy")}</span>
                </button>

                <button
                  type="button"
                  onClick={loadLogs}
                  disabled={loadingLogs}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-zinc-100 disabled:opacity-40 cursor-pointer"
                  title={locale === "vi" ? "Tải lại danh sách log" : "Refresh logs"}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingLogs ? "animate-spin" : ""}`} />
                  <span>{loadingLogs ? (locale === "vi" ? "Đang tải..." : "Loading...") : (locale === "vi" ? "Làm mới" : "Refresh")}</span>
                </button>

                <button
                  type="button"
                  onClick={handleClearLogs}
                  disabled={logs.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 transition-colors hover:bg-rose-500/20 disabled:opacity-40 cursor-pointer"
                  title={locale === "vi" ? "Xóa sạch bộ nhớ log" : "Clear logs"}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{locale === "vi" ? "Xóa log" : "Clear"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsLogExpanded((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-white/5 p-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 cursor-pointer"
                  title={isLogExpanded ? (locale === "vi" ? "Thu gọn chiều cao" : "Collapse") : (locale === "vi" ? "Mở rộng chiều cao" : "Expand")}
                >
                  {isLogExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => toggleCard("systemLogs")}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-canvas/60 text-zinc-400 hover:text-zinc-100 hover:border-border transition-all cursor-pointer shadow-sm"
              title={collapsedCards.systemLogs ? "Mở rộng card" : "Thu hẹp card"}
            >
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${collapsedCards.systemLogs ? "-rotate-90 text-zinc-400" : "rotate-0 text-accent"}`} />
            </button>
          </div>
        </div>

        {!collapsedCards.systemLogs && (
          <>
            {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-400 font-medium">
              {locale === "vi" ? "Lọc cấp độ:" : "Level:"}
            </span>
            {(["all", "info", "warn", "error"] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLogFilterLevel(lvl)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                  logFilterLevel === lvl
                    ? lvl === "error"
                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                      : lvl === "warn"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                      : lvl === "info"
                      ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                      : "bg-accent/20 text-accent border border-accent/40"
                    : "bg-zinc-900/60 text-zinc-400 border border-border/40 hover:text-zinc-200"
                }`}
              >
                {lvl === "all" ? (locale === "vi" ? "Tất cả" : "All") : lvl.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Search Input */}
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
              <input
                type="text"
                placeholder={locale === "vi" ? "Tìm nội dung log..." : "Search logs..."}
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                className="w-full rounded-lg border border-border/60 bg-zinc-950/80 py-1.5 pl-8 pr-8 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-accent"
              />
              {logSearch && (
                <button
                  type="button"
                  onClick={() => setLogSearch("")}
                  className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <span className="text-[11px] font-mono text-zinc-400 whitespace-nowrap">
              {filteredLogs.length} {locale === "vi" ? "dòng" : "lines"}
            </span>
          </div>
        </div>

        {/* Terminal Window Box */}
        <div
          ref={logContainerRef}
          className={`rounded-xl border border-border/80 bg-[#070a12] p-3.5 font-mono text-[12px] leading-relaxed overflow-y-auto transition-all duration-200 shadow-inner ${
            isLogExpanded ? "h-[650px]" : "h-[380px]"
          }`}
        >
          {filteredLogs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-zinc-500 space-y-2">
              <Terminal className="h-8 w-8 text-zinc-600 stroke-[1.5]" />
              <p className="text-xs">
                {logs.length === 0
                  ? locale === "vi"
                    ? "Chưa có log hệ thống nào được ghi nhận."
                    : "No system logs recorded yet."
                  : locale === "vi"
                  ? "Không tìm thấy dòng log nào khớp với điều kiện lọc."
                  : "No logs matching current filter."}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredLogs.map((item, idx) => {
                const dateObj = new Date(item.timestamp);
                const timeStr = !isNaN(dateObj.getTime())
                  ? dateObj.toLocaleTimeString("vi-VN", {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    }) +
                    "." +
                    String(dateObj.getMilliseconds()).padStart(3, "0")
                  : item.timestamp;

                const isError = item.level === "error";
                const isWarn = item.level === "warn";

                return (
                  <div
                    key={item.id || idx}
                    className={`flex items-start gap-2.5 py-0.5 px-1.5 rounded hover:bg-white/[0.04] transition-colors group ${
                      isError
                        ? "text-rose-300/95 bg-rose-500/[0.06]"
                        : isWarn
                        ? "text-amber-300/95 bg-amber-500/[0.06]"
                        : "text-zinc-300"
                    }`}
                  >
                    {/* Timestamp */}
                    <span className="shrink-0 text-[11px] text-zinc-500 select-none font-mono">
                      {timeStr}
                    </span>

                    {/* Level Pill */}
                    <span
                      className={`shrink-0 text-[10px] uppercase font-semibold px-1.5 py-0.2 rounded border select-none ${
                        isError
                          ? "bg-rose-500/20 text-rose-400 border-rose-500/30"
                          : isWarn
                          ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                          : "bg-sky-500/10 text-sky-400 border-sky-500/20"
                      }`}
                    >
                      {item.level}
                    </span>

                    {/* Source Tag if present */}
                    {item.source && (
                      <span className="shrink-0 text-[11px] font-semibold text-cyan-400/90 bg-cyan-500/10 px-1.5 py-0.2 rounded border border-cyan-500/20">
                        [{item.source}]
                      </span>
                    )}

                    {/* Message Body */}
                    <span className="break-all whitespace-pre-wrap flex-1">
                      {item.source && item.message.startsWith(`[${item.source}]`)
                        ? item.message.slice(item.source.length + 2).trim()
                        : item.message}
                    </span>
                  </div>
                );
              })}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
          </>
        )}
      </div>


      {/* Zalo Login / Auth Modal */}
      <ZaloLoginModal
        isOpen={isZaloModalOpen}
        onClose={() => setIsZaloModalOpen(false)}
        onSuccess={() => {
          setIsZaloModalOpen(false);
          setNotifMessage({
            type: "success",
            text: "Xác thực và liên kết tài khoản Zalo thành công!",
          });
          refresh();
        }}
      />

      {/* Save Notification Preferences Result Modal / Popup */}
      {saveNotifPopup?.isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSaveNotifPopup(null)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-border/80 bg-panel/95 p-6 shadow-2xl backdrop-blur-md transition-all animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setSaveNotifPopup(null)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-100 transition-colors cursor-pointer"
              aria-label="Đóng"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex flex-col items-center text-center space-y-3">
              {/* Status Icon */}
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${
                  saveNotifPopup.type === "success"
                    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                    : "bg-rose-500/15 border-rose-500/30 text-rose-400"
                }`}
              >
                {saveNotifPopup.type === "success" ? (
                  <CheckCircle2 className="h-6 w-6" />
                ) : (
                  <AlertTriangle className="h-6 w-6" />
                )}
              </div>

              {/* Title & Message */}
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-zinc-100">
                  {saveNotifPopup.title}
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed max-w-sm">
                  {saveNotifPopup.message}
                </p>
              </div>

              {/* Channel Summary (if success) */}
              {saveNotifPopup.channelsSummary && (
                <div className="w-full rounded-xl border border-border/60 bg-zinc-950/60 p-3 text-left space-y-1.5 mt-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Trạng thái kênh tiếp nhận:
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {saveNotifPopup.channelsSummary.map((ch) => (
                      <div
                        key={ch.name}
                        className="flex items-center justify-between text-xs px-2 py-1 rounded bg-white/5"
                      >
                        <span className="text-zinc-300 text-[11px]">{ch.name}</span>
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                            ch.enabled
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                          }`}
                        >
                          {ch.enabled ? "BẬT" : "TẮT"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Button */}
              <div className="pt-2 w-full">
                <button
                  type="button"
                  onClick={() => setSaveNotifPopup(null)}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                    saveNotifPopup.type === "success"
                      ? "bg-accent hover:bg-accent/90 text-black shadow-lg shadow-accent/20"
                      : "bg-rose-500 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/20"
                  }`}
                >
                  {saveNotifPopup.type === "success" ? "Đã hiểu & Xác nhận" : "Đóng"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Đặt lại mật khẩu tài khoản */}
      {resettingPasswordAccount && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setResettingPasswordAccount(null)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-border/80 bg-panel/95 p-6 shadow-2xl backdrop-blur-md transition-all animate-in zoom-in-95 duration-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-zinc-100">
                  Đặt lại mật khẩu: {resettingPasswordAccount.email}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setResettingPasswordAccount(null)}
                className="rounded-lg p-1 text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-zinc-300 font-medium">
                    Mật khẩu mới (tối thiểu 6 ký tự):
                  </label>
                  <button
                    type="button"
                    onClick={() => setNewResetPassword(generateRandomPassword())}
                    className="text-[10px] text-accent hover:underline cursor-pointer"
                  >
                    🎲 Sinh ngẫu nhiên
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showResetPassword ? "text" : "password"}
                    required
                    placeholder="Nhập mật khẩu mới"
                    value={newResetPassword}
                    onChange={(e) => setNewResetPassword(e.target.value)}
                    className="w-full rounded-xl border border-border/60 bg-zinc-950/80 px-3 py-2 pr-10 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-accent font-mono"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                  >
                    {showResetPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResettingPasswordAccount(null)}
                  className="rounded-xl border border-border/60 bg-white/5 px-3.5 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submittingResetPassword}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {submittingResetPassword ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Key className="h-3.5 w-3.5" />}
                  <span>{submittingResetPassword ? "Đang lưu..." : "Xác nhận đổi mật khẩu"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Xác nhận xóa tài khoản */}
      {deletingAccount && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setDeletingAccount(null)}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl border border-rose-500/30 bg-panel/95 p-6 shadow-2xl backdrop-blur-md transition-all animate-in zoom-in-95 duration-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center space-y-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/15 text-rose-400">
                <Trash2 className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold text-zinc-100">Xác nhận xóa tài khoản</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Bạn có chắc chắn muốn xóa vĩnh viễn tài khoản{" "}
                <strong className="text-zinc-200 font-mono">{deletingAccount.email}</strong>? Hành động này không thể hoàn tác.
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingAccount(null)}
                className="flex-1 rounded-xl border border-border/60 bg-white/5 py-2.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleDeleteAccountSubmit}
                disabled={submittingDeleteAccount}
                className="flex-1 rounded-xl bg-rose-500 hover:bg-rose-600 text-white py-2.5 text-xs font-semibold shadow-lg shadow-rose-500/20 transition-all disabled:opacity-50 cursor-pointer"
              >
                {submittingDeleteAccount ? "Đang xóa..." : "Xác nhận xóa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
