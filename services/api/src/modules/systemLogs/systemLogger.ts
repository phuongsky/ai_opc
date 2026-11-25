import util from "util";
import type { SystemLogEntry } from "@ai-opc/shared";
import { broadcastCompanyEvent } from "../../ws/gateway";

const MAX_LOGS = 2000;
const logBuffer: SystemLogEntry[] = [];
let isInitialized = false;

// Original console references
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

function parseSourceAndLevel(
  defaultLevel: "info" | "warn" | "error" | "debug",
  rawText: string
): { level: "info" | "warn" | "error" | "debug"; source?: string } {
  let level = defaultLevel;
  let source: string | undefined;

  // Check tag prefix like [LookupService], [zaloInbound], [bootstrap]
  const tagMatch = rawText.match(/^\[([a-zA-Z0-9_\- ]+)\]/);
  if (tagMatch) {
    source = tagMatch[1].trim();
  }

  // Detect level keywords at beginning
  const lower = rawText.toLowerCase();
  if (lower.startsWith("error") || lower.includes(" uncaughtexception") || lower.includes("unhandledrejection")) {
    level = "error";
  } else if (lower.startsWith("warn")) {
    level = "warn";
  } else if (lower.startsWith("debug")) {
    level = "debug";
  } else if (lower.startsWith("info")) {
    level = "info";
  }

  return { level, source };
}

export function recordLog(
  defaultLevel: "info" | "warn" | "error" | "debug",
  rawMessage: string
): SystemLogEntry {
  const message = stripAnsi(rawMessage);
  const { level, source } = parseSourceAndLevel(defaultLevel, message);
  const entry: SystemLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    level,
    message,
    source,
  };

  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }

  try {
    broadcastCompanyEvent({
      type: "SYSTEM_LOG",
      payload: entry,
    });
  } catch {
    // Gateway not yet ready or non-blocking
  }

  return entry;
}

export function initSystemLogger(): void {
  if (isInitialized) return;
  isInitialized = true;

  console.log = (...args: any[]) => {
    const formatted = util.format(...args);
    originalConsole.log(...args);
    recordLog("info", formatted);
  };

  console.info = (...args: any[]) => {
    const formatted = util.format(...args);
    originalConsole.info(...args);
    recordLog("info", formatted);
  };

  console.warn = (...args: any[]) => {
    const formatted = util.format(...args);
    originalConsole.warn(...args);
    recordLog("warn", formatted);
  };

  console.error = (...args: any[]) => {
    const formatted = util.format(...args);
    originalConsole.error(...args);
    recordLog("error", formatted);
  };

  console.debug = (...args: any[]) => {
    const formatted = util.format(...args);
    originalConsole.debug(...args);
    recordLog("debug", formatted);
  };
}

export function getSystemLogs(options?: {
  limit?: number;
  level?: string;
  search?: string;
}): { logs: SystemLogEntry[]; total: number } {
  let filtered = [...logBuffer];

  if (options?.level && options.level !== "all") {
    const lvl = options.level.toLowerCase();
    filtered = filtered.filter((l) => l.level === lvl);
  }

  if (options?.search) {
    const query = options.search.toLowerCase();
    filtered = filtered.filter(
      (l) =>
        l.message.toLowerCase().includes(query) ||
        (l.source && l.source.toLowerCase().includes(query))
    );
  }

  const limit = options?.limit ? Math.min(options.limit, MAX_LOGS) : 300;
  const sliced = filtered.slice(-limit);

  return {
    logs: sliced,
    total: filtered.length,
  };
}

export function clearSystemLogs(): { success: boolean; cleared: number } {
  const count = logBuffer.length;
  logBuffer.length = 0;
  return { success: true, cleared: count };
}
