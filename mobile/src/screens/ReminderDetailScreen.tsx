import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { RootStackParamList } from "../navigation/types";
import { Reminder } from "../types/reminder";

type Props = NativeStackScreenProps<RootStackParamList, "ReminderDetail"> & { onComplete: (id: string) => void; onDelete: (id: string) => void; onSnooze: (id: string, until: string) => void };

export function ReminderDetailScreen({ navigation, route, onComplete, onDelete, onSnooze }: Props) {
  const { reminder } = route.params;
  const [snoozedUntil, setSnoozedUntil] = useState(reminder.snoozedUntil);
  const location = reminder.location?.name ?? reminder.location?.category;
  const remove = () => Alert.alert("Delete reminder?", "This cannot be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => { onDelete(reminder.id); navigation.popToTop(); } }]);
  const snooze = () => Alert.alert("Snooze reminder", "Choose a snooze duration.", [
    { text: "10 minutes", onPress: () => { const until = new Date(Date.now() + 10 * 60 * 1000).toISOString(); setSnoozedUntil(until); onSnooze(reminder.id, until); } },
    { text: "1 hour", onPress: () => { const until = new Date(Date.now() + 60 * 60 * 1000).toISOString(); setSnoozedUntil(until); onSnooze(reminder.id, until); } },
    { text: "Tomorrow", onPress: () => { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0); const until = tomorrow.toISOString(); setSnoozedUntil(until); onSnooze(reminder.id, until); } },
    { text: "Cancel", style: "cancel" },
  ]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.badge}><Text style={styles.badgeText}>{reminder.completed ? "COMPLETED" : "ACTIVE"}</Text></View>
        <Text style={styles.title}>{reminder.title}</Text>
        {reminder.description && <Text style={styles.description}>{reminder.description}</Text>}
        <View style={styles.details}>
          <Detail label="Trigger" value={reminder.triggerType.replaceAll("_", " ")} />
          <Detail label="Deadline" value={reminder.deadline ? new Date(reminder.deadline).toLocaleString() : "Not set"} />
          <Detail label="Location" value={location ?? "Not set"} />
          <Detail label="Snoozed until" value={snoozedUntil ? new Date(snoozedUntil).toLocaleString() : "Not snoozed"} />
        </View>
        {!reminder.completed && <Pressable style={styles.complete} onPress={() => { onComplete(reminder.id); navigation.goBack(); }}><Text style={styles.completeText}>Mark complete</Text></Pressable>}
        {!reminder.completed && <Pressable style={styles.snooze} onPress={snooze}><Text style={styles.snoozeText}>Snooze</Text></Pressable>}
        <Pressable style={styles.delete} onPress={remove}><Text style={styles.deleteText}>Delete reminder</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <View style={styles.detail}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F7F8FA" },
  container: { padding: 20 },
  badge: { alignSelf: "flex-start", backgroundColor: "#E2F1EC", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  badgeText: { color: "#377D6A", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  title: { color: "#18212F", fontSize: 30, fontWeight: "700", marginTop: 20 },
  description: { color: "#697586", fontSize: 16, lineHeight: 23, marginTop: 10 },
  details: { backgroundColor: "#FFFFFF", borderRadius: 16, marginTop: 28, padding: 16 },
  detail: { borderBottomColor: "#EEF1F4", borderBottomWidth: 1, paddingVertical: 12 },
  label: { color: "#8A94A3", fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  value: { color: "#18212F", fontSize: 16, marginTop: 4, textTransform: "capitalize" },
  complete: { alignItems: "center", backgroundColor: "#377D6A", borderRadius: 14, marginTop: 24, paddingVertical: 16 },
  completeText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  delete: { alignItems: "center", marginTop: 18, paddingVertical: 12 },
  deleteText: { color: "#B54747", fontSize: 15, fontWeight: "600" },
  snooze: { alignItems: "center", marginTop: 10, paddingVertical: 12 },
  snoozeText: { color: "#377D6A", fontSize: 15, fontWeight: "600" },
});
