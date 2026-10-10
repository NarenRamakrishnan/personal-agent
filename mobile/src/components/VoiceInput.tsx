import { ExpoSpeechRecognitionModule as Speech, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useEffect, useRef, useState } from "react";
import { Animated, AppState, Text, Vibration, View } from "react-native";
import { Button, errorMessage } from "./Controls";

export function VoiceInput({ onTranscript, disabled = false }: { onTranscript: (text: string) => void; disabled?: boolean }) {
  const [status, setStatus] = useState<"idle" | "starting" | "listening" | "stopping">("idle");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const pulse = useRef(new Animated.Value(1)).current;
  const transcript = useRef("");
  const cancelled = useRef(false);
  useSpeechRecognitionEvent("start", () => { setStatus("listening"); setSeconds(0); Vibration.vibrate(40); });
  useSpeechRecognitionEvent("result", event => {
    const text = event.results[0]?.transcript ?? "";
    transcript.current = text;
    if (!cancelled.current) onTranscript(text);
  });
  useSpeechRecognitionEvent("end", () => {
    setStatus("idle");
    if (!cancelled.current && !transcript.current.trim()) setError("No speech was recognized. Try again or type your command.");
  });
  useSpeechRecognitionEvent("error", event => { setStatus("idle"); if (event.error !== "aborted") setError(event.message || "Speech recognition failed. Try again or type your command."); });
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => { if (state !== "active") { cancelled.current = true; Speech.abort(); setStatus("idle"); } });
    return () => { subscription.remove(); cancelled.current = true; Speech.abort(); };
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
    if (status !== "idle") return;
    setStatus("starting"); setError(""); cancelled.current = false; transcript.current = "";
    try {
      if (!Speech.isRecognitionAvailable()) throw new Error("Speech recognition is unavailable here. Use a supported browser or a development build, or type your command.");
      const permission = await Speech.requestPermissionsAsync();
      if (!permission.granted) throw new Error("Microphone or speech permission was denied. Enable it in device/browser settings, or type your command.");
      Speech.start({ lang: "en-US", interimResults: true, continuous: false, recordingOptions: { persist: false } });
    } catch (e) { setError(errorMessage(e)); setStatus("idle"); }
  };
  return <View style={{ gap: 12 }}>
    <Text>Tap to speak. Your speech service may use a network connection; audio is not sent to this app's backend.</Text>
    <Button title={status === "listening" ? `Stop microphone · ${seconds}s` : status === "idle" ? "Speak a command" : "Please wait…"} disabled={disabled || status === "starting" || status === "stopping"} onPress={status === "listening" ? () => { setStatus("stopping"); Speech.stop(); } : start} />
    {status === "listening" && <Animated.Text accessibilityRole="alert" style={{ opacity: pulse, color: "#B54747" }}>● Microphone active</Animated.Text>}
    {status !== "idle" && <Button title="Discard recording" onPress={() => { cancelled.current = true; Speech.abort(); onTranscript(""); setStatus("idle"); }} />}
    {error ? <Text accessibilityRole="alert" style={{ color: "#B54747" }}>{error}</Text> : null}
  </View>;
}
