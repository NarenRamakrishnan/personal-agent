import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ focused: true, events: new Map<string, Set<(event: any) => void>>(), background: undefined as undefined | ((state: string) => void), permission: vi.fn(), start: vi.fn(), abort: vi.fn() }));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => state.focused }));
vi.mock("expo-speech-recognition", async () => {
  const React = await import("react");
  return { ExpoSpeechRecognitionModule: { isRecognitionAvailable: () => true, requestPermissionsAsync: state.permission, start: state.start, abort: state.abort, stop: vi.fn() }, useSpeechRecognitionEvent: (name: string, callback: (event: any) => void) => {
    React.useEffect(() => { const handlers = state.events.get(name) ?? new Set(); handlers.add(callback); state.events.set(name, handlers); return () => { handlers.delete(callback); }; }, [name, callback]);
  } };
});
vi.mock("react-native", () => ({ View: "view", Text: "text", Platform: { OS: "ios", select: (options: any) => options.ios ?? options.default }, StyleSheet: { create: (styles: any) => styles }, Vibration: { vibrate: vi.fn() }, AppState: { addEventListener: (_: string, callback: (state: string) => void) => { state.background = callback; return { remove: vi.fn() }; } }, Animated: { Value: class { setValue() {} }, Text: "text", View: "view", loop: () => ({ start() {}, stop() {} }), sequence: vi.fn(), timing: vi.fn() } }));
vi.mock("../src/components/Controls", () => ({ Button: (props: any) => React.createElement("button", props), errorMessage: (error: Error) => error.message }));
vi.mock("../src/services/activationTone", () => ({ activationTone: vi.fn(async () => {}) }));
import { VoiceInput } from "../src/components/VoiceInput";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { vi.clearAllMocks(); state.focused = true; state.events.clear(); state.permission.mockResolvedValue({ granted: true }); });
async function mount() { let root!: ReactTestRenderer; const transcript = vi.fn(); await act(async () => { root = create(<VoiceInput onTranscript={transcript} />); }); return { root, transcript }; }
function speak(root: ReactTestRenderer) { return root.root.findAllByType("button")[0].props.onPress(); }
it("ignores global speech results when this screen does not own the microphone", async () => {
  const { root, transcript } = await mount(); await act(async () => { for (const callback of state.events.get("result") ?? []) callback({ results: [{ transcript: "Other screen" }] }); }); expect(transcript).not.toHaveBeenCalled(); await act(async () => root.unmount());
});
it.each(["discard", "blur", "background", "unmount"])("does not start the microphone after pending permission and %s", async reason => {
  let resolve!: (permission: { granted: boolean }) => void; state.permission.mockImplementation(() => new Promise(done => { resolve = done; }));
  const { root } = await mount(); let pending!: Promise<void>; await act(async () => { pending = speak(root); });
  await act(async () => {
    if (reason === "discard") root.root.findAllByType("button")[1].props.onPress();
    if (reason === "blur") { state.focused = false; root.update(<VoiceInput onTranscript={vi.fn()} />); }
    if (reason === "background") state.background?.("background");
    if (reason === "unmount") root.unmount();
  });
  await act(async () => { resolve({ granted: true }); await pending; }); expect(state.start).not.toHaveBeenCalled();
  if (reason !== "unmount") await act(async () => root.unmount());
});
it("blocks synchronous duplicate taps and delivers only owned transcripts", async () => {
  const { root, transcript } = await mount(); await act(async () => { await Promise.all([speak(root), speak(root)]); }); expect(state.start).toHaveBeenCalledTimes(1);
  await act(async () => { for (const callback of state.events.get("result") ?? []) callback({ results: [{ transcript: "Buy milk" }] }); }); expect(transcript).toHaveBeenCalledWith("Buy milk"); await act(async () => root.unmount());
});
