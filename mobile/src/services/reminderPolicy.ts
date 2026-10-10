import { Reminder } from "../types/reminder";
export function notificationDate(reminder: Reminder, now = Date.now()): Date | undefined {
  if (reminder.completed || reminder.triggerType !== "time") return;
  const moments = [reminder.deadline, reminder.snoozedUntil].filter((date): date is string => !!date).map(Date.parse);
  if (!moments.length || moments.some(value => !Number.isFinite(value))) return;
  const timestamp = Math.max(...moments);
  if (!Number.isFinite(timestamp) || timestamp <= now) return;
  if (reminder.lastNotifiedAt && Date.parse(reminder.lastNotifiedAt) >= timestamp) return;
  return new Date(timestamp);
}
export function mayNotify(reminder: Reminder, now = Date.now()) {
  return !reminder.completed && !(reminder.snoozedUntil && Date.parse(reminder.snoozedUntil) > now)
    && !(reminder.lastNotifiedAt && now - Date.parse(reminder.lastNotifiedAt) < 30 * 60000);
}
export const notificationId = (id: string) => `context-reminder-${id}`;
