import { beforeEach, expect, it, vi } from "vitest";
const notifications = vi.hoisted(() => ({
  setNotificationHandler: vi.fn(), getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getAllScheduledNotificationsAsync: vi.fn(async (): Promise<any[]> => []), cancelScheduledNotificationAsync: vi.fn(async () => {}), scheduleNotificationAsync: vi.fn(async () => "id"),
  SchedulableTriggerInputTypes: { DATE: "date" },
}));
vi.mock("expo-notifications", () => notifications);
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("../src/api/client", () => ({ reminderApi: {} }));
vi.mock("../src/services/alarmPermission", () => ({ exactAlarmsAllowed: vi.fn(async () => true), requestExactAlarms: vi.fn() }));
import { exactAlarmsAllowed } from "../src/services/alarmPermission";
import { reconcileNotifications } from "../src/services/notifications.native";
import { Reminder } from "../src/types/reminder";
const date = new Date(Date.now() + 86400000).toISOString();
const row: Reminder = { id: "test", title: "Call Mom", createdAt: new Date().toISOString(), deadline: date, triggerType: "time", completed: false };
beforeEach(() => { vi.clearAllMocks(); notifications.getPermissionsAsync.mockResolvedValue({ granted: true }); notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]); });
it("schedules using stable IDs and does not duplicate unchanged schedules", async () => {
  await reconcileNotifications([row]); expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ identifier: "context-reminder-test" }));
  notifications.getAllScheduledNotificationsAsync.mockResolvedValue([{ identifier: "context-reminder-test", content: { body: row.title, data: { fireAt: date } } }]);
  notifications.scheduleNotificationAsync.mockClear(); await reconcileNotifications([row]); expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});
it("cancels completed/deleted schedules without touching unrelated notifications", async () => {
  notifications.getAllScheduledNotificationsAsync.mockResolvedValue([{ identifier: "context-reminder-test", content: { data: {} } }, { identifier: "unrelated", content: { data: {} } }]);
  await reconcileNotifications([{ ...row, completed: true }]); expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1); expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("context-reminder-test");
});
it("replaces a deadline when snoozed", async () => {
  notifications.getAllScheduledNotificationsAsync.mockResolvedValue([{ identifier: "context-reminder-test", content: { body: row.title, data: { fireAt: date } } }]);
  const snoozedUntil = new Date(Date.parse(date) + 600000).toISOString(); await reconcileNotifications([{ ...row, snoozedUntil }]);
  expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("context-reminder-test"); expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ data: expect.objectContaining({ fireAt: snoozedUntil }) }) }));
});
it("does not schedule when permission is denied", async () => {
  notifications.getPermissionsAsync.mockResolvedValue({ granted: false }); await reconcileNotifications([row]); expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});
it("warns but retains best-effort reminders if exact alarms are denied", async () => {
  vi.mocked(exactAlarmsAllowed).mockResolvedValueOnce(false);
  await expect(reconcileNotifications([row])).rejects.toThrow("approximately"); expect(notifications.scheduleNotificationAsync).toHaveBeenCalled();
});
