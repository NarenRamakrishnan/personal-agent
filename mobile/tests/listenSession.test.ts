import { describe, expect, it, vi } from "vitest";
vi.mock("../src/services/credentials", () => ({ credentials: { get: async () => "test-device-token", set: vi.fn() } }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) } }));
import { SessionApi, SessionEndedError } from "../src/api/sessions";
import { createListenSession, isEmailCommand, planTranscript } from "../src/services/listenSession";
import { Reminder } from "../src/types/reminder";

const reminder = (id: string, title: string, extra: Partial<Reminder> = {}): Reminder =>
  ({ id, title, createdAt: "2026-10-27T12:00:00Z", triggerType: "time", completed: false, ...extra });

function fakeApi(overrides: Partial<SessionApi> = {}) {
  let sessions = 0;
  const api: SessionApi = {
    start: vi.fn(async () => ({ id: `s${++sessions}`, status: "listening" as const, startedAt: "", lastActivityAt: "" })),
    parse: vi.fn(async (sessionId: string, text: string) => ({ sessionId, reminders: [reminder(text, text)], pendingChunks: 0, changed: [] })),
    email: vi.fn(async (sessionId: string) => ({ id: "e1", type: "email" as const, status: "needs_approval" as const, createdAt: "", email: { toName: "Alex", subject: "Running late", body: "Hi" } })),
    end: vi.fn(async (sessionId: string) => ({ id: sessionId, status: "ended" as const, startedAt: "", lastActivityAt: "", reminders: [], actions: [], pendingChunks: 0, changed: [] })),
    retry: vi.fn(async (sessionId: string) => ({ id: sessionId, status: "ended" as const, startedAt: "", lastActivityAt: "", reminders: [], actions: [], pendingChunks: 0, changed: [] })),
    ...overrides,
  };
  return api;
}

describe("listening session", () => {
  it("sends phrases in order under one session and shows each new reminder", async () => {
    const api = fakeApi(); const session = createListenSession(api);
    await session.start();
    void session.say("call the dentist"); await session.say("buy milk");
    expect(vi.mocked(api.parse).mock.calls.map(call => [call[0], call[1]])).toEqual([["s1", "call the dentist"], ["s1", "buy milk"]]);
    expect(session.getSnapshot().feed.map(item => item.kind === "email" ? item.email.id : item.reminder.title)).toEqual(["buy milk", "call the dentist"]);
    expect(session.getSnapshot().heard).toBe(2);
  });

  it("ignores blank phrases and phrases after stopping", async () => {
    const api = fakeApi(); const session = createListenSession(api);
    await session.start(); await session.say("   "); await session.stop(); await session.say("too late");
    expect(api.parse).not.toHaveBeenCalled();
  });

  it("marks completions and keeps a same-session reminder as new when it is updated", async () => {
    const api = fakeApi({
      parse: vi.fn()
        .mockResolvedValueOnce({ sessionId: "s1", reminders: [reminder("r1", "Dentist")], pendingChunks: 0, changed: [] })
        .mockResolvedValueOnce({ sessionId: "s1", reminders: [], pendingChunks: 0, changed: [reminder("r1", "Dentist Friday")] })
        .mockResolvedValueOnce({ sessionId: "s1", reminders: [], pendingChunks: 0, changed: [reminder("old", "Milk", { completed: true })] }),
    });
    const session = createListenSession(api); await session.start();
    await session.say("dentist tomorrow"); await session.say("move it to Friday"); await session.say("I got the milk");
    const feed = session.getSnapshot().feed;
    expect(feed.map(item => item.kind)).toEqual(["completed", "new"]);
    expect(feed[1].kind !== "email" && feed[1].reminder.title).toBe("Dentist Friday");
  });

  it("routes email commands to the email drafter with the session id", async () => {
    const api = fakeApi(); const session = createListenSession(api); await session.start();
    await session.say("Write an email to Alex saying I'm running late");
    expect(api.email).toHaveBeenCalledWith("s1", "Write an email to Alex saying I'm running late");
    expect(api.parse).not.toHaveBeenCalled();
    expect(session.getSnapshot().feed[0].kind).toBe("email");
  });

  it("starts a fresh session when the server says the old one ended", async () => {
    const parse = vi.fn()
      .mockRejectedValueOnce(new SessionEndedError("Session already ended (silence_timeout)."))
      .mockResolvedValueOnce({ sessionId: "s2", reminders: [reminder("r1", "Gym")], pendingChunks: 0, changed: [] });
    const api = fakeApi({ parse }); const session = createListenSession(api); await session.start();
    await session.say("gym at 6");
    expect(parse.mock.calls.map(call => call[0])).toEqual(["s1", "s2"]);
    expect(session.getSnapshot().sessionId).toBe("s2");
    expect(session.getSnapshot().error).toBe("");
  });

  it("keeps phrases that fail to send and retries them before ending", async () => {
    const parse = vi.fn()
      .mockRejectedValueOnce(new Error("Network request failed."))
      .mockResolvedValue({ sessionId: "s1", reminders: [reminder("r1", "Call Mom")], pendingChunks: 0, changed: [] });
    const api = fakeApi({ parse }); const session = createListenSession(api); await session.start();
    await session.say("call mom");
    expect(session.getSnapshot().unsent).toEqual(["call mom"]);
    expect(session.getSnapshot().error).toMatch(/kept what you said/);
    await session.stop();
    expect(parse).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().unsent).toEqual([]);
    expect(api.end).toHaveBeenCalledWith("s1");
  });

  it("explains a refused email instead of blaming the connection, and does not retry it", async () => {
    const refused = Object.assign(new Error("That doesn't look like a request to send an email"), { status: 422 });
    const api = fakeApi({ email: vi.fn().mockRejectedValue(refused) }); const session = createListenSession(api); await session.start();
    await session.say("Uh write an email to Alex");
    expect(session.getSnapshot().unsent).toEqual([]);
    expect(session.getSnapshot().error).toMatch(/couldn't tell what email to write.*who it's for and what to say/);
    await session.stop();
    expect(api.email).toHaveBeenCalledTimes(1);
  });

  it("still keeps phrases for retry on server errors and rate limits", async () => {
    const parse = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Parsing is temporarily unavailable"), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error("Too many requests"), { status: 429 }));
    const api = fakeApi({ parse }); const session = createListenSession(api); await session.start();
    await session.say("pay rent"); await session.say("call mom");
    expect(session.getSnapshot().unsent).toEqual(["pay rent", "call mom"]);
  });

  it("does not resend a failed phrase that was retried by hand", async () => {
    const parse = vi.fn()
      .mockRejectedValueOnce(new Error("Parsing is temporarily unavailable"))
      .mockResolvedValue({ sessionId: "s1", reminders: [reminder("r1", "Call Dad")], pendingChunks: 0, changed: [] });
    const api = fakeApi({ parse }); const session = createListenSession(api); await session.start();
    await session.say("call dad"); await session.say("call dad");
    expect(session.getSnapshot()).toMatchObject({ unsent: [], error: "" });
    await session.stop();
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("ends with the server's review list and reports pending chunks", async () => {
    const api = fakeApi({ end: vi.fn(async () => ({ id: "s1", status: "ended" as const, startedAt: "", lastActivityAt: "", reminders: [reminder("r1", "Pay rent")], actions: [], pendingChunks: 1, changed: [] })) });
    const session = createListenSession(api); await session.start();
    const detail = await session.stop();
    expect(detail?.reminders[0].title).toBe("Pay rent");
    expect(session.getSnapshot()).toMatchObject({ status: "ended", pendingChunks: 1 });
  });

  it("stays usable when ending fails", async () => {
    const api = fakeApi({ end: vi.fn().mockRejectedValueOnce(new Error("The server took too long. Try again.")) });
    const session = createListenSession(api); await session.start();
    await expect(session.stop()).rejects.toThrow("too long");
    expect(session.getSnapshot().status).toBe("listening");
    expect(session.getSnapshot().error).toMatch(/try Stop again/);
  });
});

describe("whole-transcript sending", () => {
  it("sends the talk as one reminder request with corrections in context, emails separately", async () => {
    const api = fakeApi(); const session = createListenSession(api); await session.start();
    await session.sayAll([
      "I need to call the dentist tomorrow at 9", "and buy milk on the way home",
      "actually move the dentist to Friday at 2", "Write an email to Alex", "tell him I'm running late",
    ]);
    expect(vi.mocked(api.parse).mock.calls.map(c => c[1])).toEqual([
      "I need to call the dentist tomorrow at 9. and buy milk on the way home. actually move the dentist to Friday at 2.",
    ]);
    expect(vi.mocked(api.email).mock.calls.map(c => c[1])).toEqual(["Write an email to Alex. tell him I'm running late"]);
  });

  it("does nothing for an empty talk", async () => {
    const api = fakeApi(); const session = createListenSession(api); await session.start();
    await session.sayAll(["", "  "]);
    expect(api.parse).not.toHaveBeenCalled(); expect(api.email).not.toHaveBeenCalled();
  });
});

describe("planTranscript", () => {
  it("splits a long talk between sentences so each request stays small", () => {
    const sentence = "Remind me to water the plants on Saturday morning before I leave";
    const plan = planTranscript(Array.from({ length: 40 }, () => sentence));
    expect(plan.reminders.length).toBeGreaterThan(1);
    for (const chunk of plan.reminders) { expect(chunk.length).toBeLessThanOrEqual(600); expect(chunk.endsWith(".")).toBe(true); }
    expect(plan.reminders.join(" ").split(sentence).length - 1).toBe(40);
  });

  it("keeps an email's follow-on with it and leaves later reminders alone", () => {
    expect(planTranscript(["email Priya that the deck is ready", "and tell her thanks", "buy stamps"])).toEqual({
      emails: ["email Priya that the deck is ready. and tell her thanks"], reminders: ["buy stamps."],
    });
  });
});

describe("email command detection", () => {
  it.each([
    ["Write an email to Alex saying I'm running late", true],
    ["send Sam an email about the meeting", true],
    ["email Priya that the deck is ready", true],
    ["remind me to check my email tomorrow", false],
    ["buy milk on the way home", false],
  ])("%s -> %s", (text, expected) => { expect(isEmailCommand(text)).toBe(expected); });
});
