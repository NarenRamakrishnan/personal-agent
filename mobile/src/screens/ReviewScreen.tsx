import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { actionsApi } from "../api/actions";
import { Badge, Button, Card, Notice, Page, ScreenTitle, SectionHeader } from "../components/Controls";
import { RootStackParamList } from "../navigation/types";
import { triggerText } from "../services/format";
import { colors, spacing, type } from "../theme";
import { Reminder } from "../types/reminder";

type Props = NativeStackScreenProps<RootStackParamList, "Review"> & {
  reminders: Reminder[];
  onDelete: (id: string) => Promise<void>;
  onUpdate: (id: string, changes: Partial<Reminder>) => Promise<void>;
};

// What the person asked to change here. Nothing is applied until Done, so every choice can be undone.
type Pending = "delete" | "reopen" | "discard";

export function ReviewScreen({ navigation, route, reminders, onDelete, onUpdate }: Props) {
  const { detail, unsent = [] } = route.params;
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [saved, setSaved] = useState<Record<string, true>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [saving, setSaving] = useState(false);
  const [lastUndo, setLastUndo] = useState<{ id: string; label: string }>();
  // Show the latest version of each reminder (edits made from this screen land in the store).
  const latest = useMemo(() => new Map(reminders.map(r => [r.id, r])), [reminders]);
  const fresh = (r: Reminder) => latest.get(r.id) ?? r;
  const sessionReminders = detail.reminders.map(fresh);
  const changed = detail.changed.map(fresh).filter(r => !detail.reminders.some(s => s.id === r.id));
  const newItems = sessionReminders.filter(r => !r.completed);
  const updated = changed.filter(r => !r.completed);
  const completed = [...sessionReminders.filter(r => r.completed), ...changed.filter(r => r.completed)];
  // A draft approved or cancelled from the email screen drops off this list on return.
  const [stillPending, setStillPending] = useState<Set<string>>();
  useFocusEffect(useCallback(() => {
    let live = true;
    actionsApi.pending().then(rows => { if (live) setStillPending(new Set(rows.map(a => a.id))); }, () => {});
    return () => { live = false; };
  }, []));
  const drafts = detail.actions.filter(a => a.status === "needs_approval" && (!stillPending || stillPending.has(a.id) || a.id.startsWith("mock-")));
  const total = newItems.length + updated.length + completed.length + drafts.length;

  const mark = (id: string, action: Pending, label: string) => { setPending(p => ({ ...p, [id]: action })); setLastUndo({ id, label }); };
  const undo = (id: string) => { setPending(p => { const next = { ...p }; delete next[id]; return next; }); setLastUndo(undefined); };

  const done = async () => {
    setSaving(true); setFailed({});
    const failures: Record<string, true> = {};
    for (const [id, action] of Object.entries(pending)) {
      if (saved[id]) continue;
      try {
        if (action === "delete") await onDelete(id);
        else if (action === "reopen") await onUpdate(id, { completed: false });
        else await actionsApi.cancel(id);
        setSaved(s => ({ ...s, [id]: true }));
      } catch { failures[id] = true; }
    }
    setSaving(false);
    if (Object.keys(failures).length) { setFailed(failures); return; }
    navigation.navigate("Home", { notice: total ? "Session saved." : undefined });
  };

  const reminderCard = (r: Reminder, kind: "new" | "updated" | "completed") => {
    const state = pending[r.id];
    return <Card key={r.id} style={state ? { backgroundColor: colors.surfaceSubtle } : undefined}>
      <View style={styles.rowBetween}>
        <Badge label={kind === "new" ? "New" : kind === "updated" ? "Updated" : "Completed"} tone={kind} />
        {saved[r.id] ? <Badge label="Saved" tone="completed" /> : failed[r.id] ? <Badge label="Not saved" tone="error" /> : null}
      </View>
      <Text style={[type.cardTitle, state === "delete" && { color: colors.textSecondary }]}>{r.title}</Text>
      <Text style={type.meta}>{state === "delete" ? "Will be deleted" : state === "reopen" ? "Will stay open" : kind === "completed" ? "Marked done" : triggerText(r)}</Text>
      {state ? <Button title="Undo" variant="ghost" compact onPress={() => undo(r.id)} accessibilityLabel={`Undo change to ${r.title}`} style={styles.left} />
        : <View style={styles.actions}>
          {kind !== "completed" ? <Button title="Edit" variant="secondary" compact onPress={() => navigation.navigate("ConfirmReminder", { parsed: { intent: "create_reminder", title: r.title, deadline: r.deadline, triggerType: r.triggerType, location: r.location }, existing: r })} /> : null}
          {kind === "completed" ? <Button title="Not done yet" variant="secondary" compact onPress={() => mark(r.id, "reopen", `${r.title} will stay open.`)} /> : null}
          {kind === "new" ? <Button title="Delete" variant="dangerGhost" compact onPress={() => mark(r.id, "delete", `${r.title} will be deleted.`)} accessibilityLabel={`Delete ${r.title}`} /> : null}
        </View>}
    </Card>;
  };

  const footer = <>
    <Button title={saving ? "Saving…" : "Done"} busy={saving} onPress={() => { void done(); }} />
    <Text style={[type.meta, { textAlign: "center" }]}>Your choices apply when you tap Done. Email drafts stay unsent.</Text>
  </>;

  return <Page footer={footer}>
    <ScreenTitle subtitle={total ? "Here's what I caught. Everything is already saved, so fix anything I got wrong." : undefined}>Review your session</ScreenTitle>
    <Text style={type.meta}>Microphone off</Text>
    {Object.keys(failed).length ? <Notice tone="danger">Some changes couldn't be saved. Your saved changes are marked below. Tap Done to try the rest again.</Notice> : null}
    {lastUndo && pending[lastUndo.id] ? <Notice tone="attention"><Text style={[type.body, { color: colors.accent }]} accessibilityLiveRegion="polite">{lastUndo.label}</Text><Button title="Undo" variant="ghost" compact style={styles.left} onPress={() => undo(lastUndo.id)} /></Notice> : null}
    {detail.pendingChunks > 0 ? <Notice tone="attention">{detail.pendingChunks === 1 ? "One phrase" : `${detail.pendingChunks} phrases`} couldn't be understood yet. Heedly keeps trying and will add any reminders it finds.</Notice> : null}
    {unsent.length ? <Notice tone="danger" title="These didn't reach Heedly">
      {unsent.map((text, i) => <Text key={i} style={[type.body, { color: colors.danger }]}>"{text}"</Text>)}
      <Text style={[type.meta, { color: colors.danger }]}>Check your connection and say or type them again.</Text>
    </Notice> : null}

    {total === 0 ? <View style={styles.empty}>
      <Text style={[type.sectionTitle, { textAlign: "center" }]}>Nothing to review yet.</Text>
      <Text style={[type.body, { color: colors.textSecondary, textAlign: "center" }]}>Try a reminder with a time or place, like "Pick up my prescription when I'm near a pharmacy."</Text>
      <Button title="Start listening" variant="secondary" onPress={() => navigation.replace("Listen")} />
    </View> : null}

    {newItems.length ? <View style={styles.section}><SectionHeader title="New" count={newItems.length} />{newItems.map(r => reminderCard(r, "new"))}</View> : null}
    {updated.length ? <View style={styles.section}><SectionHeader title="Updated" count={updated.length} />{updated.map(r => reminderCard(r, "updated"))}</View> : null}
    {completed.length ? <View style={styles.section}><SectionHeader title="Completed" count={completed.length} />{completed.map(r => reminderCard(r, "completed"))}</View> : null}
    {drafts.length ? <View style={styles.section}>
      <SectionHeader title="Email drafts needing approval" count={drafts.length} />
      {drafts.map(a => {
        const state = pending[a.id];
        return <Card key={a.id} style={state ? { backgroundColor: colors.surfaceSubtle } : undefined}>
          <View style={styles.rowBetween}><Badge label="Needs approval" tone="email" />{saved[a.id] ? <Badge label="Deleted" tone="neutral" /> : null}</View>
          <Text style={type.cardTitle}>{a.email.subject || "Email draft"}</Text>
          <Text style={type.meta}>{a.email.to || a.email.toName ? `To ${a.email.to || a.email.toName}` : "Recipient needed"}</Text>
          <Text style={type.body} numberOfLines={2}>{a.email.body}</Text>
          {state ? <><Text style={type.meta}>Will be deleted</Text><Button title="Undo" variant="ghost" compact style={styles.left} onPress={() => undo(a.id)} /></>
            : <>
              <Text style={type.meta}>Heedly never sends email for you.</Text>
              <View style={styles.actions}>
                <Button title="Review & open mail" variant="secondary" compact onPress={() => navigation.navigate("Email", { draftId: a.id })} />
                <Button title="Delete draft" variant="dangerGhost" compact onPress={() => mark(a.id, "discard", "The email draft will be deleted.")} />
              </View>
            </>}
        </Card>;
      })}
    </View> : null}
  </Page>;
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginTop: spacing.xs },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xxs },
  left: { alignSelf: "flex-start", paddingHorizontal: 0 },
  empty: { gap: spacing.sm, alignItems: "stretch", paddingVertical: spacing.xl },
});
