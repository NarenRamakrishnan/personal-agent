import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ platform: { OS: "android", Version: 34 }, check: vi.fn(), open: vi.fn() }));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("react-native-permissions", () => ({ canScheduleExactAlarms: mocks.check, openSettings: mocks.open }));
import { exactAlarmsAllowed, requestExactAlarms } from "../src/services/alarmPermission.native";
beforeEach(() => { vi.resetAllMocks(); mocks.platform.OS = "android"; mocks.platform.Version = 34; });
it("opens the alarms settings only after an explicit request with denied access", async () => { mocks.check.mockResolvedValue(false); expect(await exactAlarmsAllowed()).toBe(false); expect(mocks.open).not.toHaveBeenCalled(); await requestExactAlarms(); expect(mocks.open).toHaveBeenCalledWith("alarms"); });
it("does not prompt when already allowed", async () => { mocks.check.mockResolvedValue(true); await requestExactAlarms(); expect(mocks.open).not.toHaveBeenCalled(); });
it.each(["ios", "old-android"])("does not require special alarm access on %s", async kind => { if (kind === "ios") mocks.platform.OS = "ios"; else mocks.platform.Version = 30; expect(await exactAlarmsAllowed()).toBe(true); expect(mocks.check).not.toHaveBeenCalled(); });
