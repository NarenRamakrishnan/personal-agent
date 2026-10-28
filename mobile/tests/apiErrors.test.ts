import { describe, expect, it, vi } from "vitest";
vi.mock("../src/services/credentials", () => ({ credentials: { get: async () => "t", set: vi.fn() } }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) } }));
import { readableDetail } from "../src/api/client";

describe("server errors in plain words", () => {
  it.each([
    [{ detail: "Too many new devices right now. Try again in an hour." }, 429, "Too many new devices right now. Try again in an hour."],
    [{ detail: [{ msg: "Value error, value is not a valid email address: An email address must have an @-sign." }] }, 422, "That email address doesn't look right. Check it and try again."],
    [{ detail: [{ msg: "String should have at most 500 characters", ctx: { max_length: 500 } }] }, 422, "That's too long. Keep it under 500 characters."],
    [{ detail: [{ msg: "String should have at least 1 character" }] }, 422, "Something needed is empty. Fill it in and try again."],
    [{}, 503, "Heedly had a problem on its side. Try again in a moment."],
    [{}, 429, "Heedly is busy right now. Wait a moment and try again."],
  ])("%j (%i)", (data, status, expected) => { expect(readableDetail(data, status)).toBe(expected); });
});
