import { describe, expect, it } from "vitest";
import { groupReminders, isOverdue, linkedReminders, memoryTitle, memoryUse, missingInfo, repeatText, triggerText, whenText, whereText } from "../src/services/format";
import { Reminder } from "../src/types/reminder";

const now = new Date(2026, 9, 27, 14, 0); // Tue Oct 27 2026, 2 PM local
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();
const r = (id: string, extra: Partial<Reminder> = {}): Reminder => ({ id, title: id, createdAt: at(26, 9), triggerType: "time", completed: false, ...extra });

describe("whenText", () => {
  it("names today, tomorrow and yesterday", () => {
    expect(whenText(at(27, 17), now)).toMatch(/^Today, 5:00/);
    expect(whenText(at(28, 9), now)).toMatch(/^Tomorrow, 9:00/);
    expect(whenText(at(26, 9), now)).toMatch(/^Yesterday, 9:00/);
  });
  it("uses a short date further out and the year only when it differs", () => {
    // Device locale decides "Oct 30" vs "30 Oct", so check the parts.
    expect(whenText(at(30, 14), now)).toMatch(/Oct/);
    expect(whenText(at(30, 14), now)).toMatch(/\b30\b/);
    expect(whenText(at(30, 14), now)).not.toMatch(/2026/);
    expect(whenText(new Date(2027, 0, 5, 9).toISOString(), now)).toMatch(/2027/);
  });
  it("returns nothing for a bad date", () => { expect(whenText("not a date", now)).toBe(""); });
});

describe("whereText and triggerText", () => {
  it("reads categories, saved places and named places like a person would", () => {
    expect(whereText({ type: "category", category: "grocery_store" })).toBe("near a grocery store");
    expect(whereText({ type: "category", category: "bike_shop" })).toBe("near bike shop");
    expect(whereText({ type: "saved_place", name: "home" })).toBe("at Home");
    expect(whereText({ type: "place", name: "Target" })).toBe("at Target");
  });
  it("combines time and place, or falls back to one of them", () => {
    expect(triggerText(r("a", { deadline: at(28, 9), location: { type: "place", name: "UPS" } }), now)).toMatch(/^Tomorrow, 9:00.* · at UPS$/);
    expect(triggerText(r("b", { location: { type: "category", category: "pharmacy" } }), now)).toBe("When you're near a pharmacy");
    expect(triggerText(r("c"), now)).toBe("No time or place");
  });
});

describe("groupReminders", () => {
  it("puts overdue and due-today under today, later under upcoming, place-only under place", () => {
    const groups = groupReminders([
      r("later", { deadline: at(29, 9) }), r("tonight", { deadline: at(27, 20) }), r("overdue", { deadline: at(26, 9) }),
      r("milk", { location: { type: "category", category: "grocery_store" }, triggerType: "location" }), r("done", { completed: true, deadline: at(27, 9) }),
    ], now);
    expect(groups.today.map(x => x.id)).toEqual(["overdue", "tonight"]);
    expect(groups.upcoming.map(x => x.id)).toEqual(["later"]);
    expect(groups.place.map(x => x.id)).toEqual(["milk"]);
    expect(groups.done.map(x => x.id)).toEqual(["done"]);
  });
  it("keeps reminders with no time and no place apart from place reminders, so they can be fixed", () => {
    const groups = groupReminders([r("bread"), r("milk", { location: { type: "category", category: "grocery_store" }, triggerType: "location" })], now);
    expect(groups.needs.map(x => x.id)).toEqual(["bread"]);
    expect(groups.place.map(x => x.id)).toEqual(["milk"]);
  });
  it("flags overdue only for open reminders", () => {
    expect(isOverdue(r("x", { deadline: at(26, 9) }), now)).toBe(true);
    expect(isOverdue(r("y", { deadline: at(26, 9), completed: true }), now)).toBe(false);
  });
});

describe("missingInfo", () => {
  it("flags a reminder with neither a time nor a place", () => {
    expect(missingInfo(r("take call"))?.kind).toBe("both");
  });
  it("flags a missing time or a missing place for the trigger it has", () => {
    expect(missingInfo(r("a", { triggerType: "time_and_location", location: { type: "place", name: "UPS" } }))?.kind).toBe("time");
    expect(missingInfo(r("b", { triggerType: "time_and_location", deadline: at(28, 9) }))?.kind).toBe("place");
  });
  it("asks where a saved place is only when the saved list is known and lacks it", () => {
    const home = r("c", { triggerType: "location", location: { type: "saved_place", name: "home" } });
    expect(missingInfo(home)).toBeUndefined();
    expect(missingInfo(home, ["work"])).toMatchObject({ kind: "unknown_place", label: "Where is Home?" });
    expect(missingInfo(home, ["home"])).toBeUndefined();
  });
  it("leaves complete and finished reminders alone", () => {
    expect(missingInfo(r("d", { deadline: at(28, 9) }))).toBeUndefined();
    expect(missingInfo(r("e", { triggerType: "location", location: { type: "category", category: "pharmacy" } }))).toBeUndefined();
    expect(missingInfo(r("f", { completed: true }))).toBeUndefined();
  });
});

describe("memory and repeats", () => {
  const at = "2026-10-28T12:00:00Z";
  const mom = { id: "m1", kind: "person" as const, label: "Mom", alias: "Priya", email: "priya@example.com", createdAt: at, updatedAt: at };
  const tj = { id: "m2", kind: "place" as const, label: "groceries", placeName: "Trader Joe's", placeType: "place" as const, createdAt: at, updatedAt: at };
  const r = (id: string, title: string, extra: object = {}) => ({ id, title, createdAt: at, triggerType: "time" as const, completed: false, ...extra });

  it("reads a fact the way a person would say it", () => {
    expect(memoryTitle(mom)).toBe("Mom is Priya");
    expect(memoryUse(mom)).toBe("Emails to Mom go to priya@example.com.");
    expect(memoryTitle(tj)).toBe("Groceries at Trader Joe's");
    expect(memoryTitle({ ...tj, label: "laundry", placeName: "home", placeType: "saved_place" })).toBe("Laundry at Home");
  });

  it("links a fact to the reminders it's about, by whole words", () => {
    const reminders = [r("a", "Call Mom"), r("b", "Text Priya happy birthday"), r("c", "Buy milk", { location: { type: "place", name: "Trader Joe's" } }), r("d", "Momentum workout")];
    expect(linkedReminders(mom, reminders).map(x => x.id)).toEqual(["a", "b"]);
    expect(linkedReminders(tj, reminders).map(x => x.id)).toEqual(["c"]);
  });

  it("says when a reminder repeats", () => {
    expect(triggerText(r("t", "Trash", { deadline: "2026-11-02T13:00:00Z", repeat: "weekly" }), new Date(at))).toMatch(/ · Repeats weekly$/);
    expect(repeatText({})).toBe("");
  });
});
