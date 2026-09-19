"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, RotateCcw } from "lucide-react";
import type { AuditLogEntry } from "@ai-opc/shared";
import { AgentAuditLogViewer } from "@/components/AgentAuditLogViewer";
import { useI18n } from "@/context/I18nContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function AuditPage() {
  const { t } = useI18n();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadLogs() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/audit-logs`);
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, []);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" /> {t.nav.backToHome}
        </Link>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <button
            onClick={loadLogs}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-panel px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 hover:text-zinc-200 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t.common.refresh}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-panel p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{t.audit.title}</h1>
            <p className="text-xs text-zinc-500">
              {t.audit.desc}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-panel p-5">
        {loading ? (
          <p className="text-sm text-zinc-500">{t.audit.loadingLogs}</p>
        ) : (
          <AgentAuditLogViewer logs={logs} />
        )}
      </div>
    </main>
  );
}
