import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { reminderApi } from "../api/client";
import { Reminder } from "../types/reminder";
import { notificationDate, notificationId, mayNotify } from "./reminderPolicy";
import { exactAlarmsAllowed, requestExactAlarms } from "./alarmPermission";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fingerprint, loadHeld, saveHeld, reserveCooldown, releaseCooldown } from "./heldNotifications";
const heldId = (id: string) => `context-quiet-${id}`;

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
function serialize<T>(action: () => Promise<T>): Promise<T> {
  const work = reconciliation.then(action);
  reconciliation = work.then(() => {}, () => {}); return work;
}
export function reconcileNotifications(reminders: Reminder[]) {
  return serialize(() => reconcile(reminders));
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
  const wanted = new Map<string, { reminder: Reminder; date: Date; held?: boolean }>(reminders.flatMap(reminder => {
    const date = notificationDate(reminder);
    return date ? [[notificationId(reminder.id), { reminder, date }] as const] : [];
  }));
  const held = await loadHeld();
  const locationEnabled = await AsyncStorage.getItem("context-assistant:location-enabled") === "true";
  for (const [id, entry] of Object.entries(held)) {
    const reminder = reminders.find(row => row.id === id); const date = new Date(entry.until);
    if (locationEnabled && reminder && mayNotify(reminder) && fingerprint(reminder) === entry.fingerprint && date.getTime() > Date.now()) {
      wanted.set(heldId(id), { reminder, date, held: true });
    } else { await releaseCooldown(id, entry.until); delete held[id]; }
  }
  await saveHeld(held);
  for (const existing of scheduled) {
    if (!existing.identifier.startsWith("context-reminder-") && !existing.identifier.startsWith("context-quiet-")) continue;
    const expected = wanted.get(existing.identifier);
    if (!expected || existing.content.data.fireAt !== expected.date.toISOString() || existing.content.body !== expected.reminder.title) await Notifications.cancelScheduledNotificationAsync(existing.identifier);
    else wanted.delete(existing.identifier);
  }
  for (const [identifier, { reminder, date, held }] of wanted) await Notifications.scheduleNotificationAsync({ identifier,
    content: { title: held ? "Reminder held during quiet hours" : "Reminder", body: reminder.title, categoryIdentifier: "reminder", sound: "default", data: { reminderId: reminder.id, fireAt: date.toISOString() } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: "reminders" },
  });
}
async function cancelHeld(id: string) {
  await Notifications.cancelScheduledNotificationAsync(heldId(id));
  const held = await loadHeld(); const entry = held[id];
  if (entry) { await releaseCooldown(id, entry.until); delete held[id]; await saveHeld(held); }
}
export function cancelReminderNotification(id: string) { return serialize(async () => { await Notifications.cancelScheduledNotificationAsync(notificationId(id)); await cancelHeld(id); }); }
export function cancelContextNotifications() { return serialize(async () => { for (const id of Object.keys(await loadHeld())) await cancelHeld(id); }); }
export function cancelAllNotifications() { return serialize(async () => {
  for (const item of await Notifications.getAllScheduledNotificationsAsync()) if (item.identifier.startsWith("context-reminder-") || item.identifier.startsWith("context-quiet-")) await Notifications.cancelScheduledNotificationAsync(item.identifier);
  for (const id of Object.keys(await loadHeld())) await cancelHeld(id);
}); }
export function deferNotification(reminder: Reminder, until: string) { return serialize(async () => {
  if (!Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.now()) throw new Error("Invalid quiet-hours end time.");
  if (!(await Notifications.getPermissionsAsync()).granted) throw new Error("Enable notifications before receiving context reminders.");
  if (await AsyncStorage.getItem("context-assistant:location-enabled") !== "true") return;
  await Notifications.scheduleNotificationAsync({ identifier: heldId(reminder.id), content: { title: "Reminder held during quiet hours", body: reminder.title, categoryIdentifier: "reminder", sound: "default", data: { reminderId: reminder.id, fireAt: new Date(until).toISOString() } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(until), channelId: "reminders" } });
  const held = await loadHeld(); held[reminder.id] = { until, fingerprint: fingerprint(reminder) }; await saveHeld(held);
  await reserveCooldown(reminder.id, until);
  if (!await exactAlarmsAllowed()) throw new Error("Quiet-hours reminder scheduled approximately; allow exact-time alerts for precise timing.");
}); }
export function notifyNow(reminder: Reminder) { return serialize(async () => {
  if (!(await Notifications.getPermissionsAsync()).granted) throw new Error("Enable notifications before receiving context reminders.");
  await cancelHeld(reminder.id);
  await Notifications.scheduleNotificationAsync({ content: { title: "Nearby reminder", body: reminder.title, categoryIdentifier: "reminder", sound: "default", data: { reminderId: reminder.id } }, trigger: null });
}); }
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
