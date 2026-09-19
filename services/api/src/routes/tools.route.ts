import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { logAudit } from "../modules/audit/auditLogger";
import type { RiskLevel } from "@ai-opc/shared";

export const toolsRouter = Router();

const createToolSchema = z.object({
  id: z
    .string()
    .trim()
    .min(2, "ID phải có ít nhất 2 ký tự")
    .regex(/^[a-z0-9_]+$/, "ID chỉ gồm chữ thường, số và dấu gạch dưới (vd: tool_crm_sync)"),
  name: z.string().trim().min(2, "Tên công cụ phải có ít nhất 2 ký tự"),
  description: z.string().trim().optional(),
  riskLevel: z.enum(["R0", "R1", "R2", "R3", "R4"]).default("R1"),
  requiresApproval: z.boolean().default(false),
});

const updateToolSchema = z.object({
  name: z.string().trim().min(2).optional(),
  description: z.string().trim().optional(),
  riskLevel: z.enum(["R0", "R1", "R2", "R3", "R4"]).optional(),
  requiresApproval: z.boolean().optional(),
});

// GET /api/tools — Lấy danh sách tất cả Tools
toolsRouter.get("/", async (_req, res) => {
  const tools = await db.tool.findMany({
    include: {
      _count: {
        select: { permissions: true },
      },
    },
    orderBy: { id: "asc" },
  });
  res.json(tools);
});

// GET /api/tools/:id — Lấy chi tiết 1 Tool
toolsRouter.get("/:id", async (req, res) => {
  const tool = await db.tool.findUnique({
    where: { id: req.params.id },
    include: {
      permissions: {
        include: { agent: true },
      },
    },
  });
  if (!tool) return res.status(404).json({ error: "Tool không tồn tại" });
  res.json(tool);
});

// POST /api/tools — Tạo Tool mới
toolsRouter.post("/", async (req, res) => {
  const parsed = createToolSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dữ liệu không hợp lệ",
      details: parsed.error.format(),
    });
  }

  const { id, name, description, riskLevel, requiresApproval } = parsed.data;

  const existing = await db.tool.findUnique({ where: { id } });
  if (existing) {
    return res.status(409).json({ error: `Tool với ID "${id}" đã tồn tại.` });
  }

  const tool = await db.tool.create({
    data: {
      id,
      name,
      description: description || null,
      riskLevel,
      requiresApproval,
    },
  });

  await logAudit({
    toolId: tool.id,
    action: "TOOL_CREATED",
    resultSummary: `Founder tạo Tool mới: ${tool.name} (${tool.id}) [risk ${tool.riskLevel}, requiresApproval=${tool.requiresApproval}]`,
    riskLevel: tool.riskLevel as RiskLevel,
  });

  res.status(201).json(tool);
});

// PATCH /api/tools/:id — Cập nhật Tool
toolsRouter.patch("/:id", async (req, res) => {
  const parsed = updateToolSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dữ liệu không hợp lệ",
      details: parsed.error.format(),
    });
  }

  const tool = await db.tool.findUnique({ where: { id: req.params.id } });
  if (!tool) return res.status(404).json({ error: "Tool không tồn tại" });

  const updated = await db.tool.update({
    where: { id: req.params.id },
    data: parsed.data,
  });

  await logAudit({
    toolId: updated.id,
    action: "TOOL_UPDATED",
    resultSummary: `Founder cập nhật cấu hình Tool: ${updated.name} (${updated.id})`,
    riskLevel: updated.riskLevel as RiskLevel,
  });

  res.json(updated);
});

// DELETE /api/tools/:id — Xóa Tool
toolsRouter.delete("/:id", async (req, res) => {
  const tool = await db.tool.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { permissions: true } } },
  });
  if (!tool) return res.status(404).json({ error: "Tool không tồn tại" });

  // Xóa các phân quyền liên quan trước
  await db.agentToolPermission.deleteMany({ where: { toolId: req.params.id } });
  await db.tool.delete({ where: { id: req.params.id } });

  await logAudit({
    toolId: req.params.id,
    action: "TOOL_DELETED",
    resultSummary: `Founder xóa Tool: ${tool.name} (${tool.id})`,
    riskLevel: tool.riskLevel as RiskLevel,
  });

  res.json({ status: "OK", message: `Đã xóa tool ${tool.name}` });
});
