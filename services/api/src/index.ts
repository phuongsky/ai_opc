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
import { startTelegramInboundPolling } from "./modules/notifications/telegramInbound";
import { startZaloInboundListener } from "./modules/notifications/zaloInbound";
import { startZaloBotInboundPolling } from "./modules/notifications/zaloBotInbound";
import { syncLlmConfigFromDb } from "./lib/llm/resolveProvider";
import { initSystemLogger } from "./modules/systemLogs/systemLogger";
import { initZaloQrBridge } from "./modules/auth/zaloQrBridge";
import { freePortIfOccupied } from "./lib/portManager";
import { ensureFounderAccount } from "./db/bootstrapFounder";
import { selfHealDatabase } from "./db/selfHealDb";

import path from "path";

// Khởi tạo interceptor bắt log console ngay từ đầu
initSystemLogger();

const app = express();

const isAllowedCorsOrigin = (origin?: string): boolean => {
  if (!origin) return true; // Cho phép requests từ desktop app native, curl, mobile không kèm Origin header
  if (origin === env.corsOrigin) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(origin)) return true;
  if (/^(https?|tauri|asset|app):\/\/(tauri\.)?localhost(:[0-9]+)?$/.test(origin)) return true;
  return true; // Cho phép toàn bộ client nội bộ kết nối tới Core Engine API
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedCorsOrigin(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-TOTP-Code"],
  })
);
app.options("*", cors());
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) =>
  res.json({ status: "ok", dbProvider: env.dbProvider })
);

// Public route tải file báo cáo đã xuất
app.use("/api/reports/download", express.static(path.resolve(process.cwd(), "exports")));
app.use("/exports", express.static(path.resolve(process.cwd(), "exports")));

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
initZaloQrBridge(httpServer);

// Đăng ký driver thật cho từng tool TRƯỚC khi nhận request đầu tiên.
registerAllToolDrivers();
console.log("[bootstrap] Tool drivers đã đăng ký.");

let retryCount = 0;
const MAX_PORT_RETRIES = 3;

let servicesStarted = false;

function startServer(port: number) {
  httpServer.removeAllListeners("error");

  httpServer.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[AI-OPC Core] Cảnh báo: Cổng ${port} đang bị chiếm dụng (EADDRINUSE).`);

      if (retryCount < MAX_PORT_RETRIES) {
        retryCount++;
        console.log(`[AI-OPC Core] Đang tự động giải phóng cổng ${port} (Thử lần ${retryCount}/${MAX_PORT_RETRIES})...`);
        freePortIfOccupied(port);
        setTimeout(() => {
          try {
            httpServer.close();
          } catch {}
          startServer(port);
        }, 1000);
      } else {
        console.error(`🚨 [AI-OPC Core] Không thể giải phóng cổng ${port} sau ${MAX_PORT_RETRIES} lần thử.`);
        console.error(`👉 Gợi ý: Chạy lệnh sau trong PowerShell để tắt tiến trình chiếm cổng:`);
        console.error(`   Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force`);
        process.exit(1);
      }
    } else {
      console.error("[AI-OPC Core] Lỗi máy chủ HTTP:", err);
      process.exit(1);
    }
  });

  httpServer.listen(port, "0.0.0.0", async () => {
    console.log(
      `[AI-OPC Core] Listening on 0.0.0.0:${port} (db: ${env.dbProvider}) — WS at /ws`
    );
    try {
      await selfHealDatabase();
    } catch {}
    try {
      await syncLlmConfigFromDb();
      console.log("[bootstrap] Cấu hình AI Gateway đã đồng bộ từ Database.");
    } catch (e) {
      console.warn("[bootstrap] Lỗi đồng bộ AI Gateway từ DB:", e);
    }
    ensureFounderAccount().then((f) => {
      console.log(`[bootstrap] Đã xác nhận tài khoản Founder: ${f.email}`);
    }).catch((err) => {
      console.warn("[bootstrap] Cảnh báo khởi tạo Founder:", err.message);
    });
    // Bắt đầu vòng lặp Agent Worker SAU khi server đã sẵn sàng nhận WebSocket
    // client, để các sự kiện TASK_UPDATED/AGENT_STATUS đầu tiên không bị rớt.
    if (!servicesStarted) {
      servicesStarted = true;
      startAgentWorker();
      startMonthlyCostResetCron();
      startPeriodicJobs(env.periodicJobsIntervalMs);
      startTelegramInboundPolling(env.telegramPollMs);
      startZaloInboundListener();
      startZaloBotInboundPolling(env.zaloPollMs);
    }
  });
}

startServer(env.port);


