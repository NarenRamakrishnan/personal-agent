import { Pressable, StyleSheet, Text, View } from "react-native";
import { Reminder } from "../types/reminder";

type Props = { reminder: Reminder; onPress: () => void };

export function ReminderCard({ reminder, onPress }: Props) {
  const location = reminder.location?.name ?? reminder.location?.category;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={[styles.checkbox, reminder.completed && styles.checkboxCompleted]}>
        {reminder.completed && <Text style={styles.checkmark}>✓</Text>}
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, reminder.completed && styles.completedText]}>{reminder.title}</Text>
        {reminder.deadline && <Text style={styles.meta}>{new Date(reminder.deadline).toLocaleString()}</Text>}
        {location && <Text style={styles.meta}>{location}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, marginBottom: 12 },
  pressed: { opacity: 0.7 },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: "#A6B0BF", marginRight: 12, alignItems: "center", justifyContent: "center" },
  checkboxCompleted: { backgroundColor: "#377D6A", borderColor: "#377D6A" },
  checkmark: { color: "#FFFFFF", fontWeight: "700" },
  content: { flex: 1 },
  title: { color: "#18212F", fontSize: 16, fontWeight: "600" },
  completedText: { color: "#8A94A3", textDecorationLine: "line-through" },
  meta: { color: "#697586", fontSize: 13, marginTop: 4 },
});
