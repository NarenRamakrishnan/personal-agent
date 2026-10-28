import { describe, expect, it } from "vitest";
import { formatForField, parseHumanDate } from "../src/services/humanDate";

const now = new Date(2026, 9, 27, 14, 0); // Tue Oct 27 2026, 2:00 PM local
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min).getTime();
const at = (text: string) => { const r = parseHumanDate(text, now); if ("error" in r) throw new Error(`${text}: ${r.error}`); return r.date.getTime(); };

describe("parseHumanDate", () => {
  it.each([
    ["Oct 30, 2026 at 9:00 AM", local(2026, 9, 30, 9)],
    ["October 30 at 9am", local(2026, 9, 30, 9)],
    ["30 Oct 2:30 pm", local(2026, 9, 30, 14, 30)],
    ["oct 30", local(2026, 9, 30, 9)],
    ["tomorrow at 9", local(2026, 9, 28, 9)],
    ["tomorrow 3", local(2026, 9, 28, 15)],
    ["today at 6pm", local(2026, 9, 27, 18)],
    ["tonight", local(2026, 9, 27, 20)],
    ["friday at 9", local(2026, 9, 30, 9)],
    ["Fri 5:15 PM", local(2026, 9, 30, 17, 15)],
    ["tuesday at 9", local(2026, 10, 3, 9)],
    ["at noon", local(2026, 9, 28, 12)],
    ["6:30 pm", local(2026, 9, 27, 18, 30)],
    ["Jan 5 at 10am", local(2027, 0, 5, 10)],
    ["Dec 31, 2026 at 11:59 PM", local(2026, 11, 31, 23, 59)],
    // The ways people actually type dates and times into a box.
    ["10/30 3pm", local(2026, 9, 30, 15)],
    ["10/30", local(2026, 9, 30, 9)],
    ["11/3/2026 at 4:05 pm", local(2026, 10, 3, 16, 5)],
    ["1/5", local(2027, 0, 5, 9)],
    ["in 2 hours", now.getTime() + 2 * 3600000],
    ["in 30 minutes", now.getTime() + 30 * 60000],
    ["in 45 mins", now.getTime() + 45 * 60000],
    ["in an hour", now.getTime() + 3600000],
    ["in 3 days", now.getTime() + 3 * 86400000],
    ["9.30am tomorrow", local(2026, 9, 28, 9, 30)],
  ])("%s", (text, expected) => { expect(at(text)).toBe(expected); });

  it.each([
    ["", "Enter a date"],
    ["whenever", "Enter a date"],
    ["Feb 30 at 9am", "doesn't exist"],
    ["tomorrow at 25:00", "time doesn't look right"],
    ["tomorrow at 13pm", "time doesn't look right"],
    ["13/45", "doesn't exist"],
  ])("rejects %j", (text, message) => {
    const result = parseHumanDate(text, now);
    expect("error" in result && result.error).toMatch(message);
  });

  it("round-trips its own field format", () => {
    const iso = new Date(local(2026, 10, 3, 16, 5)).toISOString();
    expect(formatForField(iso)).toBe("Nov 3, 2026 at 4:05 PM");
    expect(at(formatForField(iso))).toBe(local(2026, 10, 3, 16, 5));
    expect(formatForField(new Date(local(2026, 10, 3, 0, 0)).toISOString())).toBe("Nov 3, 2026 at 12:00 AM");
  });
});
