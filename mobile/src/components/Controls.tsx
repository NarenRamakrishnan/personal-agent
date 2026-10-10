import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Try again.";
export function Page({ children }: { children: React.ReactNode }) {
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16, backgroundColor: "#F7F8FA", flexGrow: 1 }}>{children}</ScrollView>;
}
export function Button({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={{ backgroundColor: "#377D6A", borderRadius: 12, padding: 15, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: "white", textAlign: "center", fontWeight: "600" }}>{title}</Text></Pressable>;
}
export function Field({ label, value, onChangeText, multiline = false }: { label: string; value: string; onChangeText: (text: string) => void; multiline?: boolean }) {
  return <View style={{ gap: 6 }}><Text>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} multiline={multiline} style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#D8DEE8", borderRadius: 12, padding: 14, minHeight: multiline ? 100 : 48 }} /></View>;
}
export function AsyncButton({ title, action }: { title: string; action: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const run = async () => { setBusy(true); setError(""); try { await action(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  return <View style={{ gap: 8 }}><Button title={busy ? "Please wait…" : title} onPress={run} disabled={busy} />{error ? <Text accessibilityRole="alert" style={{ color: "#B54747" }}>{error}</Text> : null}</View>;
}
