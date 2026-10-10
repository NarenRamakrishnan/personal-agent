import { Reminder } from "../types/reminder";
export function notificationDate(reminder: Reminder, now = Date.now()): Date | undefined {
  if (reminder.completed || reminder.triggerType !== "time") return;
  const deadline = reminder.snoozedUntil ?? reminder.deadline;
  if (!deadline) return;
  const timestamp = Date.parse(deadline);
  if (!Number.isFinite(timestamp) || timestamp <= now) return;
  return new Date(timestamp);
}
export function mayNotify(reminder: Reminder, now = Date.now()) {
  return !reminder.completed && !(reminder.snoozedUntil && Date.parse(reminder.snoozedUntil) > now)
    && !(reminder.lastNotifiedAt && now - Date.parse(reminder.lastNotifiedAt) < 30 * 60000);
}
export const notificationId = (id: string) => `context-reminder-${id}`;
