import { afterEach, expect, it, vi } from "vitest";
import { credentials } from "../src/services/credentials";
afterEach(() => vi.unstubAllGlobals());
function fakeStorage(start: Record<string, string> = {}) {
  const values = new Map(Object.entries(start));
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, key: (i: number) => [...values.keys()][i] ?? null, get length() { return values.size; } };
}
it("keeps the device key in local storage so reminders survive closing the tab", async () => {
  const local = fakeStorage(); vi.stubGlobal("localStorage", local); vi.stubGlobal("sessionStorage", fakeStorage());
  await credentials.set("device.abc", "token");
  expect(local.values.get("device.abc")).toBe("token");
  expect(await credentials.get("device.abc")).toBe("token");
});
it("carries over a key from the older tab-only storage once", async () => {
  const local = fakeStorage(); const session = fakeStorage({ "device.abc": "old-token" });
  vi.stubGlobal("localStorage", local); vi.stubGlobal("sessionStorage", session);
  expect(await credentials.get("device.abc")).toBe("old-token");
  expect(local.values.get("device.abc")).toBe("old-token");
  expect(session.values.has("device.abc")).toBe(false);
});
it("forgets only device keys", async () => {
  const local = fakeStorage({ "device.a": "1", "device.b": "2", "heedly.appearance": "dark" }); vi.stubGlobal("localStorage", local);
  await credentials.forgetAll("device.");
  expect([...local.values.keys()]).toEqual(["heedly.appearance"]);
});
it("does not silently create an ephemeral identity when browser storage is blocked", async () => {
  vi.stubGlobal("localStorage", undefined);
  await expect(credentials.get("device")).rejects.toThrow("Browser storage is unavailable");
});
