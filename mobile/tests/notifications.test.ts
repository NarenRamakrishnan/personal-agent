import { beforeEach, expect, it, vi } from "vitest";
const notifications = vi.hoisted(() => ({
  setNotificationHandler: vi.fn(), getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getAllScheduledNotificationsAsync: vi.fn(async (): Promise<any[]> => []), cancelScheduledNotificationAsync: vi.fn(async () => {}), scheduleNotificationAsync: vi.fn(async () => "id"),
  SchedulableTriggerInputTypes: { DATE: "date" },
}));
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: async (key: string) => storage.get(key) ?? null, setItem: async (key: string, value: string) => { storage.set(key, value); } } }));
vi.mock("expo-notifications", () => notifications);
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("../src/api/client", () => ({ reminderApi: {} }));
vi.mock("../src/services/alarmPermission", () => ({ exactAlarmsAllowed: vi.fn(async () => true), requestExactAlarms: vi.fn() }));
import { exactAlarmsAllowed } from "../src/services/alarmPermission";
import { reconcileNotifications, deferNotification, cancelContextNotifications } from "../src/services/notifications.native";
import { Reminder } from "../src/types/reminder";
const date = new Date(Date.now() + 86400000).toISOString();
const row: Reminder = { id: "test", title: "Call Mom", createdAt: new Date().toISOString(), deadline: date, triggerType: "time", completed: false };
beforeEach(() => { vi.clearAllMocks(); storage.clear(); storage.set("context-assistant:location-enabled", "true"); vi.mocked(exactAlarmsAllowed).mockResolvedValue(true); notifications.getPermissionsAsync.mockResolvedValue({ granted: true }); notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]); });
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
it("persists quiet-hours delivery and reserves its cooldown", async () => { await deferNotification({ ...row, triggerType: "location" }, date); expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ identifier: "context-quiet-test", trigger: expect.objectContaining({ date: new Date(date) }) })); expect(JSON.parse(storage.get("context-notification-ledger")!)).toMatchObject({ test: Date.parse(date) }); });
it.each(["completed", "edited", "disabled", "deleted", "snoozed"])("cancels quiet-hours delivery when %s", async reason => {
  const reminder = { ...row, triggerType: "location" as const }; await deferNotification(reminder, date);
  notifications.getAllScheduledNotificationsAsync.mockResolvedValue([{ identifier: "context-quiet-test", content: { body: row.title, data: { fireAt: date } } }]);
  if (reason === "disabled") storage.set("context-assistant:location-enabled", "false");
  await reconcileNotifications(reason === "deleted" ? [] : [{ ...reminder, ...(reason === "completed" ? { completed: true } : reason === "edited" ? { title: "Edited" } : reason === "snoozed" ? { snoozedUntil: date } : {}) }]);
  expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("context-quiet-test"); expect(JSON.parse(storage.get("context-notification-ledger")!)).toEqual({});
});
it("explicit location opt-out cancels held deliveries immediately", async () => { await deferNotification({ ...row, triggerType: "location" }, date); await cancelContextNotifications(); expect(JSON.parse(storage.get("context-assistant:held-notifications")!)).toEqual({}); });
it("keeps an unchanged persisted quiet-hours schedule without duplicates", async () => {
  const reminder = { ...row, triggerType: "location" as const }; await deferNotification(reminder, date);
  notifications.scheduleNotificationAsync.mockClear(); notifications.getAllScheduledNotificationsAsync.mockResolvedValue([{ identifier: "context-quiet-test", content: { body: row.title, data: { fireAt: date } } }]);
  await reconcileNotifications([reminder]); expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled(); expect(notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
});
it("does not schedule held notifications after opt-out or for an invalid date", async () => {
  storage.set("context-assistant:location-enabled", "false"); await deferNotification({ ...row, triggerType: "location" }, date); expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  await expect(deferNotification(row, "bad-date")).rejects.toThrow("Invalid quiet-hours");
});
