import { ExpoSpeechRecognitionModule as Speech, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useEffect, useRef, useState } from "react";
import { AppState, Vibration } from "react-native";
import { activationTone } from "../services/activationTone";

export type SpeechStatus = "off" | "starting" | "on" | "stopping";

// Keeps the recognizer running for a whole listening session. Engines end on their own
// (silence, iOS's per-task limit, Android 12 and older), so it restarts while wanted.
export function useContinuousSpeech({ onPhrase }: { onPhrase: (text: string) => void }) {
  const [status, setStatus] = useState<SpeechStatus>("off");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const wanted = useRef(false);
  const owned = useRef(false);
  const restarts = useRef<number[]>([]);
  const ended = useRef<(() => void)[]>([]);
  const phrase = useRef(onPhrase); phrase.current = onPhrase;

  const begin = () => {
    owned.current = true;
    Speech.start({ lang: "en-US", interimResults: true, continuous: true, recordingOptions: { persist: false }, iosTaskHint: "dictation", addsPunctuation: true });
  };
  const restart = () => {
    const now = Date.now();
    restarts.current = [...restarts.current.filter(at => now - at < 60000), now];
    // A recognizer that dies instantly over and over is broken, not just quiet.
    if (restarts.current.length > 25) { wanted.current = false; setStatus("off"); setError("The microphone keeps stopping. Type what you would say instead."); return; }
    setTimeout(() => { if (wanted.current && !owned.current) begin(); }, 300);
  };
  const flushEnded = () => { const waiting = ended.current; ended.current = []; waiting.forEach(done => done()); };

  useSpeechRecognitionEvent("start", () => { if (owned.current) setStatus(wanted.current ? "on" : "stopping"); });
  useSpeechRecognitionEvent("result", event => {
    if (!owned.current) return;
    const text = event.results[0]?.transcript?.trim() ?? "";
    if (event.isFinal) { setInterim(""); if (text) phrase.current(text); }
    else setInterim(text);
  });
  useSpeechRecognitionEvent("end", () => {
    if (!owned.current) return;
    owned.current = false;
    if (wanted.current) { restart(); return; }
    setStatus("off"); setInterim(""); flushEnded();
  });
  useSpeechRecognitionEvent("error", event => {
    if (!owned.current) return;
    // Silence is normal while listening; "end" follows and restarts the recognizer.
    if (event.error === "no-speech" || event.error === "aborted" || event.error === "speech-timeout") return;
    wanted.current = false; owned.current = false; setStatus("off"); flushEnded();
    setError(event.error === "not-allowed" ? "Microphone or speech permission is off. Allow it in settings, or type instead." : event.message || "Speech recognition stopped. Type what you would say instead.");
  });

  const start = async () => {
    if (wanted.current) return;
    setError(""); setStatus("starting"); wanted.current = true; restarts.current = [];
    try {
      if (!Speech.isRecognitionAvailable()) throw new Error("Speech recognition isn't available in this browser. Use Chrome or type what you would say.");
      const permission = await Speech.requestPermissionsAsync();
      if (!permission.granted) throw new Error("Microphone or speech permission was denied. Allow it in settings, or type instead.");
      if (!wanted.current) return;
      await activationTone().catch(() => {});
      Vibration.vibrate(40);
      begin();
    } catch (e) { wanted.current = false; setStatus("off"); setError(e instanceof Error ? e.message : "Couldn't start the microphone."); }
  };

  // Resolves once the recognizer has delivered its last phrase (or after 2.5 s).
  const stop = () => new Promise<void>(resolve => {
    wanted.current = false;
    if (!owned.current) { setStatus("off"); setInterim(""); resolve(); return; }
    setStatus("stopping");
    const timer = setTimeout(() => { owned.current = false; Speech.abort(); setStatus("off"); setInterim(""); flushEnded(); }, 2500);
    ended.current.push(() => { clearTimeout(timer); resolve(); });
    Speech.stop();
  });

  // Never keep the mic open behind the user's back.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active" && wanted.current) { wanted.current = false; if (owned.current) { owned.current = false; Speech.abort(); } setStatus("off"); setInterim(""); flushEnded(); }
    });
    return () => { subscription.remove(); wanted.current = false; if (owned.current) { owned.current = false; Speech.abort(); } };
  }, []);

  return { status, interim, error, start, stop, clearError: () => setError("") };
}
