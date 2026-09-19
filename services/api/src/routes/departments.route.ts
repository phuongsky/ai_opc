import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { logAudit } from "../modules/audit/auditLogger";

export const departmentsRouter = Router();

const createDepartmentSchema = z.object({
  id: z
    .string()
    .trim()
    .min(2, "Mã phòng ban phải có ít nhất 2 ký tự")
    .regex(/^[a-z0-9_-]+$/i, "Mã phòng ban chỉ gồm chữ, số, gạch dưới hoặc gạch ngang (vd: dept_growth)"),
  name: z.string().trim().min(2, "Tên phòng ban phải có ít nhất 2 ký tự"),
  managerAgentId: z.string().trim().optional().nullable(),
});

const updateDepartmentSchema = z.object({
  name: z.string().trim().min(2, "Tên phòng ban phải có ít nhất 2 ký tự").optional(),
  managerAgentId: z.string().trim().optional().nullable(),
});

// GET /api/departments — Lấy danh sách tất cả phòng ban
departmentsRouter.get("/", async (_req, res) => {
  const departments = await db.department.findMany({
    include: {
      _count: {
        select: { agents: true },
      },
      agents: {
        select: {
          id: true,
          name: true,
          title: true,
          status: true,
          active: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });
  res.json(departments);
});

// POST /api/departments — Tạo phòng ban mới
departmentsRouter.post("/", async (req, res) => {
  const parsed = createDepartmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dữ liệu phòng ban không hợp lệ",
      details: parsed.error.format(),
    });
  }

  const { id, name, managerAgentId } = parsed.data;

  const existing = await db.department.findUnique({ where: { id } });
  if (existing) {
    return res.status(409).json({ error: `Phòng ban với mã "${id}" đã tồn tại.` });
  }

  const department = await db.department.create({
    data: {
      id,
      name,
      managerAgentId: managerAgentId || null,
    },
  });

  await logAudit({
    action: "DEPARTMENT_CREATED",
    resultSummary: `Founder tạo phòng ban mới: ${department.name} (${department.id})`,
    riskLevel: "R1",
  });

  res.status(201).json(department);
});

// PATCH /api/departments/:id — Cập nhật phòng ban
departmentsRouter.patch("/:id", async (req, res) => {
  const parsed = updateDepartmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dữ liệu cập nhật không hợp lệ",
      details: parsed.error.format(),
    });
  }

  const department = await db.department.findUnique({ where: { id: req.params.id } });
  if (!department) return res.status(404).json({ error: "Phòng ban không tồn tại" });

  const updated = await db.department.update({
    where: { id: req.params.id },
    data: parsed.data,
  });

  await logAudit({
    action: "DEPARTMENT_UPDATED",
    resultSummary: `Founder cập nhật thông tin phòng ban: ${updated.name} (${updated.id})`,
    riskLevel: "R1",
  });

  res.json(updated);
});
