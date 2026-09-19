import { Router } from "express";
import { parseFounderCommand, dispatchFounderCommand } from "../modules/commands/commandParser";

export const commandsRouter = Router();

commandsRouter.post("/", async (req, res) => {
  try {
    const { command } = req.body as { command?: string };
    if (!command) return res.status(400).json({ error: "Thiếu trường 'command'" });

    const parsed = parseFounderCommand(command);
    const result = await dispatchFounderCommand(parsed);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
