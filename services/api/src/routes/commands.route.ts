import { Router } from "express";
import { parseFounderCommand, dispatchFounderCommand } from "../modules/commands/commandParser";
import { rbacService } from "../modules/rbac/rbacService";
import type { AuthedRequest } from "../middleware/requireAuth";

export const commandsRouter = Router();

commandsRouter.post("/", async (req, res) => {
  try {
    const { command } = req.body as { command?: string };
    if (!command) return res.status(400).json({ error: "Thiếu trường 'command'" });

    const role = await rbacService.getUserRole(req as AuthedRequest);
    const allowed = rbacService.canRoleExecuteCommand(role, command);
    if (!allowed) {
      return res.status(403).json({
        error: `Tài khoản với vai trò '${role}' không có quyền thực thi lệnh '${command.trim()}'. Vui lòng liên hệ Founder để được cấp quyền trong RBAC Matrix.`,
        code: "RBAC_FORBIDDEN_COMMAND",
        role,
        command: command.trim(),
      });
    }

    const parsed = parseFounderCommand(command);
    const result = await dispatchFounderCommand(parsed);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
