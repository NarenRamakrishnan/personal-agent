import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Text } from "react-native";
import { RootStackParamList } from "../navigation/types";
import { reminderApi, USE_MOCKS } from "../api/client";
import { AsyncButton, Field, Page } from "../components/Controls";
export function AddReminderScreen({ navigation }: NativeStackScreenProps<RootStackParamList, "AddReminder">) {
  const [text, setText] = useState("");
  return <Page><Text style={{ fontSize: 28, fontWeight: "700" }}>Add a reminder</Text>
    {USE_MOCKS && <Text>Demo mode: reminders are stored on this device.</Text>}
    <Field label="What should I remember?" value={text} onChangeText={setText} multiline />
    <AsyncButton title="Review reminder" action={async () => {
      if (!text.trim()) throw new Error("Enter a reminder first.");
      navigation.navigate("ConfirmReminder", { parsed: await reminderApi.parse(text) });
    }} />
  </Page>;
}
