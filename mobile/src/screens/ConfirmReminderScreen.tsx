import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Text, View } from "react-native";
import { RootStackParamList } from "../navigation/types";
import { Reminder, ReminderLocation, ReminderTriggerType } from "../types/reminder";
import { AsyncButton, Button, Field, Page } from "../components/Controls";
type Props = NativeStackScreenProps<RootStackParamList, "ConfirmReminder"> & { onSave: (reminder: Reminder) => Promise<void> };
export function ConfirmReminderScreen({ navigation, route, onSave }: Props) {
  const parsed = route.params.parsed;
  const [title, setTitle] = useState(parsed.title);
  const [deadline, setDeadline] = useState(parsed.deadline ?? "");
  const [trigger, setTrigger] = useState<ReminderTriggerType>(parsed.triggerType);
  const [locationType, setLocationType] = useState<ReminderLocation["type"]>(parsed.location?.type ?? "place");
  const [location, setLocation] = useState(parsed.location?.category ?? parsed.location?.name ?? "");
  const [id] = useState(() => `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return <Page><Text style={{ fontSize: 28, fontWeight: "700" }}>Confirm reminder</Text>
    <Field label="Title" value={title} onChangeText={setTitle} />
    <Field label="Deadline (ISO date with timezone, or leave empty)" value={deadline} onChangeText={setDeadline} />
    <Text>Trigger</Text>{(["time", "location", "time_and_location"] as const).map(type => <Button key={type} title={`${trigger === type ? "✓ " : ""}${type.replaceAll("_", " ")}`} onPress={() => setTrigger(type)} />)}
    {trigger !== "time" && <View style={{ gap: 12 }}><Text>Location type</Text>{(["place", "category", "saved_place", "coordinate"] as const).map(type => <Button key={type} title={`${locationType === type ? "✓ " : ""}${type}`} onPress={() => setLocationType(type)} />)}<Field label={locationType === "category" ? "Category (e.g. grocery_store)" : "Location name"} value={location} onChangeText={setLocation} /></View>}
    <AsyncButton title="Save reminder" action={async () => {
      if (!title.trim()) throw new Error("A title is required.");
      if (deadline && (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(deadline) || Number.isNaN(Date.parse(deadline)))) throw new Error("Enter an ISO date with a timezone, such as 2026-10-10T20:00:00-07:00.");
      if (trigger !== "time" && !location.trim() && locationType !== "coordinate") throw new Error("A location is required for this trigger.");
      if (trigger !== "time" && locationType === "coordinate" && (parsed.location?.latitude === undefined || parsed.location?.longitude === undefined)) throw new Error("Choose a named or saved place; this reminder has no coordinates.");
      await onSave({ id, title: title.trim(), createdAt: new Date().toISOString(), deadline: deadline ? new Date(deadline).toISOString() : undefined, triggerType: trigger,
        location: trigger === "time" ? undefined : { ...parsed.location, type: locationType, name: locationType === "category" ? undefined : location.trim(), category: locationType === "category" ? location.trim() : undefined }, completed: false });
      if (parsed.additional?.length) navigation.replace("ConfirmReminder", { parsed: { ...parsed.additional[0], additional: parsed.additional.slice(1) } });
      else navigation.popToTop();
    }} />
    {parsed.additional?.length ? <Text>{parsed.additional.length} more reminders to review after this one.</Text> : null}
    <Button title="Edit command" onPress={() => navigation.goBack()} /><Button title="Cancel" onPress={() => navigation.popToTop()} />
  </Page>;
}
