"use client";

import { useState } from "react";
import { ShieldAlert, Check, X, KeyRound } from "lucide-react";
import type { DecisionPackage } from "@ai-opc/shared";
import { actOnDecision } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";

const RISK_COLOR: Record<string, string> = {
  R0: "text-zinc-400",
  R1: "text-zinc-300",
  R2: "text-warn",
  R3: "text-warn",
  R4: "text-danger",
};

const HIGH_RISK = new Set(["R3", "R4"]);

export function DecisionCard({
  decision,
  onDone,
}: {
  decision: DecisionPackage;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const [totpPrompt, setTotpPrompt] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(action: "approve" | "reject", code?: string) {
    setError("");
    setBusy(true);
    try {
      await actOnDecision(decision.id, action, code);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error);
    } finally {
      setBusy(false);
    }
  }

  function handleApprove() {
    if (HIGH_RISK.has(decision.riskLevel)) {
      setTotpPrompt(true);
    } else {
      act("approve");
    }
  }

  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault();
    await act("approve", totpCode);
    setTotpPrompt(false);
    setTotpCode("");
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-panel p-5 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className={`h-5 w-5 shrink-0 ${RISK_COLOR[decision.riskLevel]}`} />
          <h3 className="truncate font-medium">{decision.decisionTitle}</h3>
        </div>
        <span className="ml-2 shrink-0 rounded bg-white/5 px-2 py-0.5 font-mono text-xs">
          {decision.riskLevel}
        </span>
      </div>

      {/* Body */}
      <div className="space-y-2 text-sm text-zinc-400">
        <p>
          <span className="text-zinc-200">{t.decisions.reason} </span>
          {decision.reason}
        </p>
        {decision.evidence && (
          <p>
            <span className="text-zinc-200">{t.decisions.evidence} </span>
            {decision.evidence}
          </p>
        )}
        {decision.aiRecommendation && (
          <div className="rounded-lg border border-border/60 bg-white/5 p-2.5 font-mono text-xs text-accent">
            {t.decisions.aiRecommendation} {decision.aiRecommendation}
            {decision.confidenceScore != null &&
              ` (${decision.confidenceScore}% ${t.decisions.confidence})`}
          </div>
        )}
      </div>

      {/* TOTP prompt (R3/R4 approve) */}
      {totpPrompt && (
        <form
          onSubmit={handleTotpSubmit}
          className="rounded-lg border border-warn/30 bg-warn/5 p-3 space-y-2"
        >
          <div className="flex items-center gap-2 text-xs text-warn font-medium">
            <KeyRound className="h-4 w-4" />
            {t.decisions.enter2fa.replace("{level}", decision.riskLevel)}
          </div>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            required
            autoFocus
            className="w-full rounded-md border border-border bg-canvas px-3 py-1.5 text-center font-mono text-base tracking-[0.3em] outline-none focus:border-accent/60"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || totpCode.length !== 6}
              className="flex-1 rounded-md bg-accent py-1.5 text-xs font-semibold text-black disabled:opacity-50"
            >
              {busy ? "..." : t.common.confirm}
            </button>
            <button
              type="button"
              onClick={() => { setTotpPrompt(false); setTotpCode(""); setError(""); }}
              className="flex-1 rounded-md border border-border py-1.5 text-xs text-zinc-400 hover:bg-white/5"
            >
              {t.common.cancel}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}

      {/* Actions */}
      {!totpPrompt && (
        <div className="flex gap-3 pt-1">
          <button
            onClick={handleApprove}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent/90 py-2 text-sm font-medium text-black hover:bg-accent disabled:opacity-50 cursor-pointer"
          >
            <Check className="h-4 w-4" /> {t.decisions.approve}
          </button>
          <button
            onClick={() => act("reject")}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-sm font-medium text-zinc-300 hover:bg-white/5 disabled:opacity-50 cursor-pointer"
          >
            <X className="h-4 w-4" /> {t.decisions.reject}
          </button>
        </div>
      )}
    </div>
  );
}
