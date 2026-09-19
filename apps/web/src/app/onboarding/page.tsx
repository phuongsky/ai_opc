"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Loader2,
  Check,
  X,
  ArrowRight,
  SkipForward,
  Building2,
  Cpu,
  Shield,
  Layers,
  CheckCircle2,
} from "lucide-react";
import {
  generateOnboardingPlan,
  applyOnboardingPlan,
  type OnboardingPlan,
  type OnboardingAgentDraft,
} from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

type RiskTolerance = "conservative" | "balanced" | "bold";
type Step = "intro" | "generating" | "review" | "applying";

export default function OnboardingPage() {
  const router = useRouter();
  const { t, interpolate } = useI18n();

  const [step, setStep] = useState<Step>("intro");
  const [description, setDescription] = useState("");
  const [riskTolerance, setRiskTolerance] = useState<RiskTolerance>("balanced");
  const [plan, setPlan] = useState<OnboardingPlan | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const riskOptions: { value: RiskTolerance; label: string; desc: string }[] = [
    {
      value: "conservative",
      label: t.onboarding?.riskConservative || "Thận trọng",
      desc: t.onboarding?.riskConservativeDesc || "Quyền thấp, cần duyệt nhiều hơn",
    },
    {
      value: "balanced",
      label: t.onboarding?.riskBalanced || "Cân bằng",
      desc: t.onboarding?.riskBalancedDesc || "Mức mặc định hợp lý",
    },
    {
      value: "bold",
      label: t.onboarding?.riskBold || "Táo bạo",
      desc: t.onboarding?.riskBoldDesc || "Quyền cao hơn, ưu tiên tốc độ",
    },
  ];

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setError(null);
    setStep("generating");
    try {
      const result = await generateOnboardingPlan(description.trim(), riskTolerance);
      setPlan(result);
      setExcluded(new Set());
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : (t.onboarding?.generateFailed || "Tạo đề xuất thất bại"));
      setStep("intro");
    }
  }

  function toggleAgent(index: number) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function handleConfirm() {
    if (!plan) return;
    setStep("applying");
    setError(null);
    try {
      const selectedAgents = plan.agents.filter((_, i) => !excluded.has(i));
      await applyOnboardingPlan(plan.departments, selectedAgents);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : (t.onboarding?.applyFailed || "Tạo cơ cấu thất bại"));
      setStep("review");
    }
  }

  async function handleSkip() {
    setStep("applying");
    try {
      await applyOnboardingPlan([], []);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra");
      setStep("intro");
    }
  }

  const selectedCount = plan ? plan.agents.length - excluded.size : 0;

  return (
    <div className="min-h-screen bg-canvas text-zinc-100 flex flex-col justify-between">
      {/* Top Header */}
      <header className="border-b border-border/60 bg-panel/40 backdrop-blur-md px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 border border-accent/30 text-accent">
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <span className="text-sm font-semibold tracking-wide">AI-OPC</span>
              <span className="text-xs text-zinc-500 ml-2">Setup Wizard</span>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-2xl px-6 py-10">
        <div className="mb-6 space-y-2 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
            <Sparkles className="h-3.5 w-3.5" />
            <span>AI Organization Architect</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {t.onboarding?.welcomeTitle || "Chào mừng tới AI-OPC"}
          </h1>
          <p className="text-sm leading-relaxed text-zinc-400">
            {t.onboarding?.welcomeSubtitle ||
              "Trả lời 2 câu hỏi, hệ thống sẽ tự đề xuất phòng ban + đội ngũ AI Agent phù hợp — bạn xem trước và có thể bỏ chọn bất kỳ agent nào trước khi tạo thật."}
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger flex items-start gap-3">
            <X className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{t.common?.error || "Lỗi"}</p>
              <p className="text-xs text-danger/90 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {step === "intro" && (
          <form
            onSubmit={handleGenerate}
            className="space-y-6 rounded-2xl border border-border bg-panel p-6 shadow-xl backdrop-blur-md"
          >
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-200">
                <Building2 className="h-4 w-4 text-accent" />
                {t.onboarding?.whatCompanyDoes || "Công ty bạn làm gì?"}
              </label>
              <textarea
                required
                rows={4}
                placeholder={
                  t.onboarding?.whatCompanyDoesPlaceholder ||
                  "vd: Mình bán khoá học online về nhiếp ảnh, có website + kênh Youtube, khách hàng chủ yếu ở Việt Nam..."
                }
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-border bg-canvas px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-200">
                <Shield className="h-4 w-4 text-accent" />
                {t.onboarding?.riskTolerance || "Mức chấp nhận rủi ro"}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {riskOptions.map((opt) => {
                  const isSelected = riskTolerance === opt.value;
                  return (
                    <button
                      type="button"
                      key={opt.value}
                      onClick={() => setRiskTolerance(opt.value)}
                      className={`rounded-xl border p-3.5 text-left text-sm transition-all cursor-pointer ${
                        isSelected
                          ? "border-accent bg-accent/10 shadow-sm shadow-accent/20"
                          : "border-border/80 bg-canvas/60 hover:bg-white/5 text-zinc-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className={`font-semibold ${isSelected ? "text-accent" : "text-zinc-200"}`}>
                          {opt.label}
                        </p>
                        {isSelected && <CheckCircle2 className="h-4 w-4 text-accent" />}
                      </div>
                      <p className="mt-1 text-xs text-zinc-500 leading-snug">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <button
                type="submit"
                disabled={!description.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-sm font-semibold text-black transition-all hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-accent/20 cursor-pointer"
              >
                <span>{t.onboarding?.generatePlanBtn || "Tạo đề xuất cơ cấu"}</span>
                <ArrowRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={handleSkip}
                className="flex w-full items-center justify-center gap-1.5 py-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
              >
                <SkipForward className="h-3.5 w-3.5" />
                <span>{t.onboarding?.skipManualBtn || "Bỏ qua, tự thiết lập thủ công"}</span>
              </button>
            </div>
          </form>
        )}

        {step === "generating" && (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-panel p-12 text-center shadow-xl">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 border border-accent/30 text-accent">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-white">AI Orchestrator</h3>
              <p className="text-sm text-zinc-400 max-w-md">
                {t.onboarding?.generating ||
                  "AI đang phân tích mô hình kinh doanh và đề xuất cơ cấu tổ chức..."}
              </p>
            </div>
          </div>
        )}

        {step === "review" && plan && (
          <div className="space-y-5">
            <div className="flex items-center justify-between rounded-xl border border-border/80 bg-panel/60 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-accent border border-border">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {t.onboarding?.reviewTitle || "Cơ cấu tổ chức đề xuất"}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {interpolate(
                      t.onboarding?.reviewSubtitle ||
                        "Đề xuất {agents} agent trong {departments} phòng ban. Bỏ chọn agent nào bạn chưa cần — có thể 'Tuyển' thêm sau tại trang chủ.",
                      { agents: plan.agents.length, departments: plan.departments.length }
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {plan.agents.map((agent: OnboardingAgentDraft, i: number) => {
                const isExcluded = excluded.has(i);
                return (
                  <div
                    key={i}
                    className={`rounded-xl border p-4.5 transition-all ${
                      isExcluded
                        ? "border-border/40 bg-panel/30 opacity-50"
                        : "border-border bg-panel shadow-sm hover:border-accent/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-white">{agent.name}</p>
                          <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-zinc-300">
                            {agent.title}
                          </span>
                          <span className="rounded bg-accent/10 border border-accent/20 px-2 py-0.5 text-xs text-accent">
                            {agent.departmentName}
                          </span>
                          <span className="text-xs text-zinc-500 font-mono">
                            Autonomy L{agent.autonomyLevel}
                          </span>
                        </div>
                        <p className="text-sm text-zinc-300 leading-relaxed pt-1">{agent.mission}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleAgent(i)}
                        className={`shrink-0 rounded-lg border p-2 transition cursor-pointer ${
                          isExcluded
                            ? "border-border text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                            : "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
                        }`}
                        title={
                          isExcluded
                            ? t.onboarding?.toggleInclude || "Bấm để bao gồm lại"
                            : t.onboarding?.toggleExclude || "Bấm để loại bỏ"
                        }
                      >
                        {isExcluded ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                      </button>
                    </div>

                    {agent.toolPermissions && agent.toolPermissions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5 pt-2 border-t border-border/50">
                        {agent.toolPermissions.map((p) => (
                          <span
                            key={p.toolId}
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-zinc-400"
                          >
                            <span className="text-zinc-200">{p.toolId}</span>
                            <span className="text-accent ml-1 font-semibold">· {p.permissionLevel}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep("intro")}
                className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-zinc-300 hover:bg-white/5 transition cursor-pointer"
              >
                {t.onboarding?.backBtn || "Quay lại"}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={selectedCount === 0}
                className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-black transition hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-accent/20 cursor-pointer"
              >
                {interpolate(t.onboarding?.confirmCreateBtn || "Xác nhận & Tạo ({count} agent)", {
                  count: selectedCount,
                })}
              </button>
            </div>
          </div>
        )}

        {step === "applying" && (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-panel p-12 text-center shadow-xl">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 border border-accent/30 text-accent">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-white">Deploying Organization</h3>
              <p className="text-sm text-zinc-400">
                {t.onboarding?.applying ||
                  "Đang khởi tạo phòng ban, tuyển dụng Agent và cấp quyền tool..."}
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 py-4 text-center text-xs text-zinc-600">
        AI-OPC — Autonomous One-Person Company Platform
      </footer>
    </div>
  );
}
