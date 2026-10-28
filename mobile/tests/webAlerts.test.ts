import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dueNow } from "../src/services/format";
import { cancelReminderNotification, enableNotifications, notificationStatus, reconcileNotifications } from "../src/services/notifications";
import { Reminder } from "../src/types/reminder";

const at = "2026-10-28T12:00:00Z";
const reminder = (id: string, extra: Partial<Reminder> = {}): Reminder => ({ id, title: id, createdAt: at, triggerType: "time", completed: false, ...extra });
const minutes = (m: number) => new Date(Date.parse(at) + m * 60000).toISOString();

describe("due now", () => {
  it("lists reminders whose time just came, newest first, and leaves the rest alone", () => {
    const rows = [
      reminder("just-due", { deadline: minutes(-5) }), reminder("earlier", { deadline: minutes(-90) }),
      reminder("future", { deadline: minutes(30) }), reminder("long-ago", { deadline: minutes(-60 * 13) }),
      reminder("done", { deadline: minutes(-5), completed: true }), reminder("snoozed", { deadline: minutes(-5), snoozedUntil: minutes(5) }),
      reminder("snooze-over", { deadline: minutes(-30), snoozedUntil: minutes(-1) }), reminder("place", { triggerType: "location", location: { type: "category", category: "pharmacy" } }),
    ];
    expect(dueNow(rows, new Date(at)).map(r => r.id)).toEqual(["just-due", "snooze-over", "earlier"]);
  });
});

describe("browser alerts", () => {
  const shown: { title: string; body?: string }[] = [];
  class FakeNotification {
    static permission: NotificationPermission = "default";
    static requestPermission = vi.fn(async () => { FakeNotification.permission = "granted"; return "granted" as NotificationPermission; });
    onclick: (() => void) | null = null;
    constructor(title: string, options?: NotificationOptions) { shown.push({ title, body: options?.body }); }
    close() {}
  }
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(at)); shown.length = 0; FakeNotification.permission = "default"; vi.stubGlobal("window", { Notification: FakeNotification, focus: vi.fn() }); vi.stubGlobal("Notification", FakeNotification); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("asks once and reports the browser's answer", async () => {
    expect(await notificationStatus()).toBe("default");
    await enableNotifications();
    expect(await notificationStatus()).toBe("granted");
  });

  it("alerts when a reminder comes due and not for cancelled, done or past ones", async () => {
    FakeNotification.permission = "granted";
    await reconcileNotifications([reminder("Call Mom", { deadline: minutes(10) }), reminder("Cancelled", { deadline: minutes(10) }), reminder("Done", { deadline: minutes(10), completed: true }), reminder("Past", { deadline: minutes(-10) })]);
    await cancelReminderNotification("Cancelled");
    vi.advanceTimersByTime(9 * 60000); expect(shown).toEqual([]);
    vi.advanceTimersByTime(60000); expect(shown).toEqual([{ title: "Reminder", body: "Call Mom" }]);
  });

  it("reschedules when a reminder moves instead of alerting twice", async () => {
    FakeNotification.permission = "granted";
    await reconcileNotifications([reminder("Gym", { deadline: minutes(5) })]);
    await reconcileNotifications([reminder("Gym", { deadline: minutes(20) })]);
    vi.advanceTimersByTime(10 * 60000); expect(shown).toEqual([]);
    vi.advanceTimersByTime(10 * 60000); expect(shown.map(s => s.body)).toEqual(["Gym"]);
  });

  it("stays quiet without permission", async () => {
    FakeNotification.permission = "denied";
    await reconcileNotifications([reminder("Quiet", { deadline: minutes(1) })]);
    vi.advanceTimersByTime(2 * 60000); expect(shown).toEqual([]);
  });
});
