import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ events: new Map<string, Set<(event: any) => void>>(), background: undefined as undefined | ((state: string) => void), permission: vi.fn(), start: vi.fn(), stop: vi.fn(), abort: vi.fn() }));
vi.mock("expo-speech-recognition", async () => {
  const React = await import("react");
  return { ExpoSpeechRecognitionModule: { isRecognitionAvailable: () => true, requestPermissionsAsync: state.permission, start: state.start, abort: state.abort, stop: state.stop }, useSpeechRecognitionEvent: (name: string, callback: (event: any) => void) => {
    React.useEffect(() => { const handlers = state.events.get(name) ?? new Set(); handlers.add(callback); state.events.set(name, handlers); return () => { handlers.delete(callback); }; }, [name, callback]);
  } };
});
vi.mock("react-native", () => ({ Vibration: { vibrate: vi.fn() }, AppState: { addEventListener: (_: string, callback: (state: string) => void) => { state.background = callback; return { remove: vi.fn() }; } } }));
vi.mock("../src/services/activationTone", () => ({ activationTone: vi.fn(async () => {}) }));
import { useContinuousSpeech } from "../src/components/useContinuousSpeech";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useContinuousSpeech>;
const emit = (name: string, event: any = {}) => { for (const callback of state.events.get(name) ?? []) callback(event); };
async function mount() {
  const phrases: string[] = []; const ref: { current?: Hook } = {}; let root!: ReactTestRenderer;
  function Probe() { ref.current = useContinuousSpeech({ onPhrase: text => phrases.push(text) }); return null; }
  await act(async () => { root = create(<Probe />); });
  return { root, phrases, hook: () => ref.current! };
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); state.events.clear(); state.permission.mockResolvedValue({ granted: true }); });
afterEach(() => { vi.useRealTimers(); });

it("starts continuous recognition and passes on only final phrases", async () => {
  const { root, phrases, hook } = await mount();
  await act(async () => { await hook().start(); });
  expect(state.start).toHaveBeenCalledWith(expect.objectContaining({ continuous: true, interimResults: true }));
  await act(async () => { emit("start"); emit("result", { isFinal: false, results: [{ transcript: "call the" }] }); });
  expect(hook().interim).toBe("call the"); expect(phrases).toEqual([]);
  await act(async () => { emit("result", { isFinal: true, results: [{ transcript: "call the dentist" }] }); });
  expect(phrases).toEqual(["call the dentist"]); expect(hook().interim).toBe("");
  expect(hook().status).toBe("on");
  await act(async () => root.unmount());
});

it("restarts when the engine stops on its own and ignores silence errors", async () => {
  const { root, hook } = await mount();
  await act(async () => { await hook().start(); emit("start"); });
  await act(async () => { emit("error", { error: "no-speech", message: "" }); emit("end"); });
  expect(hook().error).toBe("");
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(state.start).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});

it("stops for real errors and gives up on a recognizer that keeps dying", async () => {
  const { root, hook } = await mount();
  await act(async () => { await hook().start(); emit("start"); emit("error", { error: "not-allowed", message: "denied" }); });
  expect(hook().status).toBe("off"); expect(hook().error).toMatch(/permission is off/);
  await act(async () => { hook().clearError(); await hook().start(); });
  for (let i = 0; i < 30; i++) await act(async () => { emit("start"); emit("end"); vi.advanceTimersByTime(400); });
  expect(hook().status).toBe("off"); expect(hook().error).toMatch(/keeps stopping/);
  await act(async () => root.unmount());
});

it("stop waits for the last phrase before resolving and does not restart", async () => {
  const { root, phrases, hook } = await mount();
  await act(async () => { await hook().start(); emit("start"); });
  let done = false; let stopping!: Promise<void>;
  await act(async () => { stopping = hook().stop().then(() => { done = true; }); });
  expect(state.stop).toHaveBeenCalled(); expect(done).toBe(false);
  await act(async () => { emit("result", { isFinal: true, results: [{ transcript: "buy milk" }] }); emit("end"); await stopping; });
  expect(done).toBe(true); expect(phrases).toEqual(["buy milk"]);
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(state.start).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

it("turns the microphone off when the app goes to the background", async () => {
  const { root, hook } = await mount();
  await act(async () => { await hook().start(); emit("start"); });
  await act(async () => { state.background?.("background"); });
  expect(state.abort).toHaveBeenCalled(); expect(hook().status).toBe("off");
  await act(async () => { emit("end"); vi.advanceTimersByTime(1000); });
  expect(state.start).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

it("does not start when permission is denied", async () => {
  state.permission.mockResolvedValue({ granted: false });
  const { root, hook } = await mount();
  await act(async () => { await hook().start(); });
  expect(state.start).not.toHaveBeenCalled(); expect(hook().error).toMatch(/denied/);
  await act(async () => root.unmount());
});
