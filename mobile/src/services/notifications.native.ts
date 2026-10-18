import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { reminderApi } from "../api/client";
import { Reminder } from "../types/reminder";
import { notificationDate, notificationId } from "./reminderPolicy";
import { exactAlarmsAllowed, requestExactAlarms } from "./alarmPermission";

export async function notificationTimingStatus() {
  return await exactAlarmsAllowed() ? "Exact-time scheduling is allowed. Delivery still depends on your device settings." : "Exact-time scheduling is disabled. Android may delay reminders. Allow Alarms & reminders in system settings.";
}
export async function enableExactTimeAlerts() { await requestExactAlarms(); }

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
export async function enableNotifications() {
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("reminders", { name: "Reminders", importance: Notifications.AndroidImportance.HIGH });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Notifications were denied. Enable them in device settings to receive reminders.");
  await Notifications.setNotificationCategoryAsync("reminder", [
    { identifier: "complete", buttonTitle: "Complete", options: { opensAppToForeground: true } },
    { identifier: "snooze", buttonTitle: "Snooze 10 min", options: { opensAppToForeground: true } },
  ]);
}
let reconciliation = Promise.resolve();
export function reconcileNotifications(reminders: Reminder[]) {
  const work = reconciliation.then(() => reconcile(reminders));
  reconciliation = work.catch(() => {});
  return work;
}
async function reconcile(reminders: Reminder[]) {
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  if (reminders.some(reminder => notificationDate(reminder)) && !await exactAlarmsAllowed()) {
    // Keep best-effort scheduling available; surface the limitation rather than
    // silently promising an exact deadline. Callers can open the explicit settings flow.
    await reconcileSchedules(reminders);
    throw new Error("Reminders are scheduled approximately. Allow exact-time alerts in Alarms & reminders settings.");
  }
  await reconcileSchedules(reminders);
}
async function reconcileSchedules(reminders: Reminder[]) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const wanted = new Map(reminders.flatMap(reminder => {
    const date = notificationDate(reminder);
    return date ? [[notificationId(reminder.id), { reminder, date }] as const] : [];
  }));
  for (const existing of scheduled) {
    if (!existing.identifier.startsWith("context-reminder-")) continue;
    const expected = wanted.get(existing.identifier);
    if (!expected || existing.content.data.fireAt !== expected.date.toISOString() || existing.content.body !== expected.reminder.title) await Notifications.cancelScheduledNotificationAsync(existing.identifier);
    else wanted.delete(existing.identifier);
  }
  for (const [identifier, { reminder, date }] of wanted) await Notifications.scheduleNotificationAsync({ identifier,
    content: { title: "Reminder", body: reminder.title, categoryIdentifier: "reminder", sound: "default", data: { reminderId: reminder.id, fireAt: date.toISOString() } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: "reminders" },
  });
}
export async function cancelReminderNotification(id: string) { await Notifications.cancelScheduledNotificationAsync(notificationId(id)); }
export async function cancelAllNotifications() {
  for (const item of await Notifications.getAllScheduledNotificationsAsync()) if (item.identifier.startsWith("context-reminder-")) await Notifications.cancelScheduledNotificationAsync(item.identifier);
}
export async function notifyNow(reminder: Reminder) {
  if (!(await Notifications.getPermissionsAsync()).granted) throw new Error("Enable notifications before receiving context reminders.");
  await Notifications.scheduleNotificationAsync({ content: { title: "Nearby reminder", body: reminder.title, categoryIdentifier: "reminder", sound: "default", data: { reminderId: reminder.id } }, trigger: null });
}
export function listenForNotificationActions(changed: () => void, failure: (error: unknown) => void) {
  let active = true;
  async function handle(response: Notifications.NotificationResponse) {
    const id = response.notification.request.content.data.reminderId;
    if (typeof id !== "string" || !["complete", "snooze"].includes(response.actionIdentifier)) return;
    try {
      await reminderApi.update(id, response.actionIdentifier === "complete" ? { completed: true } : { snoozedUntil: new Date(Date.now() + 600000).toISOString() });
      await reconcileNotifications(await reminderApi.list());
      await Notifications.clearLastNotificationResponseAsync();
      if (active) changed();
    } catch (e) { if (active) failure(e); }
  }
  const listener = Notifications.addNotificationResponseReceivedListener(response => { void handle(response); });
  void Notifications.getLastNotificationResponseAsync().then(response => { if (response && active) void handle(response); }).catch(failure);
  return () => { active = false; listener.remove(); };
}
