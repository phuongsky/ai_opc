import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { env } from "./config/env";
import { initWebSocketGateway } from "./ws/gateway";
import { requireAuth } from "./middleware/requireAuth";
import { authRouter } from "./routes/auth.route";
import { commandsRouter } from "./routes/commands.route";
import { decisionsRouter } from "./routes/decisions.route";
import { agentsRouter } from "./routes/agents.route";
import { tasksRouter } from "./routes/tasks.route";
import { auditLogsRouter } from "./routes/auditLogs.route";
import { knowledgeRouter } from "./routes/knowledge.route";
import { settingsRouter } from "./routes/settings.route";
import { notificationsRouter } from "./routes/notifications.route";
import { toolsRouter } from "./routes/tools.route";
import { departmentsRouter } from "./routes/departments.route";
import { onboardingRouter } from "./routes/onboarding.route";
import { registerAllToolDrivers } from "./modules/agents/toolDrivers";
import { startAgentWorker } from "./modules/agents/agentWorker";
import { startMonthlyCostResetCron } from "./modules/cost/monthlyCostResetCron";
import { startPeriodicJobs } from "./modules/notifications/periodicJobs";
import { syncLlmConfigFromDb } from "./lib/llm/resolveProvider";

const app = express();
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-TOTP-Code"],
  })
);
app.options("*", cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) =>
  res.json({ status: "ok", dbProvider: env.dbProvider })
);

// /api/auth & /api/zalo không qua requireAuth
app.use("/api/auth", authRouter);
app.use("/api/zalo", authRouter);

// Mọi route nghiệp vụ yêu cầu JWT
app.use("/api/commands",      requireAuth, commandsRouter);
app.use("/api/decisions",     requireAuth, decisionsRouter);
app.use("/api/agents",        requireAuth, agentsRouter);
app.use("/api/departments",   requireAuth, departmentsRouter);
app.use("/api/tasks",         requireAuth, tasksRouter);
app.use("/api/tools",         requireAuth, toolsRouter);
app.use("/api/audit-logs",    requireAuth, auditLogsRouter);
app.use("/api/knowledge",     requireAuth, knowledgeRouter);
app.use("/api/settings",      requireAuth, settingsRouter);
app.use("/api/notifications", requireAuth, notificationsRouter);
app.use("/api/onboarding",    requireAuth, onboardingRouter);

const httpServer = createServer(app);
initWebSocketGateway(httpServer);

// Đăng ký driver thật cho từng tool TRƯỚC khi nhận request đầu tiên.
registerAllToolDrivers();
console.log("[bootstrap] Tool drivers đã đăng ký.");

httpServer.listen(env.port, () => {
  console.log(
    `[AI-OPC Core] Listening on :${env.port} (db: ${env.dbProvider}) — WS at /ws`
  );
  syncLlmConfigFromDb().then(() => {
    console.log("[bootstrap] Cấu hình AI Gateway đã đồng bộ từ Database.");
  });
  // Bắt đầu vòng lặp Agent Worker SAU khi server đã sẵn sàng nhận WebSocket
  // client, để các sự kiện TASK_UPDATED/AGENT_STATUS đầu tiên không bị rớt.
  startAgentWorker();
  startMonthlyCostResetCron();
  startPeriodicJobs(env.periodicJobsIntervalMs);
});
