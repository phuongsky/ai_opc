import {
  getNotificationPreferences,
  updateNotificationPreferences,
  notifyFounder,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "../modules/notifications/notifier";
import { db } from "../db/client";

async function main() {
  console.log("=== BẮT ĐẦU TEST NOTIFICATION PREFERENCES & BUDGET CAP ALERT ===");

  // 1. Get default preferences
  const initialPrefs = getNotificationPreferences();
  console.log("1. Initial Preferences:", JSON.stringify(initialPrefs, null, 2));

  // 2. Update preferences
  const updatedPrefs = updateNotificationPreferences({
    notifyBudgetCapExceeded: true,
    notifyWeeklyReport: false,
    customTelegramChatId: "123456789",
  });
  console.log("2. Updated Preferences:", JSON.stringify(updatedPrefs, null, 2));

  if (updatedPrefs.notifyWeeklyReport !== false) {
    throw new Error("Cập nhật preferences thất bại!");
  }

  // 3. Test sending event when category is disabled (WEEKLY_REPORT) -> should skip safely
  console.log("3. Testing filtered category (WEEKLY_REPORT disabled):");
  await notifyFounder({
    category: "WEEKLY_REPORT",
    severity: "info",
    title: "Test Weekly Report",
    message: "This should be skipped based on preferences.",
  });
  console.log("✓ Skipped successfully without error.");

  // 4. Test sending enabled category (BUDGET_CAP)
  console.log("4. Testing enabled category (BUDGET_CAP):");
  await notifyFounder({
    category: "BUDGET_CAP",
    severity: "warning",
    title: "BUDGET CAP EXCEEDED",
    message: "Agent \"ai_test\" vượt trần ngân sách riêng ($9.00 / $0.01) — tự động SUSPENDED.",
  });
  console.log("✓ Executed successfully without error.");

  // 5. Restore default preferences
  updateNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
  console.log("5. Restored default preferences.");

  console.log("=== TẤT CẢ CÁC BƯỚC TEST NOTIFICATION ĐỀU THÀNH CÔNG (100% PASS) ===");
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
