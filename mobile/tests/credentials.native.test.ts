import { expect, it, vi } from "vitest";
const vault = vi.hoisted(() => ({ getItemAsync: vi.fn(async () => "token"), setItemAsync: vi.fn(), AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 4 }));
vi.mock("expo-secure-store", () => vault);
import { credentials } from "../src/services/credentials.native";
it("stores native tokens in the encrypted vault with background-compatible device-only access", async () => { await credentials.set("device", "token"); expect(vault.setItemAsync).toHaveBeenCalledWith("device", "token", { keychainAccessible: 4 }); expect(await credentials.get("device")).toBe("token"); });
