import { Reminder } from "../types/reminder";
import { notificationDate } from "./reminderPolicy";

// Browser reminders: the Notification API while Heedly is open in a tab (even in the
// background). Home also shows anything due, so nothing depends on permission alone.
export type NotificationStatus = "granted" | "default" | "denied" | "unsupported";
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const supported = () => typeof window !== "undefined" && "Notification" in window;
const MAX_DELAY = 2 ** 31 - 1;

export async function notificationStatus(): Promise<NotificationStatus> {
  return supported() ? Notification.permission as NotificationStatus : "unsupported";
}

export async function enableNotifications() {
  if (!supported()) throw new Error("This browser can't show notifications. Heedly still shows due reminders at the top of the app.");
  if (await Notification.requestPermission() !== "granted") throw new Error("Notifications are blocked for this site. Allow them from the icon next to the address bar, then try again.");
}

export async function notificationTimingStatus() {
  const status = await notificationStatus();
  return status === "granted" ? "Browser notifications are on. They arrive while Heedly is open in a tab."
    : status === "denied" ? "Notifications are blocked for this site. Allow them from the icon next to the address bar."
    : status === "default" ? "Notifications are off. Turn them on above to get a heads-up when a reminder is due."
    : "This browser can't show notifications. Due reminders appear at the top of Heedly instead.";
}

export async function enableExactTimeAlerts() { throw new Error("Exact-time alerts are an Android setting."); }

function show(title: string, reminder: Reminder) {
  if (!supported() || Notification.permission !== "granted") return;
  const note = new Notification(title, { body: reminder.title, tag: `heedly-${reminder.id}`, icon: "/favicon.ico" });
  note.onclick = () => { window.focus(); note.close(); };
}

function schedule(key: string, at: Date, fire: () => void) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); fire(); }, Math.min(MAX_DELAY, Math.max(0, at.getTime() - Date.now()))));
}

export async function reconcileNotifications(reminders: Reminder[]) {
  for (const [key, timer] of timers) if (key.startsWith("time-")) { clearTimeout(timer); timers.delete(key); }
  for (const reminder of reminders) {
    const date = notificationDate(reminder);
    if (date) schedule(`time-${reminder.id}`, date, () => show("Reminder", reminder));
  }
}

export async function cancelReminderNotification(id: string) {
  for (const key of [`time-${id}`, `held-${id}`]) { clearTimeout(timers.get(key)); timers.delete(key); }
}
export async function notifyNow(reminder: Reminder) { show("Nearby reminder", reminder); }
export async function deferNotification(reminder: Reminder, until: string) {
  if (!Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.now()) throw new Error("Invalid quiet-hours end time.");
  schedule(`held-${reminder.id}`, new Date(until), () => show("Reminder held during quiet hours", reminder));
}
export async function cancelContextNotifications() {
  for (const [key, timer] of timers) if (key.startsWith("held-")) { clearTimeout(timer); timers.delete(key); }
}
export async function cancelAllNotifications() { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); }
export function listenForNotificationActions(_changed: () => void, _failure: (error: unknown) => void) { return () => {}; }
