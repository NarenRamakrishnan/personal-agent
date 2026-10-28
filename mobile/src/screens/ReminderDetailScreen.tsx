import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Text, View } from "react-native";
import { Badge, Button, Card, Chip, Chips, Notice, Page } from "../components/Controls";
import { RootStackParamList } from "../navigation/types";
import { isOverdue, repeatText, triggerText, whenText, whereText } from "../services/format";
import { timezoneLabel } from "../services/humanDate";
import { colors, spacing, type, themedStyles } from "../theme";
import { Reminder } from "../types/reminder";

type Props = NativeStackScreenProps<RootStackParamList, "ReminderDetail"> & {
  reminders: Reminder[];
  onComplete: (id: string, completed: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSnooze: (id: string, until: string) => Promise<void>;
};

function Row({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <View style={styles.row}>
    <Text style={type.fieldLabel}>{label}</Text>
    <Text style={type.body}>{value}</Text>
    {detail ? <Text style={type.meta}>{detail}</Text> : null}
  </View>;
}

export function ReminderDetailScreen({ navigation, route, reminders, onComplete, onDelete, onSnooze }: Props) {
  const reminder = reminders.find(r => r.id === route.params.reminder.id) ?? route.params.reminder;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const run = async (key: string, action: () => Promise<void>, after?: () => void) => {
    setBusy(key); setError("");
    try { await action(); after?.(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Try again."); } finally { setBusy(""); }
  };
  const snoozeTo = (label: string, build: () => Date) => <Chip key={label} label={label} action accessibilityLabel={`Snooze ${label}`}
    onPress={() => { void run(`snooze-${label}`, () => onSnooze(reminder.id, build().toISOString())); }} />;
  const snoozed = reminder.snoozedUntil && Date.parse(reminder.snoozedUntil) > Date.now();
  const place = whereText(reminder.location);

  const footer = <Button title={reminder.completed ? "Mark as active" : "Mark done"} busy={busy === "complete"}
    onPress={() => { void run("complete", () => onComplete(reminder.id, !reminder.completed)); }} />;

  return <Page footer={footer}>
    <View style={{ gap: spacing.xs }}>
      <Badge label={reminder.completed ? "Completed" : isOverdue(reminder) ? "Overdue" : "Active"} tone={reminder.completed ? "completed" : isOverdue(reminder) ? "error" : "new"} />
      <Text accessibilityRole="header" style={type.screenTitle}>{reminder.title}</Text>
      {reminder.description ? <Text style={[type.body, { color: colors.textSecondary }]}>{reminder.description}</Text> : null}
    </View>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <Card style={{ gap: spacing.md }}>
      <Row label="Remind me" value={reminder.location && !reminder.deadline ? `When you're ${place}` : triggerText(reminder)} />
      {reminder.deadline ? <Row label="When" value={new Date(reminder.deadline).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} detail={timezoneLabel(new Date(reminder.deadline))} /> : null}
      {place ? <Row label="Place" value={place.charAt(0).toUpperCase() + place.slice(1)} detail={reminder.location?.radiusMeters ? `Within ${reminder.location.radiusMeters} meters` : undefined} /> : null}
      {snoozed ? <Row label="Snoozed until" value={whenText(reminder.snoozedUntil!)} /> : null}
      {reminder.repeat ? <Row label="Repeats" value={repeatText(reminder)} detail="When you finish it, Heedly sets up the next one." /> : null}
      {reminder.sourceText ? <Row label="From what you said" value={`"${reminder.sourceText.length > 280 ? `${reminder.sourceText.slice(0, 277)}…` : reminder.sourceText}"`} detail="If Heedly got something wrong, fix it with Edit reminder." /> : null}
    </Card>
    <Button title="Edit reminder" variant="secondary" onPress={() => navigation.navigate("ConfirmReminder", { parsed: { intent: "create_reminder", title: reminder.title, deadline: reminder.deadline, triggerType: reminder.triggerType, location: reminder.location, repeat: reminder.repeat }, existing: reminder })} />
    {!reminder.completed ? <View style={{ gap: spacing.xs }}>
      <Text accessibilityRole="header" style={type.sectionTitle}>Snooze</Text>
      <Chips>
        {snoozeTo("10 minutes", () => new Date(Date.now() + 10 * 60000))}
        {snoozeTo("1 hour", () => new Date(Date.now() + 60 * 60000))}
        {snoozeTo("Tomorrow at 9", () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; })}
      </Chips>
      {busy.startsWith("snooze") ? <Text style={type.meta}>Snoozing…</Text> : null}
    </View> : null}
    <Button title={busy === "delete" ? "Deleting…" : "Delete reminder"} variant="dangerGhost" busy={busy === "delete"} onPress={() => { void run("delete", () => onDelete(reminder.id), () => navigation.popTo("Home", { deleted: reminder })); }} />
    <Text style={[type.meta, { textAlign: "center" }]}>You can undo a delete from the home screen.</Text>
  </Page>;
}

const styles = themedStyles(() => ({
  row: { gap: spacing.xxs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
}));
