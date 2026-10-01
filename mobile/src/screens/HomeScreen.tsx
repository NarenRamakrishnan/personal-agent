import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { mockReminders } from "../data/mockReminders";
import { ReminderCard } from "../components/ReminderCard";
import { RootStackParamList } from "../navigation/types";
import { Reminder } from "../types/reminder";

type Props = NativeStackScreenProps<RootStackParamList, "Home"> & { reminders: Reminder[]; onChange: (reminders: Reminder[]) => void };

export function HomeScreen({ navigation, reminders, onChange }: Props) {
  const [showCompleted, setShowCompleted] = useState(false);
  const visibleReminders = showCompleted ? reminders : reminders.filter((reminder) => !reminder.completed);
  const refresh = useCallback(() => onChange(reminders), [onChange, reminders]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>CONTEXT ASSISTANT</Text>
          <Text style={styles.heading}>Your reminders</Text>
        </View>
        <Pressable style={styles.addButton} onPress={() => navigation.navigate("AddReminder")}><Text style={styles.addButtonText}>＋</Text></Pressable>
      </View>
      <View style={styles.toolbar}>
        <Text style={styles.count}>{visibleReminders.length} {visibleReminders.length === 1 ? "reminder" : "reminders"}</Text>
        <Pressable onPress={() => setShowCompleted((value) => !value)}><Text style={styles.filter}>{showCompleted ? "Hide completed" : "Show completed"}</Text></Pressable>
      </View>
      <FlatList
        data={visibleReminders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={visibleReminders.length ? styles.list : styles.emptyList}
        renderItem={({ item }) => <ReminderCard reminder={item} onPress={() => navigation.navigate("ReminderDetail", { reminder: item })} />}
        ListEmptyComponent={<View><Text style={styles.emptyTitle}>Nothing here yet</Text><Text style={styles.emptyBody}>Add a reminder to get started.</Text></View>}
        onRefresh={refresh}
        refreshing={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F7F8FA" },
  header: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: "#377D6A", fontSize: 11, fontWeight: "700", letterSpacing: 1.4 },
  heading: { color: "#18212F", fontSize: 30, fontWeight: "700", marginTop: 6 },
  addButton: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#377D6A" },
  addButtonText: { color: "#FFFFFF", fontSize: 28, fontWeight: "300", marginTop: -3 },
  toolbar: { paddingHorizontal: 20, paddingBottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  count: { color: "#697586", fontSize: 14 },
  filter: { color: "#377D6A", fontSize: 14, fontWeight: "600" },
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  emptyList: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  emptyTitle: { color: "#18212F", fontSize: 20, fontWeight: "700", textAlign: "center" },
  emptyBody: { color: "#697586", fontSize: 15, marginTop: 8, textAlign: "center" },
});
