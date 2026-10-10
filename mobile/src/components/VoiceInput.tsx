import { ExpoSpeechRecognitionModule as Speech, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useEffect, useRef, useState } from "react";
import { Animated, AppState, Text, Vibration, View } from "react-native";
import { Button, errorMessage } from "./Controls";
import { activationTone } from "../services/activationTone";
import { useIsFocused } from "@react-navigation/native";

export function VoiceInput({ onTranscript, disabled = false }: { onTranscript: (text: string) => void; disabled?: boolean }) {
  const focused = useIsFocused();
  const focusedRef = useRef(focused); focusedRef.current = focused;
  const owned = useRef(false);
  const generation = useRef(0);
  const [status, setStatus] = useState<"idle" | "starting" | "listening" | "stopping">("idle");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const pulse = useRef(new Animated.Value(1)).current;
  const transcript = useRef("");
  const cancelled = useRef(false);
  useSpeechRecognitionEvent("start", () => { if (owned.current && focusedRef.current) { setStatus("listening"); setSeconds(0); Vibration.vibrate(40); } });
  useSpeechRecognitionEvent("result", event => {
    if (!owned.current || !focusedRef.current || cancelled.current) return;
    const text = event.results[0]?.transcript ?? "";
    transcript.current = text;
    if (!cancelled.current) onTranscript(text);
  });
  useSpeechRecognitionEvent("end", () => {
    if (!owned.current) return;
    owned.current = false;
    setStatus("idle");
    if (!cancelled.current && !transcript.current.trim()) setError("No speech was recognized. Try again or type your command.");
  });
  useSpeechRecognitionEvent("error", event => { if (!owned.current || !focusedRef.current) return; owned.current = false; setStatus("idle"); if (event.error !== "aborted") setError(event.message || "Speech recognition failed. Try again or type your command."); });
  const abortOwned = () => { generation.current++; cancelled.current = true; if (owned.current) { owned.current = false; Speech.abort(); } };
  useEffect(() => { if (!focused) { abortOwned(); setStatus("idle"); } }, [focused]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => { if (state !== "active") { abortOwned(); setStatus("idle"); } });
    return () => { subscription.remove(); abortOwned(); };
  }, []);
  useEffect(() => {
    if (status !== "listening") return;
    const animation = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 0.3, duration: 500, useNativeDriver: true }), Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true })]));
    animation.start();
    const timer = setInterval(() => setSeconds(value => value + 1), 1000);
    const limit = setTimeout(() => { setStatus("stopping"); Speech.stop(); }, 60000);
    return () => { animation.stop(); pulse.setValue(1); clearInterval(timer); clearTimeout(limit); };
  }, [status, pulse]);
  const start = async () => {
    if (!focusedRef.current || owned.current) return;
    owned.current = true;
    const token = ++generation.current;
    setStatus("starting"); setError(""); cancelled.current = false; transcript.current = "";
    try {
      if (!Speech.isRecognitionAvailable()) throw new Error("Speech recognition is unavailable here. Use a supported browser or a development build, or type your command.");
      const permission = await Speech.requestPermissionsAsync();
      if (token !== generation.current || !focusedRef.current) return;
      if (!permission.granted) throw new Error("Microphone or speech permission was denied. Enable it in device/browser settings, or type your command.");
      await activationTone().catch(() => {});
      if (token !== generation.current || !focusedRef.current) return;
      Speech.start({ lang: "en-US", interimResults: true, continuous: false, recordingOptions: { persist: false } });
    } catch (e) { if (token === generation.current) { owned.current = false; setError(errorMessage(e)); setStatus("idle"); } }
  };
  return <View style={{ gap: 12 }}>
    <Text>Tap to speak. Your speech service may use a network connection; audio is not sent to this app's backend.</Text>
    <Button title={status === "listening" ? `Stop microphone · ${seconds}s` : status === "idle" ? "Speak a command" : "Please wait…"} disabled={disabled || status === "starting" || status === "stopping"} onPress={status === "listening" ? () => { setStatus("stopping"); Speech.stop(); } : start} />
    {status === "listening" && <Animated.Text accessibilityRole="alert" style={{ opacity: pulse, color: "#B54747" }}>● Microphone active</Animated.Text>}
    {status !== "idle" && <Button title="Discard recording" onPress={() => { abortOwned(); onTranscript(""); setStatus("idle"); }} />}
    {error ? <Text accessibilityRole="alert" style={{ color: "#B54747" }}>{error}</Text> : null}
  </View>;
}
