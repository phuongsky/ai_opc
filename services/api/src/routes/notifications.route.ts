import { Router } from "express";
import {
  notifyFounder,
  isAnyChannelConfigured,
  getNotificationPreferences,
  updateNotificationPreferences,
  getNotificationChannelsHealth,
} from "../modules/notifications/notifier";
import { isTelegramConfigured } from "../modules/notifications/telegram";
import { isEmailConfigured } from "../modules/notifications/email";
import { isZaloConfigured, getZaloChannelStatus } from "../modules/notifications/zalo";

export const notificationsRouter = Router();

notificationsRouter.get("/status", (_req, res) => {
  res.json({
    telegram: isTelegramConfigured(),
    email: isEmailConfigured(),
    zalo: isZaloConfigured(),
    zaloDetails: getZaloChannelStatus(),
    channelsHealth: getNotificationChannelsHealth(),
    anyConfigured: isAnyChannelConfigured(),
  });
});

notificationsRouter.get("/preferences", (_req, res) => {
  const prefs = getNotificationPreferences();
  res.json(prefs);
});

notificationsRouter.put("/preferences", (req, res) => {
  const updated = updateNotificationPreferences(req.body);
  res.json(updated);
});

notificationsRouter.post("/test", async (req, res) => {
  if (!isAnyChannelConfigured()) {
    return res.status(400).json({ error: "Chưa cấu hình kênh nào (Telegram/Zalo Auth/Email) trong hệ thống." });
  }

  const { title, message, category, severity } = req.body || {};

  const result = await notifyFounder({
    category: category || "SYSTEM",
    title: title || "Test thông báo AI-OPC",
    message: message || "Nếu bạn nhận được tin này, hệ thống thông báo đa kênh đã hoạt động hoàn hảo! 🚀",
    severity: severity || "info",
  });

  if (!result.success) {
    return res.status(504).json({
      error: result.summary,
      deliveredChannel: null,
      summary: result.summary,
      logs: result.logs,
    });
  }

  res.json({
    status: "OK",
    deliveredChannel: result.deliveredChannel,
    summary: result.summary,
    logs: result.logs,
  });
});

