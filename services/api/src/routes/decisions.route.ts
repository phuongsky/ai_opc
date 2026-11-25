import { Router } from "express";
import { db } from "../db/client";
import { requireTotpForHighRisk } from "../middleware/requireTotpForHighRisk";
import { approveDecision, rejectDecision } from "../modules/decisions/decisionService";
import { rbacService } from "../modules/rbac/rbacService";
import type { AuthedRequest } from "../middleware/requireAuth";

export const decisionsRouter = Router();

decisionsRouter.get("/", async (req: AuthedRequest, res) => {
  const status = (req.query.status as string) || undefined;
  const where: any = status ? { status } : {};

  const role = await rbacService.getUserRole(req);
  if (role !== "founder") {
    const allowedAgentIds = await rbacService.getAllowedAgentIdsForRole(role);
    where.OR = [
      { agentId: { in: allowedAgentIds } },
      { agentId: null },
    ];
  }

  const decisions = await db.decisionPackage.findMany({
    where,
    orderBy: { id: "desc" },
  });
  res.json(decisions);
});

decisionsRouter.post("/:id/approve", requireTotpForHighRisk, async (req: AuthedRequest, res) => {
  try {
    const role = await rbacService.getUserRole(req);
    if (role !== "founder" && role !== "manager") {
      return res.status(403).json({ error: "Chỉ Founder hoặc Manager mới có quyền phê duyệt quyết định." });
    }
    const result = await approveDecision(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

decisionsRouter.post("/:id/reject", async (req: AuthedRequest, res) => {
  try {
    const role = await rbacService.getUserRole(req);
    if (role !== "founder" && role !== "manager") {
      return res.status(403).json({ error: "Chỉ Founder hoặc Manager mới có quyền từ chối quyết định." });
    }
    const result = await rejectDecision(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

