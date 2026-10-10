import { describe, expect, it, vi } from "vitest";
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { setItem: vi.fn() } }));
import { reminderApi, contextApi, request } from "../src/api/client";
import { actionsApi, privacyApi } from "../src/api/actions";
describe.skipIf(process.env.PERSON2_ISOLATED_DB !== "true")("mobile client → unchanged real backend (isolated database)", () => {
  it("parses, saves, snoozes, completes and deletes a real reminder", async () => {
    const parsed = await reminderApi.parse("Remind me to buy milk tomorrow at 5");
    expect(parsed.title.toLowerCase()).toContain("milk"); expect(parsed.deadline).toBeTruthy();
    const { intent, additional, ...fields } = parsed;
    const reminder = await reminderApi.create({ ...fields, id: "person2-smoke", createdAt: new Date().toISOString(), completed: false });
    expect((await reminderApi.list()).some(r => r.id === reminder.id)).toBe(true);
    expect((await reminderApi.update(reminder.id, { snoozedUntil: "2030-01-01T09:00:00Z" })).snoozedUntil).toContain("2030");
    expect((await reminderApi.update(reminder.id, { completed: true })).completed).toBe(true);
    await reminderApi.remove(reminder.id); expect(await reminderApi.list()).toEqual([]);
  });
  it("saves a place and evaluates saved-location and provider category reminders", async () => {
    const home = await contextApi.savePlace({ name: "home", latitude: 47, longitude: -122, radiusMeters: 150 });
    expect(await contextApi.savedPlaces()).toContainEqual(home);
    const base = { id: "context-smoke", createdAt: new Date().toISOString(), completed: false, triggerType: "location" as const, title: "Bring charger" };
    const context = { now: new Date().toISOString(), timezone: "America/Los_Angeles", latitude: 47, longitude: -122, nearbyPlaces: [] };
    expect((await contextApi.evaluate({ ...base, location: { type: "saved_place", name: "home" } }, context)).notify).toBe(true);
    expect((await contextApi.evaluate({ ...base, location: { type: "category", category: "grocery_store" } }, { ...context, nearbyPlaces: [{ name: "Safeway", types: ["grocery_store"], distanceMeters: 43 }] })).notify).toBe(true);
    await contextApi.deletePlace(home.name); expect(await contextApi.savedPlaces()).toEqual([]);
  });
  it("drafts, edits, approves and cancels without sending mail", async () => {
    const draft = await actionsApi.draft("Write an email to Alex saying I'll be ten minutes late."); expect(draft.status).toBe("needs_approval");
    await actionsApi.edit(draft.id, { ...draft.email, to: "alex@example.com", subject: "Edited subject" }); await actionsApi.approve(draft.id);
    expect(await request(`/actions/${draft.id}`)).toMatchObject({ status: "approved", email: { to: "alex@example.com", subject: "Edited subject" } });
    await actionsApi.cancel(draft.id); expect(await request(`/actions/${draft.id}`)).toMatchObject({ status: "cancelled" });
  });
  it("reads retention facts, updates preferences, and clears only isolated history", async () => {
    expect((await privacyApi.info()).audioStored).toBe(false);
    await privacyApi.update({ keepTranscripts: false, deleteTranscriptsAfterDays: 7 });
    expect(await privacyApi.settings()).toMatchObject({ keepTranscripts: false, deleteTranscriptsAfterDays: 7 });
    await privacyApi.deleteHistory(); expect(await request("/actions")).toEqual([]);
  });
});
