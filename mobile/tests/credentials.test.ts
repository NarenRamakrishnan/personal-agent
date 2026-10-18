import { afterEach, expect, it, vi } from "vitest";
import { credentials } from "../src/services/credentials";
afterEach(() => vi.unstubAllGlobals());
it("uses browser session storage, not local storage", async () => {
  const values = new Map<string, string>(); vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
  await credentials.set("device", "token"); expect(await credentials.get("device")).toBe("token");
});
it("does not silently create an ephemeral identity when session storage is blocked", async () => { vi.stubGlobal("sessionStorage", undefined); await expect(credentials.get("device")).rejects.toThrow("Session storage is unavailable"); });
