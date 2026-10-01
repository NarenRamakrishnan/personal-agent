import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Alert, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { RootStackParamList } from "../navigation/types";
import { Reminder } from "../types/reminder";

type Props = NativeStackScreenProps<RootStackParamList, "AddReminder"> & { onSave: (reminder: Reminder) => void };

export function AddReminderScreen({ navigation, onSave }: Props) {
  const [title, setTitle] = useState("");
  const save = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert("Add a title", "Enter something you want to remember.");
      return;
    }
    onSave({ id: `local-${Date.now()}`, title: trimmedTitle, createdAt: new Date().toISOString(), triggerType: "time", completed: false });
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.heading}>Add a reminder</Text>
        <Text style={styles.help}>For Day 1, reminders are created locally. Natural-language parsing comes next.</Text>
        <TextInput autoFocus value={title} onChangeText={setTitle} placeholder="What do you want to remember?" placeholderTextColor="#8A94A3" style={styles.input} onSubmitEditing={save} returnKeyType="done" />
        <Pressable onPress={save} style={styles.save}><Text style={styles.saveText}>Save reminder</Text></Pressable>
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
});
