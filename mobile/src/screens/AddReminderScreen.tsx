import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Alert, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { RootStackParamList } from "../navigation/types";
import { Reminder } from "../types/reminder";
import { createReminderApi } from "../api/client";

type Props = NativeStackScreenProps<RootStackParamList, "AddReminder"> & { onSave: (reminder: Reminder) => void };
const reminderApi = createReminderApi(process.env.EXPO_PUBLIC_USE_MOCKS !== "false");

export function AddReminderScreen({ navigation, onSave }: Props) {
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const parse = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert("Add a title", "Enter something you want to remember.");
      return;
    }
    setLoading(true);
    try {
      const parsed = await reminderApi.parse(trimmedTitle);
      navigation.navigate("ConfirmReminder", { parsed });
    } catch (error) {
      Alert.alert("Could not parse reminder", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.heading}>Add a reminder</Text>
        <Text style={styles.help}>Describe what you want to remember, including when or where it should trigger.</Text>
        <TextInput autoFocus value={title} onChangeText={setTitle} placeholder="Remind me to buy milk tomorrow at 5" placeholderTextColor="#8A94A3" style={styles.input} onSubmitEditing={parse} returnKeyType="done" />
        <Pressable disabled={loading} onPress={parse} style={[styles.save, loading && styles.disabled]}><Text style={styles.saveText}>{loading ? "Parsing…" : "Continue"}</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F7F8FA" },
  container: { padding: 20 },
  heading: { color: "#18212F", fontSize: 28, fontWeight: "700" },
  help: { color: "#697586", fontSize: 15, lineHeight: 22, marginTop: 10, marginBottom: 24 },
  input: { backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#D8DEE8", color: "#18212F", fontSize: 16, minHeight: 56, paddingHorizontal: 16 },
  save: { alignItems: "center", backgroundColor: "#377D6A", borderRadius: 14, marginTop: 16, paddingVertical: 16 },
  saveText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.6 },
});
