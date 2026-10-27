import { afterEach, describe, expect, it, vi } from "vitest";
import { nearbyPlaces, resetPlacesBackoff } from "../src/services/places";

// Each test uses a different spot so the 100 m / 2 min cache never answers for another test.
describe("nearby place lookup backoff", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); resetPlacesBackoff(); });

  it("stops calling Overpass for 30 seconds after a 429", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const fetchMock = vi.fn(async () => new Response("slow down", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(nearbyPlaces(42.37, -72.52)).rejects.toThrow("busy");
    await expect(nearbyPlaces(42.5, -72.6)).rejects.toThrow("busy");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000_000 + 31_000);
    await expect(nearbyPlaces(42.7, -72.8)).rejects.toThrow("busy");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats 406 the same as 429", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 406 })));
    await expect(nearbyPlaces(43.1, -71.1)).rejects.toThrow("busy");
  });

  it("keeps the generic message for other server errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(nearbyPlaces(44.2, -70.2)).rejects.toThrow("unavailable");
  });
});
