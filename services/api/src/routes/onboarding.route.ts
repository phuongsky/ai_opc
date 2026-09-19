import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../db/client";
import { logAudit } from "../modules/audit/auditLogger";
import { generateOnboardingPlan, ensureAiCoo, type RiskTolerance } from "../modules/onboarding/onboardingPlanner";

export const onboardingRouter = Router();

const VALID_PERMISSION_LEVELS = new Set(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);

/** Founder đã có agent nào ngoài AI-COO chưa — dùng để quyết định có redirect tới Wizard hay không. */
onboardingRouter.get("/status", async (_req, res) => {
  const nonCooCount = await db.agent.count({ where: { id: { not: "ai_coo" }, active: true } });
  res.json({ needsOnboarding: nonCooCount === 0 });
});

/** Bước 1: LLM đề xuất cơ cấu — KHÔNG ghi DB, chỉ trả về để Founder xem trước. */
onboardingRouter.post("/generate-plan", async (req, res) => {
  const { companyDescription, riskTolerance } = req.body as {
    companyDescription?: string;
    riskTolerance?: RiskTolerance;
  };
  if (!companyDescription?.trim()) {
    return res.status(400).json({ error: "Thiếu companyDescription" });
  }

  try {
    const plan = await generateOnboardingPlan(companyDescription.trim(), riskTolerance ?? "balanced");
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Bước 2: Founder đã xem/lọc plan ở UI, giờ mới thực sự tạo Department +
 * Agent + Permission Matrix. Cho phép `agents` rỗng (Founder bấm "Bỏ qua, tự
 * thiết lập thủ công") — khi đó chỉ đảm bảo AI-COO tồn tại rồi trả về.
 */
onboardingRouter.post("/apply-plan", async (req, res) => {
  const { departments, agents } = req.body as {
    departments?: string[];
    agents?: {
      name: string;
      title: string;
      departmentName?: string | null;
      mission: string;
      autonomyLevel?: number;
      toolPermissions?: { toolId: string; permissionLevel: string }[];
    }[];
  };

  await ensureAiCoo();

  const agentDrafts = agents ?? [];
  if (agentDrafts.length === 0) {
    await logAudit({ action: "ONBOARDING_SKIPPED", resultSummary: "Founder bỏ qua Wizard, tự thiết lập thủ công" });
    return res.json({ status: "OK", agentsCreated: 0, departmentsCreated: 0 });
  }

  // Tạo phòng ban — idempotent theo tên (không phân biệt hoa/thường), tránh
  // tạo trùng nếu Founder gọi Wizard nhiều lần hoặc đã có phòng ban sẵn.
  const deptNameToId = new Map<string, string>();
  const existingDepts: Array<{ id: string; name: string }> = await db.department.findMany();
  for (const d of existingDepts) deptNameToId.set(d.name.toLowerCase(), d.id);

  const allDeptNames = new Set<string>([
    ...(departments ?? []),
    ...agentDrafts.map((a) => a.departmentName).filter((n): n is string => !!n),
  ]);

  let departmentsCreated = 0;
  for (const name of allDeptNames) {
    const key = name.toLowerCase();
    if (!deptNameToId.has(key)) {
      const id = `dept_${randomUUID()}`;
      await db.department.create({ data: { id, name } });
      deptNameToId.set(key, id);
      departmentsCreated += 1;
    }
  }

  // Validate lại tool id thật có trong registry — phòng trường hợp payload bị
  // chỉnh sửa thủ công trước khi gửi lên (không tin tưởng mù quáng dữ liệu client).
  const validTools: Array<{ id: string; name: string }> = await db.tool.findMany();
  const validToolIds = new Set(validTools.map((t) => t.id));

  const createdAgents = [];
  for (const draft of agentDrafts) {
    if (!draft.name?.trim() || !draft.title?.trim() || !draft.mission?.trim()) continue;

    const id = `agent_${randomUUID()}`;
    const departmentId = draft.departmentName ? deptNameToId.get(draft.departmentName.toLowerCase()) ?? null : null;

    const agent = await db.agent.create({
      data: {
        id,
        name: draft.name.trim(),
        title: draft.title.trim(),
        departmentId,
        reportsTo: "ai_coo",
        mission: draft.mission.trim(),
        autonomyLevel: Math.min(5, Math.max(0, draft.autonomyLevel ?? 1)),
        status: "READY",
      },
    });

    const validPermissions = (draft.toolPermissions ?? []).filter(
      (p) => validToolIds.has(p.toolId) && VALID_PERMISSION_LEVELS.has(p.permissionLevel)
    );
    if (validPermissions.length > 0) {
      await db.agentToolPermission.createMany({
        data: validPermissions.map((p) => ({ agentId: id, toolId: p.toolId, permissionLevel: p.permissionLevel })),
        skipDuplicates: true,
      });
    }

    createdAgents.push(agent);
  }

  await logAudit({
    action: "ONBOARDING_COMPLETED",
    resultSummary: `Founder hoàn tất Onboarding Wizard — tạo ${createdAgents.length} agent, ${departmentsCreated} phòng ban mới`,
  });

  res.json({ status: "OK", agentsCreated: createdAgents.length, departmentsCreated });
});
