import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), list: vi.fn(), update: vi.fn(), evaluate: vi.fn(), notify: vi.fn(), places: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: mocks.get, setItem: mocks.set } }));
vi.mock("../src/api/client", () => ({ reminderApi: { list: mocks.list, update: mocks.update }, contextApi: { evaluate: mocks.evaluate }, stamp: () => ({ now: new Date().toISOString(), timezone: "UTC" }) }));
vi.mock("../src/services/notifications", () => ({ notifyNow: mocks.notify }));
vi.mock("../src/services/places", () => ({ nearbyPlaces: mocks.places }));
vi.mock("expo-location", () => ({}));
vi.mock("react-native", () => ({ AppState: {} }));
import { evaluateContext, LOCATION_ENABLED } from "../src/services/context";
import { evaluateFix } from "../src/services/locationLifecycle";
const reminder = { id: "r", title: "Buy milk", createdAt: "2026-01-01T00:00:00Z", triggerType: "location", completed: false, location: { type: "category", category: "grocery" } };
const context = { now: new Date().toISOString(), timezone: "UTC", latitude: 1, longitude: 2, nearbyPlaces: [] };
beforeEach(() => { vi.resetAllMocks(); mocks.get.mockImplementation(async key => key === LOCATION_ENABLED ? "true" : "{}"); mocks.list.mockResolvedValue([reminder]); mocks.evaluate.mockResolvedValue({ reminderId: "r", notify: true }); mocks.places.mockResolvedValue([]); });
it.each(["completed", "deleted", "snoozed", "edited"])("suppresses an evaluation when the reminder was %s during the request", async change => {
  const latest = change === "deleted" ? [] : [{ ...reminder, ...(change === "completed" ? { completed: true } : change === "snoozed" ? { snoozedUntil: new Date(Date.now() + 600000).toISOString() } : { title: "Buy bread" }) }];
  mocks.list.mockResolvedValueOnce([reminder]).mockResolvedValueOnce(latest); await evaluateContext(context); expect(mocks.notify).not.toHaveBeenCalled();
});
it("delivers an unchanged eligible reminder and records the cooldown", async () => { await evaluateContext(context); expect(mocks.notify).toHaveBeenCalledWith(reminder); expect(mocks.set).toHaveBeenCalledWith("context-notification-ledger", expect.any(String)); expect(mocks.update).toHaveBeenCalledWith("r", expect.objectContaining({ lastNotifiedAt: expect.any(String) })); });
it("rechecks opt-in after the evaluator returns", async () => { mocks.evaluate.mockImplementation(async () => { mocks.get.mockResolvedValue("false"); return { notify: true }; }); await evaluateContext(context); expect(mocks.notify).not.toHaveBeenCalled(); });
it("respects the persisted notification cooldown", async () => { mocks.get.mockImplementation(async key => key === LOCATION_ENABLED ? "true" : JSON.stringify({ r: Date.now() })); await evaluateContext(context); expect(mocks.evaluate).not.toHaveBeenCalled(); });
it.each(["stale", "future", "invalid", "inaccurate"])("rejects %s GPS fixes before querying places", async kind => {
  const fix = { timestamp: kind === "stale" ? Date.now() - 180000 : kind === "future" ? Date.now() + 60000 : Date.now(), coords: { latitude: kind === "invalid" ? NaN : 1, longitude: 2, accuracy: kind === "inaccurate" ? 300 : 20 } };
  await evaluateFix(fix as any); expect(mocks.places).not.toHaveBeenCalled(); expect(mocks.evaluate).not.toHaveBeenCalled();
});
