import { Reminder, ReminderLocation } from "../types/reminder";

const CATEGORY_NAMES: Record<string, string> = {
  grocery_store: "a grocery store", pharmacy: "a pharmacy", gym: "the gym", restaurant: "a restaurant",
  coffee_shop: "a coffee shop", university: "campus", shopping: "the shops", post_office: "a post office",
  gas_station: "a gas station", bank: "a bank", hardware_store: "a hardware store",
};

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// "Today, 5:00 PM", "Tomorrow, 9:00 AM", "Fri, Oct 30, 2:00 PM"
export function whenText(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `Today, ${time(d)}`;
  if (sameDay(d, tomorrow)) return `Tomorrow, ${time(d)}`;
  if (sameDay(d, yesterday)) return `Yesterday, ${time(d)}`;
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
  return `${day}, ${time(d)}`;
}

// "near a grocery store", "at Home", "at Target"
export function whereText(location?: ReminderLocation): string {
  if (!location) return "";
  if (location.type === "category") {
    const key = location.category ?? "";
    return `near ${CATEGORY_NAMES[key] ?? key.replaceAll("_", " ")}`;
  }
  const name = location.name ?? "";
  if (location.type === "saved_place") return `at ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  return name ? `at ${name}` : "at a saved spot";
}

export function triggerText(reminder: Reminder, now = new Date()): string {
  const when = reminder.deadline ? whenText(reminder.deadline, now) : "";
  const where = whereText(reminder.location);
  if (when && where) return `${when} · ${where}`;
  return when || (where ? `When you're ${where}` : "No time or place");
}

export const isOverdue = (reminder: Reminder, now = new Date()) =>
  !reminder.completed && !!reminder.deadline && new Date(reminder.deadline).getTime() < now.getTime();

export type ReminderGroups = { today: Reminder[]; upcoming: Reminder[]; place: Reminder[]; done: Reminder[] };

// Today = overdue or due before midnight. A place-only reminder lives under "At a place".
export function groupReminders(reminders: Reminder[], now = new Date()): ReminderGroups {
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  const groups: ReminderGroups = { today: [], upcoming: [], place: [], done: [] };
  for (const reminder of reminders) {
    if (reminder.completed) groups.done.push(reminder);
    else if (!reminder.deadline) groups.place.push(reminder);
    else if (new Date(reminder.deadline).getTime() <= endOfDay.getTime()) groups.today.push(reminder);
    else groups.upcoming.push(reminder);
  }
  const byDeadline = (a: Reminder, b: Reminder) => Date.parse(a.deadline ?? "") - Date.parse(b.deadline ?? "");
  groups.today.sort(byDeadline); groups.upcoming.sort(byDeadline);
  groups.place.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  groups.done.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return groups;
}

export type Missing = { kind: "time" | "place" | "both" | "unknown_place"; label: string; hint: string };

// What a reminder still needs before it can ever fire. `savedPlaces` (lowercase names)
// enables the "where is home?" check; leave it out when the list isn't loaded.
export function missingInfo(reminder: Reminder, savedPlaces?: string[]): Missing | undefined {
  if (reminder.completed) return undefined;
  const wantsTime = reminder.triggerType !== "location";
  const wantsPlace = reminder.triggerType !== "time";
  if (!reminder.deadline && !reminder.location) return { kind: "both", label: "Needs a time or place", hint: "Heedly needs a time or a place to remind you." };
  if (wantsTime && !reminder.deadline) return { kind: "time", label: "Needs a time", hint: "Add when you want to be reminded." };
  if (wantsPlace && !reminder.location) return { kind: "place", label: "Needs a place", hint: "Add where you want to be reminded." };
  const name = reminder.location?.type === "saved_place" ? (reminder.location.name ?? "").toLowerCase() : "";
  if (name && savedPlaces && !savedPlaces.includes(name)) {
    const pretty = name.charAt(0).toUpperCase() + name.slice(1);
    return { kind: "unknown_place", label: `Where is ${pretty}?`, hint: `Heedly doesn't know where ${pretty} is yet. Save it once and this reminder can fire there.` };
  }
  return undefined;
}

// Reminders whose time has just come (in the last 12 hours), for the "Due now" banner.
// Older ones stay in the list marked overdue; snoozed ones wait until the snooze ends.
export function dueNow(reminders: Reminder[], now = new Date()): Reminder[] {
  const recent = now.getTime() - 12 * 3600000;
  return reminders.filter(reminder => {
    if (reminder.completed || !reminder.deadline || reminder.triggerType === "location") return false;
    const at = Math.max(Date.parse(reminder.deadline), reminder.snoozedUntil ? Date.parse(reminder.snoozedUntil) : 0);
    return Number.isFinite(at) && at <= now.getTime() && at >= recent;
  }).sort((a, b) => Date.parse(b.deadline!) - Date.parse(a.deadline!));
}
