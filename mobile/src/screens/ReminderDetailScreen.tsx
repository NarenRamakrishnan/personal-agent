import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Text, View } from "react-native";
import { RootStackParamList } from "../navigation/types";
import { Reminder } from "../types/reminder";
import { AsyncButton, Button, Page } from "../components/Controls";
type Props = NativeStackScreenProps<RootStackParamList, "ReminderDetail"> & { reminders: Reminder[]; onComplete: (id: string) => Promise<void>; onDelete: (id: string) => Promise<void>; onSnooze: (id: string, until: string) => Promise<void> };
export function ReminderDetailScreen({ navigation, route, reminders, onComplete, onDelete, onSnooze }: Props) {
  const reminder = reminders.find(r => r.id === route.params.reminder.id) ?? route.params.reminder;
  const [deleting, setDeleting] = useState(false);
  return <Page><Text style={{ fontSize: 28, fontWeight: "700" }}>{reminder.title}</Text>
    <Text>{reminder.completed ? "Completed" : "Active"}</Text><Text>{reminder.description}</Text>
    <Text>Deadline: {reminder.deadline ? new Date(reminder.deadline).toLocaleString() : "None"}</Text>
    <Text>Trigger: {reminder.triggerType}</Text><Text>Location: {reminder.location?.name ?? reminder.location?.category ?? "None"}</Text>
    <Text>Snoozed until: {reminder.snoozedUntil ? new Date(reminder.snoozedUntil).toLocaleString() : "Not snoozed"}</Text>
    {!reminder.completed && <View style={{ gap: 12 }}><AsyncButton title="Mark complete" action={() => onComplete(reminder.id)} />
      {[10, 60].map(minutes => <AsyncButton key={minutes} title={`Snooze ${minutes} minutes`} action={() => onSnooze(reminder.id, new Date(Date.now() + minutes * 60000).toISOString())} />)}
      <AsyncButton title="Snooze until tomorrow at 9 AM" action={() => { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0); return onSnooze(reminder.id, tomorrow.toISOString()); }} />
    </View>}
    <Button title="Delete reminder" onPress={() => setDeleting(true)} />
    {deleting && <View style={{ gap: 10 }}><Text>Delete this reminder permanently?</Text><AsyncButton title="Confirm delete" action={async () => { await onDelete(reminder.id); navigation.popToTop(); }} /><Button title="Keep reminder" onPress={() => setDeleting(false)} /></View>}
  </Page>;
}
