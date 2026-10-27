// Reads the date people type into the reminder form: "Oct 30 at 9am", "tomorrow at 9",
// "friday 2:30 pm", "October 30, 2026 at 9:00 AM". No date-picker dependency needed.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

type Time = { hour: number; minute: number };

function readTime(text: string): Time | null | undefined {
  if (/\bnoon\b/.test(text)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b/.test(text)) return { hour: 0, minute: 0 };
  const match = text.match(/(?:\bat\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\s|$)/g);
  // The time is the last number group that isn't a day of the month next to a month name.
  const candidates = (match ?? []).map(m => m.trim()).filter(m => /(:|am|pm|a\.m|p\.m|^at\s)/i.test(m) || !/[a-z]/i.test(text.replace(m, "")));
  const raw = candidates.pop();
  if (!raw) return undefined;
  const parts = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i)!;
  let hour = Number(parts[1]); const minute = Number(parts[2] ?? 0);
  const meridiem = parts[3]?.[0].toLowerCase();
  if (minute > 59 || hour > 23 || (meridiem && (hour === 0 || hour > 12))) return null;
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  // "at 3" means 3 PM; "at 9" means 9 AM. People rarely mean 3 AM.
  if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
  return { hour, minute };
}

export type HumanDateResult = { date: Date } | { error: string };

export function parseHumanDate(input: string, now = new Date()): HumanDateResult {
  const text = input.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!text) return { error: "Enter a date and time, like Oct 30 at 9:00 AM." };
  const date = new Date(now); date.setSeconds(0, 0);
  let dayFound = false; let timeText = text;

  const relative = text.match(/\b(today|tonight|tomorrow)\b/);
  const weekday = text.match(/\b(next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
  // A day number never runs into a time: "oct 2:30 pm" is not October 2.
  const dayFirst = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?\b/);
  const monthFirstRaw = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?![:\d]|\s*[ap]\.?m)(?:\s+(\d{4}))?\b/);
  const monthFirst = dayFirst && monthFirstRaw && (dayFirst.index ?? 0) < (monthFirstRaw.index ?? 0) ? null : monthFirstRaw;

  if (relative) {
    if (relative[1] === "tomorrow") date.setDate(date.getDate() + 1);
    dayFound = true; timeText = text.replace(relative[0], " ");
    if (relative[1] === "tonight" && readTime(timeText) === undefined) { date.setHours(20, 0); return { date }; }
  } else if (monthFirst || dayFirst) {
    const m = monthFirst ? MONTHS.indexOf(monthFirst[1]) : MONTHS.indexOf(dayFirst![2]);
    const d = Number(monthFirst ? monthFirst[2] : dayFirst![1]);
    const y = monthFirst?.[3] ?? dayFirst?.[3];
    date.setFullYear(y ? Number(y) : now.getFullYear(), m, d);
    if (date.getMonth() !== m || date.getDate() !== d) return { error: "That date doesn't exist. Check the day and month." };
    dayFound = true; timeText = text.replace((monthFirst ?? dayFirst)![0], " ");
    if (!y) { const probe = new Date(date); probe.setHours(23, 59); if (probe < now) date.setFullYear(date.getFullYear() + 1); }
  } else if (weekday) {
    const target = DAYS.indexOf(weekday[2]);
    let add = (target - now.getDay() + 7) % 7;
    if (weekday[1] && add === 0) add = 7; // "next tuesday" said on a Tuesday
    date.setDate(date.getDate() + add);
    dayFound = true; timeText = text.replace(weekday[0], " ");
  }

  const time = readTime(timeText);
  if (time === null) return { error: "That time doesn't look right. Try something like 9:00 AM." };
  if (!dayFound && !time) return { error: "Enter a date and time, like Oct 30 at 9:00 AM." };
  date.setHours(time?.hour ?? 9, time?.minute ?? 0, 0, 0);
  // A bare weekday or time that already passed today means the next one.
  if (!relative && !monthFirst && !dayFirst && date <= now) date.setDate(date.getDate() + (weekday ? 7 : 1));
  return { date };
}

// The field's own format, so a saved date reads back the way people type it.
export function formatForField(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hour = d.getHours() % 12 || 12;
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${hour}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

export function timezoneLabel(d = new Date()): string {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  return `${zone} (UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")})`;
}
