import { Router } from "express";
import { listAuditLogs } from "../modules/audit/auditLogger";

export const auditLogsRouter = Router();

// Route này CHỈ có GET — không có PUT/PATCH/DELETE một cách cố ý (Rule 4 & 10).
auditLogsRouter.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const logs = await listAuditLogs(limit, offset);
  res.json(logs);
});
