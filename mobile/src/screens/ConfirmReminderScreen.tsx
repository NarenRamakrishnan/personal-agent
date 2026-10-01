import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { RootStackParamList } from "../navigation/types";
import { Reminder } from "../types/reminder";

type Props = NativeStackScreenProps<RootStackParamList, "ConfirmReminder"> & { onSave: (reminder: Reminder) => void };

export function ConfirmReminderScreen({ navigation, route, onSave }: Props) {
  const { parsed } = route.params;
  const [title, setTitle] = useState(parsed.title);
  const [deadline, setDeadline] = useState(parsed.deadline ?? "");
  const [location, setLocation] = useState(parsed.location?.name ?? parsed.location?.category ?? "");
  const save = () => {
    onSave({
      id: `local-${Date.now()}`,
      title: title.trim() || parsed.title,
      createdAt: new Date().toISOString(),
      deadline: deadline.trim() || undefined,
      triggerType: parsed.triggerType,
      location: location.trim() ? { type: parsed.location?.type ?? "place", name: location.trim() } : parsed.location,
      completed: false,
    });
    navigation.popToTop();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.heading}>Confirm reminder</Text>
        <Text style={styles.help}>Review the parsed reminder and make any changes before saving.</Text>
        <Field label="Title" value={title} onChangeText={setTitle} />
        <Field label="Deadline" value={deadline} onChangeText={setDeadline} placeholder="Optional" />
        <Field label="Location" value={location} onChangeText={setLocation} placeholder="Optional" />
        <View style={styles.summary}><Text style={styles.summaryLabel}>Trigger</Text><Text style={styles.summaryValue}>{parsed.triggerType.replaceAll("_", " ")}</Text></View>
        <Pressable onPress={save} style={styles.save}><Text style={styles.saveText}>Save reminder</Text></Pressable>
        <Pressable onPress={() => navigation.goBack()} style={styles.cancel}><Text style={styles.cancelText}>Edit command</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#8A94A3" style={styles.input} /></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F7F8FA" },
  container: { padding: 20 },
  heading: { color: "#18212F", fontSize: 28, fontWeight: "700" },
  help: { color: "#697586", fontSize: 15, lineHeight: 22, marginTop: 10, marginBottom: 24 },
  field: { marginBottom: 18 },
  label: { color: "#697586", fontSize: 13, fontWeight: "600", marginBottom: 7 },
  input: { backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#D8DEE8", color: "#18212F", fontSize: 16, minHeight: 52, paddingHorizontal: 16 },
  summary: { backgroundColor: "#E2F1EC", borderRadius: 14, padding: 16, marginTop: 4 },
  summaryLabel: { color: "#377D6A", fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  summaryValue: { color: "#18212F", fontSize: 16, marginTop: 5, textTransform: "capitalize" },
  save: { alignItems: "center", backgroundColor: "#377D6A", borderRadius: 14, marginTop: 22, paddingVertical: 16 },
  saveText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  cancel: { alignItems: "center", marginTop: 14, paddingVertical: 12 },
  cancelText: { color: "#377D6A", fontSize: 15, fontWeight: "600" },
});
