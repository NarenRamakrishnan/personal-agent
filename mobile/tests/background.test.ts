import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ storage: new Map<string, string>(), permission: vi.fn(), start: vi.fn(), fenceStart: vi.fn(), fenceStop: vi.fn(), stop: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: async (key: string) => mocks.storage.get(key), setItem: async (key: string, value: string) => { mocks.storage.set(key, value); } } }));
vi.mock("expo-location", () => ({ requestBackgroundPermissionsAsync: mocks.permission, startLocationUpdatesAsync: mocks.start, startGeofencingAsync: mocks.fenceStart, hasStartedGeofencingAsync: async () => true, hasStartedLocationUpdatesAsync: async () => true, stopGeofencingAsync: mocks.fenceStop, stopLocationUpdatesAsync: mocks.stop, Accuracy: { Balanced: 1 } }));
vi.mock("expo-task-manager", () => ({ defineTask: vi.fn(), isAvailableAsync: async () => true }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("../src/api/client", () => ({ reminderApi: { list: async () => [] }, contextApi: { savedPlaces: async () => [] } }));
vi.mock("../src/services/context", () => ({ LOCATION_ENABLED: "location", BACKGROUND_ENABLED: "background" }));
vi.mock("../src/services/locationLifecycle", () => ({ evaluateFix: vi.fn() }));
import { disableBackgroundContext, enableBackgroundContext } from "../src/services/background.native";
beforeEach(() => { vi.resetAllMocks(); mocks.storage.clear(); mocks.storage.set("location", "true"); mocks.permission.mockResolvedValue({ granted: true }); });
it("does not re-enable background tracking after disabling during a permission prompt", async () => {
  let resolve!: (value: { granted: boolean }) => void; mocks.permission.mockImplementation(() => new Promise(done => { resolve = done; }));
  const pending = enableBackgroundContext(); await vi.waitFor(() => expect(mocks.permission).toHaveBeenCalled());
  await disableBackgroundContext(); resolve({ granted: true }); await pending;
  expect(mocks.storage.get("background")).toBe("false"); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.fenceStart).not.toHaveBeenCalled();
});
it("tries to stop location updates even if stopping geofences fails", async () => {
  mocks.fenceStop.mockRejectedValue(new Error("Native stop failed")); await expect(disableBackgroundContext()).rejects.toThrow("Native stop failed"); expect(mocks.stop).toHaveBeenCalled(); expect(mocks.storage.get("background")).toBe("false");
});
