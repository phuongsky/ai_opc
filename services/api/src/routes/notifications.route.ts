import { Router } from "express";
import {
  notifyFounder,
  isAnyChannelConfigured,
  getNotificationPreferences,
  updateNotificationPreferences,
  resetNotificationPreferences,
  getNotificationChannelsHealth,
  sendFarewellToChannel,
} from "../modules/notifications/notifier";
import { isTelegramConfigured } from "../modules/notifications/telegram";
import { isEmailConfigured } from "../modules/notifications/email";
import { isZaloConfigured, getZaloChannelStatus, clearZaloApiCache } from "../modules/notifications/zalo";
import { isZaloBotConfigured } from "../modules/notifications/zaloBot";
import { clearAllZaloSessions } from "../modules/auth/zaloAuthService";
import { logAudit } from "../modules/audit/auditLogger";
import {
  stopTelegramInboundPolling,
  restartTelegramInboundPolling,
} from "../modules/notifications/telegramInbound";
import {
  stopZaloBotInboundPolling,
  restartZaloBotInboundPolling,
} from "../modules/notifications/zaloBotInbound";
import { stopZaloInboundListener } from "../modules/notifications/zaloInbound";

export const notificationsRouter = Router();

notificationsRouter.get("/status", (_req, res) => {
  const prefs = getNotificationPreferences();
  res.json({
    telegram: isTelegramConfigured(prefs.customTelegramChatId, prefs.customTelegramRecipients, prefs.customTelegramToken),
    email: isEmailConfigured(prefs),
    zalo: isZaloConfigured(prefs.customZaloPhone, prefs.customZaloGroupId, prefs.customZaloRecipients),
    zaloBot: isZaloBotConfigured(prefs.customZaloBotChatId, prefs.customZaloBotRecipients, prefs.customZaloBotToken),
    zaloDetails: getZaloChannelStatus(prefs.customZaloPhone, prefs.customZaloGroupId, prefs.customZaloRecipients),
    channelsHealth: getNotificationChannelsHealth(),
    anyConfigured: isAnyChannelConfigured(),
  });
});

notificationsRouter.get("/preferences", (_req, res) => {
  const prefs = getNotificationPreferences();
  res.json(prefs);
});

/**
 * PUT /preferences — lưu cấu hình mới.
 *
 * So sánh prefs cũ vs mới để quyết định:
 *   - Kênh vừa bị TẮT (true → false):
 *       • Với Telegram → dừng polling inbound
 *       • Với ZaloBot  → dừng polling inbound
 *       • Với Zalo / Email → không có inbound listener, chỉ skip gửi
 *   - Kênh vừa được BẬT LẠI (false → true):
 *       • Với Telegram → khởi động lại polling
 *       • Với ZaloBot  → khởi động lại polling
 *   - Hoặc Token/Chat ID Telegram/Zalo Bot thay đổi → khởi động lại polling để nhận token mới
 */
notificationsRouter.put("/preferences", (req, res) => {
  try {
    const oldPrefs = getNotificationPreferences();
    const updated = updateNotificationPreferences(req.body);

    // --- Quản lý Telegram inbound listener ---
    const telegramWasOn = Boolean(oldPrefs.sendToTelegram);
    const telegramNowOn = Boolean(updated.sendToTelegram);
    const telegramTokenChanged = oldPrefs.customTelegramToken !== updated.customTelegramToken;
    if (telegramWasOn && !telegramNowOn) {
      stopTelegramInboundPolling();
    } else if ((!telegramWasOn && telegramNowOn) || (telegramNowOn && telegramTokenChanged)) {
      restartTelegramInboundPolling();
    }

    // --- Quản lý ZaloBot inbound listener ---
    const zaloBotWasOn = Boolean(oldPrefs.sendToZaloBot);
    const zaloBotNowOn = Boolean(updated.sendToZaloBot);
    const zaloBotTokenChanged = oldPrefs.customZaloBotToken !== updated.customZaloBotToken;
    if (zaloBotWasOn && !zaloBotNowOn) {
      stopZaloBotInboundPolling();
    } else if ((!zaloBotWasOn && zaloBotNowOn) || (zaloBotNowOn && zaloBotTokenChanged)) {
      restartZaloBotInboundPolling();
    }

    res.json(updated);
  } catch (err: any) {
    console.error("[notificationsRouter] Lỗi khi lưu preferences:", err);
    res.status(500).json({ error: err.message || "Lỗi lưu cấu hình thông báo" });
  }
});

/**
 * POST /reset — Đặt lại toàn bộ kênh tiếp nhận & thông báo Founder về mặc định:
 *   1. Dừng các inbound listener (Telegram, ZaloBot, Zalo 2-way).
 *   2. Xóa sạch phiên Zalo Auth (zalo_session.json trên đĩa + RAM maps).
 *   3. Xóa sạch cache Zalo API client & cache danh tính SĐT/UID.
 *   4. Ghi đè file notification_preferences.json về DEFAULT_NOTIFICATION_PREFERENCES (xóa bot token, chat ID, recipient lists).
 *   5. Ghi Audit log và trả về trạng thái mới sạch hoàn toàn.
 */
notificationsRouter.post("/reset", async (_req, res) => {
  try {
    // 1. Dừng tất cả inbound listener
    stopTelegramInboundPolling();
    stopZaloBotInboundPolling();
    stopZaloInboundListener();

    // 2. Xóa toàn bộ phiên Zalo Auth trên đĩa & RAM
    clearAllZaloSessions();
    clearZaloApiCache();

    // 3. Reset file notification_preferences.json
    const resetPrefs = resetNotificationPreferences();

    // 4. Ghi audit log
    await logAudit({
      action: "NOTIFICATIONS_RESET",
      resultSummary: "Founder đặt lại toàn bộ kênh thông báo: Đã xóa sạch session Zalo Auth, token Bot và đưa về cấu hình mặc định ban đầu.",
    });

    // 5. Trả về cấu hình và trạng thái kênh mới sạch
    res.json({
      ok: true,
      message: "Đã đặt lại toàn bộ cấu hình thông báo và xóa sạch token/session thành công.",
      preferences: resetPrefs,
      status: {
        telegram: isTelegramConfigured(resetPrefs.customTelegramChatId, resetPrefs.customTelegramRecipients, resetPrefs.customTelegramToken),
        email: isEmailConfigured(resetPrefs),
        zalo: isZaloConfigured(resetPrefs.customZaloPhone, resetPrefs.customZaloGroupId, resetPrefs.customZaloRecipients),
        zaloBot: isZaloBotConfigured(resetPrefs.customZaloBotChatId, resetPrefs.customZaloBotRecipients, resetPrefs.customZaloBotToken),
        zaloDetails: getZaloChannelStatus(resetPrefs.customZaloPhone, resetPrefs.customZaloGroupId, resetPrefs.customZaloRecipients),
        channelsHealth: getNotificationChannelsHealth(),
        anyConfigured: isAnyChannelConfigured(),
      },
    });
  } catch (err: any) {
    console.error("[notificationsRouter] Lỗi khi reset cấu hình thông báo:", err);
    res.status(500).json({ error: err.message || "Lỗi khi reset cấu hình thông báo" });
  }
});

/**
 * POST /farewell — Gửi một tin nhắn tạm biệt tới một kênh cụ thể ngay lập tức.
 *
 * Body: { channelId: "telegram" | "zalo" | "zaloBot" | "email" }
 *
 * Được gọi từ Settings UI ngay khi người dùng bấm tắt toggle kênh (trước khi Lưu),
 * để kênh đó nhận được thông báo "Admin đã tắt kênh này" TRƯỚC khi thực sự bị disable.
 * Lỗi gửi không ảnh hưởng đến luồng lưu cấu hình (always 200 OK).
 */
notificationsRouter.post("/farewell", async (req, res) => {
  const { channelId } = req.body as { channelId?: string };

  const validChannels = ["telegram", "zalo", "zaloBot", "email"] as const;
  type ValidChannel = (typeof validChannels)[number];

  if (!channelId || !validChannels.includes(channelId as ValidChannel)) {
    return res.status(400).json({ error: "channelId không hợp lệ. Phải là: telegram, zalo, zaloBot, email" });
  }

  const prefs = getNotificationPreferences();
  // Gửi bất đồng bộ — không block response
  void sendFarewellToChannel(channelId as ValidChannel, prefs);

  res.json({ ok: true, channel: channelId });
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
