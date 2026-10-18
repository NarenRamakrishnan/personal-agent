import { afterEach, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllGlobals(); });
it("queries named places outside the canonical taxonomy and bounds provider output", async () => {
  vi.resetModules(); const { nearbyPlaces } = await import("../src/services/places");
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ elements: [{ id: 1, lat: 47, lon: -122, tags: { name: "The UPS Store", shop: "copyshop" } }] }))); vi.stubGlobal("fetch", fetcher);
  expect(await nearbyPlaces(47, -122)).toMatchObject([{ name: "The UPS Store", types: [] }]);
  const query = new URLSearchParams((fetcher.mock.calls[0] as any)[1].body).get("data");
  expect(query).toContain("[name]"); expect(query).toContain("[brand]"); expect(query).toContain("around:500,47,-122"); expect(query).toContain("out center 1000");
  await nearbyPlaces(47, -122); expect(fetcher).toHaveBeenCalledTimes(1);
});
