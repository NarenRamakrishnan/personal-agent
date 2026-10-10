import { describe, expect, it } from "vitest";
import { mayNotify, notificationDate } from "../src/services/reminderPolicy";
import { distanceMeters, mapPlaces, osmCategories } from "../src/services/places";
import { Reminder } from "../src/types/reminder";
const now = Date.parse("2026-10-10T12:00:00Z");
const reminder: Reminder = { id: "a", title: "Call Mom", createdAt: "2026-10-10T12:00:00Z", deadline: "2026-10-10T12:05:00Z", triggerType: "time", completed: false };
describe("notification policy", () => {
  it("schedules the exact deadline", () => expect(notificationDate(reminder, now)?.toISOString()).toBe("2026-10-10T12:05:00.000Z"));
  it("uses snooze instead of original deadline", () => expect(notificationDate({ ...reminder, snoozedUntil: "2026-10-10T13:00:00Z" }, now)?.toISOString()).toBe("2026-10-10T13:00:00.000Z"));
  it("expired snooze does not hide a later deadline", () => expect(notificationDate({ ...reminder, snoozedUntil: "2026-10-10T11:00:00Z" }, now)?.toISOString()).toBe("2026-10-10T12:05:00.000Z"));
  it("an earlier active snooze does not fire before the requested deadline", () => expect(notificationDate({ ...reminder, snoozedUntil: "2026-10-10T12:01:00Z" }, now)?.toISOString()).toBe("2026-10-10T12:05:00.000Z"));
  it("does not replay a counting moment already notified", () => expect(notificationDate({ ...reminder, lastNotifiedAt: "2026-10-10T12:05:00Z" }, now)).toBeUndefined());
  it.each([{ completed: true }, { triggerType: "location" as const }, { triggerType: "time_and_location" as const }, { deadline: "not a date" }, { deadline: "2026-10-09T12:00:00Z" }])("does not schedule invalid, completed or contextual reminder %j", changes => expect(notificationDate({ ...reminder, ...changes }, now)).toBeUndefined());
  it("enforces completion, snooze and 30-minute cooldown", () => {
    expect(mayNotify({ ...reminder, completed: true }, now)).toBe(false);
    expect(mayNotify({ ...reminder, snoozedUntil: "2026-10-10T13:00:00Z" }, now)).toBe(false);
    expect(mayNotify({ ...reminder, lastNotifiedAt: "2026-10-10T11:50:00Z" }, now)).toBe(false);
    expect(mayNotify({ ...reminder, lastNotifiedAt: "2026-10-10T11:00:00Z" }, now)).toBe(true);
  });
});
describe("provider/backend taxonomy boundary", () => {
  it.each([[{ shop: "supermarket" }, "grocery_store"], [{ amenity: "pharmacy" }, "pharmacy"], [{ leisure: "fitness_centre" }, "gym"], [{ amenity: "fast_food" }, "restaurant"], [{ amenity: "cafe" }, "coffee_shop"], [{ amenity: "college" }, "university"], [{ shop: "mall" }, "shopping"]])("maps %j to %s", (tags, category) => expect(osmCategories(tags as Record<string, string>)).toContain(category));
  it("measures distance and rejects objects without coordinates", () => {
    expect(distanceMeters(47, -122, 47, -122)).toBe(0);
    expect(distanceMeters(0, 0, 0, 1)).toBeCloseTo(111194.9, 0);
    expect(mapPlaces([{ id: 1, tags: { shop: "supermarket" } }, { id: 2, center: { lat: 47, lon: -122 }, tags: { amenity: "cafe", name: "Coffee" } }], 47, -122)).toEqual([{ name: "Coffee", types: ["coffee_shop"], latitude: 47, longitude: -122, distanceMeters: 0 }]);
  });
});
