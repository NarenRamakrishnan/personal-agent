import { beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
} }));
import { createReminderApi, mockParse } from "../src/api/client";
import { Reminder } from "../src/types/reminder";
const row: Reminder = { id: "test", title: "Buy milk", createdAt: "2026-10-10T12:00:00Z", triggerType: "time", completed: false };
beforeEach(() => { storage.clear(); vi.unstubAllGlobals(); });
describe("persistent mock reminder workflow", () => {
  it("keeps creations, completion, snooze and deletion across client recreation", async () => {
    const client = createReminderApi(true);
    await client.create(row); await client.update(row.id, { completed: true, snoozedUntil: "2026-10-11T09:00:00Z" });
    expect((await createReminderApi(true).list()).find(r => r.id === row.id)).toMatchObject({ completed: true, snoozedUntil: "2026-10-11T09:00:00Z" });
    await client.remove(row.id); expect((await createReminderApi(true).list()).some(r => r.id === row.id)).toBe(false);
  });
  it("does not lose concurrent mutations", async () => {
    const client = createReminderApi(true);
    await Promise.all([client.create(row), client.create({ ...row, id: "two" })]);
    expect((await client.list()).filter(r => ["test", "two"].includes(r.id))).toHaveLength(2);
  });
  it("does not resurrect seeds after deleting all reminders", async () => {
    const client = createReminderApi(true); for (const r of await client.list()) await client.remove(r.id);
    expect(await createReminderApi(true).list()).toEqual([]);
  });
});
describe("backend wire requests", () => {
  it("includes timezone/time and keeps additional parsed reminders", async () => {
    const parsed = { intent: "create_reminder", title: "Call Mom", triggerType: "time", additional: [{ title: "Call Dad", triggerType: "time" }] };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(parsed))); vi.stubGlobal("fetch", fetcher);
    expect((await createReminderApi(false).parse("Call Mom and Dad")).additional).toHaveLength(1);
    const [url, options] = fetcher.mock.calls[0]; expect(url).toContain("/parse");
    expect(JSON.parse(options.body)).toMatchObject({ text: "Call Mom and Dad", timezone: expect.any(String), now: expect.stringMatching(/Z$/) });
  });
  it("does not fall back to fake data when the backend rejects input", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "No reminder found" }), { status: 422 })));
    await expect(createReminderApi(false).parse("hello")).rejects.toThrow("No reminder found");
  });
  it("sends save, complete and delete methods and handles 204", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(row))).mockResolvedValueOnce(new Response(JSON.stringify({ ...row, completed: true }))).mockResolvedValueOnce(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetcher);
    const client = createReminderApi(false); await client.create(row); await client.update(row.id, { completed: true }); await client.remove(row.id);
    expect(fetcher.mock.calls.map(([, options]) => options.method)).toEqual(["POST", "PATCH", "DELETE"]);
  });
  it("paginates beyond 200 reminders", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ ...row, id: `${i}` }))))).mockResolvedValueOnce(new Response(JSON.stringify([{ ...row, id: "last" }]))); vi.stubGlobal("fetch", fetcher);
    expect(await createReminderApi(false).list()).toHaveLength(201); expect(fetcher.mock.calls[1][0]).toContain("offset=200");
  });
  it("rejects malformed parser responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: "", triggerType: "nonsense" }))));
    await expect(createReminderApi(false).parse("x")).rejects.toThrow("invalid reminder");
  });
});
describe("demo parsing", () => {
  it("uses the requested minutes rather than a hardcoded deadline", () => {
    const now = new Date("2026-10-10T12:00:00Z"); expect(mockParse("Remind me in five minutes to call Mom", now).deadline).toBe("2026-10-10T12:05:00.000Z");
  });
  it("preserves category and combined trigger", () => { expect(mockParse("Remind me to buy eggs when I'm at a grocery store tonight")).toMatchObject({ title: "buy eggs", triggerType: "time_and_location", location: { type: "category", category: "grocery_store" } }); });
  it("recognizes saved home", () => { expect(mockParse("Remind me to bring my charger when I get home").location).toEqual({ type: "saved_place", name: "home" }); });
  it("rejects empty input", () => expect(() => mockParse("  ")).toThrow("Enter a reminder"));
});
