"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Command, Radio, ShieldCheck, LogOut, BookOpen, Settings, UserPlus } from "lucide-react";
import type { Agent, DecisionPackage } from "@ai-opc/shared";
import { fetchAgents, fetchDecisions, fetchOnboardingStatus, logout } from "@/lib/api";
import { useCompanySocket } from "@/hooks/useCompanySocket";
import { CommandPalette } from "@/components/CommandPalette";
import { DecisionCard } from "@/components/DecisionCard";
import { TaskKanban } from "@/components/TaskKanban";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/context/I18nContext";

const STATUS_DOT: Record<string, string> = {
  READY: "bg-zinc-500",
  RUNNING: "bg-accent",
  WAITING: "bg-warn",
  BLOCKED: "bg-danger",
  ESCALATED: "bg-danger",
  AWAITING_APPROVAL: "bg-warn",
  SUSPENDED: "bg-danger",
};

export default function ExecutiveDashboard() {
  const router = useRouter();
  const { t, interpolate } = useI18n();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [decisions, setDecisions] = useState<DecisionPackage[]>([]);
  const { lastEvent, isConnected } = useCompanySocket();

  useEffect(() => {
    fetchOnboardingStatus()
      .then((s) => {
        if (s?.needsOnboarding) router.push("/onboarding");
      })
      .catch(() => {});
  }, [router]);

  async function refresh() {
    try {
      setAgents(await fetchAgents());
      setDecisions(await fetchDecisions("PENDING"));
    } catch {
      // fetchAgents/fetchDecisions already redirect to /login on 401
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Bất kỳ event nào tới cũng refresh lại state
  useEffect(() => {
    if (lastEvent) refresh();
  }, [lastEvent]);

  return (
    <main className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-6 p-6 lg:grid-cols-[280px_1fr_320px]">
      <CommandPalette />

      {/* Cột trái: Org Chart / trạng thái Agent */}
      <aside className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-zinc-400">{t.cockpit.orgChartTitle}</h2>
            <Link
              href="/agents/new"
              className="flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <UserPlus className="h-3.5 w-3.5" /> {t.nav.hireAgent}
            </Link>
          </div>
          <span className="flex items-center gap-1 text-xs text-zinc-500">
            <Radio className={`h-3 w-3 ${isConnected ? "text-accent" : "text-danger"}`} />
            {isConnected ? t.nav.live : t.nav.offline}
          </span>
        </div>
        <ul className="space-y-1">
          {agents.map((a) => (
            <li key={a.id}>
              <Link
                href={`/agents?id=${a.id}`}
                className="flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-sm transition-colors hover:border-accent/50"
              >
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[a.status] || "bg-zinc-500"}`} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.name}</p>
                  <p className="truncate text-xs text-zinc-500">{a.title}</p>
                </div>
              </Link>
            </li>
          ))}
          {agents.length === 0 && (
            <p className="text-xs text-zinc-500">{t.cockpit.noAgents}</p>
          )}
        </ul>
      </aside>

      {/* Cột giữa: khu vực điều hành chính */}
      <section className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border bg-panel px-4 py-3 gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t.cockpit.title}</h1>
            <p className="text-sm text-zinc-500">
              {t.cockpit.subtitle.replace("{cmdK}", "")}
              <kbd className="rounded bg-white/10 px-1.5 py-0.5">⌘K</kbd>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <LanguageSwitcher />

            <Link
              href="/knowledge"
              title={t.nav.knowledge}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-white/5 text-zinc-300 hover:text-zinc-100"
            >
              <BookOpen className="h-4 w-4 text-accent" />
              <span className="hidden sm:inline">{t.nav.knowledge}</span>
            </Link>
            <Link
              href="/settings"
              title={t.nav.settings}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-white/5 text-zinc-300 hover:text-zinc-100"
            >
              <Settings className="h-4 w-4 text-amber-400" />
              <span className="hidden sm:inline">{t.nav.settings}</span>
            </Link>
            <button
              onClick={() => router.push("/security")}
              title={t.nav.security}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-white/5"
            >
              <ShieldCheck className="h-4 w-4" />
            </button>
            <button
              onClick={async () => { await logout(); window.location.href = "/login"; }}
              title={t.nav.logout}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-white/5"
            >
              <LogOut className="h-4 w-4" />
            </button>
            <button
              onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-white/5"
            >
              <Command className="h-4 w-4" /> {t.nav.command}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-400">{t.kanban.title}</h2>
            <span className="text-xs text-zinc-600">{t.cockpit.websocketLive}</span>
          </div>
          <TaskKanban refreshSignal={lastEvent} onChanged={refresh} />
        </div>
      </section>

      {/* Cột phải: Decision Package chờ duyệt */}
      <aside className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-400">{t.cockpit.pendingDecisions}</h2>
        {decisions.map((d) => (
          <DecisionCard key={d.id} decision={d} onDone={refresh} />
        ))}
        {decisions.length === 0 && (
          <p className="text-xs text-zinc-500">{t.cockpit.noDecisions}</p>
        )}
      </aside>
    </main>
  );
}
