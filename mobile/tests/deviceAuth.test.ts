import { expect, it, vi } from "vitest";
import { createDeviceAuth, credentialKey } from "../src/api/deviceAuth";
function setup(saved: string | null = null) {
  const store = { get: vi.fn(async () => saved), set: vi.fn(async (_: string, value: string) => { saved = value; }) };
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ deviceId: "device-a", token: "private-token" }), { status: 201 }));
  return { store, fetcher, auth: createDeviceAuth("https://example.test", store, fetcher) };
}
it("registers once for simultaneous requests and restores persisted credentials", async () => {
  const { auth, store, fetcher } = setup(); expect(await Promise.all([auth.getToken(), auth.getToken()])).toEqual(["private-token", "private-token"]);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(store.set).toHaveBeenCalledWith(credentialKey("https://example.test"), "private-token");
  expect(await createDeviceAuth("https://example.test", store, fetcher).getToken()).toBe("private-token"); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not register or replace an existing identity", async () => { const { auth, fetcher } = setup("existing"); expect(await auth.getToken()).toBe("existing"); expect(fetcher).not.toHaveBeenCalled(); });
it("separates credentials by backend without unsafe secure-store key characters", () => { expect(credentialKey("https://a.test/a")).not.toBe(credentialKey("https://a.test_a")); expect(credentialKey("https://a.test")).toMatch(/^[\w.-]+$/); });
it("fails closed on storage failure", async () => { const { auth, store } = setup(); store.set.mockRejectedValue(new Error("Vault unavailable")); await expect(auth.getToken()).rejects.toThrow("Vault unavailable"); });
it("retries a failed registration but never stores an error response", async () => {
  const { auth, store, fetcher } = setup(); fetcher.mockResolvedValueOnce(new Response("{}", { status: 429 }));
  await expect(auth.getToken()).rejects.toThrow("429"); expect(store.set).not.toHaveBeenCalled(); expect(await auth.getToken()).toBe("private-token");
});
it("rejects malformed registration data", async () => { const { auth, store, fetcher } = setup(); fetcher.mockResolvedValueOnce(new Response("{}")); await expect(auth.getToken()).rejects.toThrow("Invalid device"); expect(store.set).not.toHaveBeenCalled(); });
