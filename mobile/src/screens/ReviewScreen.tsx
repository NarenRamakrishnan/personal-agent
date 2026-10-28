import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { actionsApi } from "../api/actions";
import { memoryApi } from "../api/memories";
import { sessionApi } from "../api/sessions";
import { AsyncButton, Badge, Button, Card, FadeIn, Notice, Page, ScreenTitle, SectionHeader } from "../components/Controls";
import { RootStackParamList } from "../navigation/types";
import { contextApi } from "../api/client";
import { memoryTitle, memoryUse, missingInfo, triggerText } from "../services/format";
import { locationEnabled, turnOnLocation } from "../services/locationLifecycle";
import { enableNotifications, notificationStatus, NotificationStatus, reconcileNotifications } from "../services/notifications";
import { colors, radii, spacing, type, themedStyles } from "../theme";
import { Reminder } from "../types/reminder";

type Props = NativeStackScreenProps<RootStackParamList, "Review"> & {
  reminders: Reminder[];
  onDelete: (id: string) => Promise<void>;
  onUpdate: (id: string, changes: Partial<Reminder>) => Promise<void>;
  onRefresh: () => Promise<void>;
};

// What the person asked to change here. Nothing is applied until Done, so every choice can be undone.
type Pending = "delete" | "reopen" | "discard" | "forget";

export function ReviewScreen({ navigation, route, reminders, onDelete, onUpdate, onRefresh }: Props) {
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
  // Saved places, so "remind me at home" can ask where home is if it was never saved.
  const [savedNames, setSavedNames] = useState<string[]>();
  useFocusEffect(useCallback(() => {
    let live = true;
    contextApi.savedPlaces().then(rows => { if (live) setSavedNames(rows.map(p => p.name.toLowerCase())); }, () => {});
    return () => { live = false; };
  }, []));
  // Ask for notifications and location right here, when a reminder actually needs them.
  const [alerts, setAlerts] = useState<NotificationStatus>();
  const [locationOn, setLocationOn] = useState<boolean>();
  useFocusEffect(useCallback(() => {
    let live = true;
    notificationStatus().then(value => { if (live) setAlerts(value); }, () => {});
    locationEnabled().then(value => { if (live) setLocationOn(value); }, () => {});
    return () => { live = false; };
  }, []));
  const active = [...newItems, ...updated].filter(r => !pending[r.id]);
  const askAlerts = alerts === "default" && active.some(r => r.deadline);
  const askLocation = locationOn === false && active.some(r => r.location);
  const needsDetail = [...newItems, ...updated].filter(r => !pending[r.id] && missingInfo(r, savedNames)).length;
  const drafts = detail.actions.filter(a => a.status === "needs_approval" && (!stillPending || stillPending.has(a.id) || a.id.startsWith("mock-")));
  const learned = detail.learned ?? [];
  const total = newItems.length + updated.length + completed.length + drafts.length + learned.length;

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
        else if (action === "forget") await memoryApi.forget(id);
        else await actionsApi.cancel(id);
        setSaved(s => ({ ...s, [id]: true }));
      } catch { failures[id] = true; }
    }
    setSaving(false);
    if (Object.keys(failures).length) { setFailed(failures); return; }
    navigation.navigate("Home", { notice: total ? "Session saved." : undefined });
  };

  // Cards arrive one after another, capped so a long list doesn't make anyone wait.
  let shown = 0;
  const arrive = (card: React.ReactElement) => <FadeIn key={card.key} delay={Math.min(shown++, 5) * 50}>{card}</FadeIn>;
  const summary = [
    newItems.length ? `${newItems.length} new` : "",
    updated.length ? `${updated.length} updated` : "",
    completed.length ? `${completed.length} done` : "",
    drafts.length ? `${drafts.length} email ${drafts.length === 1 ? "draft" : "drafts"}` : "",
    learned.length ? `${learned.length} learned` : "",
  ].filter(Boolean);

  const reminderCard = (r: Reminder, kind: "new" | "updated" | "completed") => {
    const state = pending[r.id];
    const miss = state || kind === "completed" ? undefined : missingInfo(r, savedNames);
    const edit = () => navigation.navigate("ConfirmReminder", { parsed: { intent: "create_reminder", title: r.title, deadline: r.deadline, triggerType: r.triggerType, location: r.location, repeat: r.repeat }, existing: r });
    const fixTitle = miss?.kind === "time" ? "Add a time" : miss?.kind === "place" ? "Add a place" : miss?.kind === "both" ? "Add a time or place" : miss ? `Save where ${miss.label.replace(/^Where is |\?$/g, "")} is` : "";
    return <Card key={r.id} style={state ? { backgroundColor: colors.surfaceSubtle } : miss ? { borderColor: colors.accent } : undefined}>
      <View style={styles.rowBetween}>
        <View style={styles.badges}>
          <Badge label={kind === "new" ? "New" : kind === "updated" ? "Updated" : "Completed"} tone={kind} />
          {miss ? <Badge label={miss.label} tone="updated" /> : null}
        </View>
        {saved[r.id] ? <Badge label="Saved" tone="completed" /> : failed[r.id] ? <Badge label="Not saved" tone="error" /> : null}
      </View>
      <Text style={[type.cardTitle, state === "delete" && { color: colors.textSecondary }]}>{r.title}</Text>
      <Text style={type.meta}>{state === "delete" ? "Will be deleted" : state === "reopen" ? "Will stay open" : kind === "completed" ? "Marked done" : triggerText(r)}</Text>
      {miss ? <Text style={[type.meta, { color: colors.accent }]}>{miss.hint}</Text> : null}
      {state ? <Button title="Undo" variant="ghost" compact onPress={() => undo(r.id)} accessibilityLabel={`Undo change to ${r.title}`} style={styles.left} />
        : <View style={styles.actions}>
          {miss ? <Button title={fixTitle} compact accessibilityLabel={`${fixTitle} for ${r.title}`} onPress={miss.kind === "unknown_place" ? () => navigation.navigate("Location") : edit} /> : null}
          {kind !== "completed" ? <Button title="Edit" variant="secondary" compact onPress={edit} /> : null}
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
    <ScreenTitle subtitle={total ? "Here's what I caught. It's already saved, so just fix anything I got wrong." : undefined}>Review your session</ScreenTitle>
    {summary.length ? <FadeIn><View style={styles.summary} accessibilityLabel={`Caught: ${summary.join(", ")}`}>
      {summary.map(part => <Text key={part} style={styles.summaryPart}>{part}</Text>)}
    </View></FadeIn> : null}
    <Text style={type.meta}>Microphone off</Text>
    {needsDetail ? <Notice tone="attention" title={needsDetail === 1 ? "One reminder needs more detail" : `${needsDetail} reminders need more detail`}>
      <Text style={[type.meta, { color: colors.accent }]}>Heedly can only remind you with a time or a place. They're marked below.</Text>
    </Notice> : null}
    {Object.keys(failed).length ? <Notice tone="danger">Some changes couldn't be saved. Your saved changes are marked below. Tap Done to try the rest again.</Notice> : null}
    {lastUndo && pending[lastUndo.id] ? <Notice tone="attention"><Text style={[type.body, { color: colors.accent }]} accessibilityLiveRegion="polite">{lastUndo.label}</Text><Button title="Undo" variant="ghost" compact style={styles.left} onPress={() => undo(lastUndo.id)} /></Notice> : null}
    {detail.pendingChunks > 0 ? <Notice tone="attention" title="Heedly is still working on part of what you said">
      <Text style={[type.meta, { color: colors.accent }]}>The AI took too long on {detail.pendingChunks === 1 ? "one part" : `${detail.pendingChunks} parts`}. Nothing is lost. Check again in a moment and any reminders it finds will appear here.</Text>
      <AsyncButton title="Check again" busyTitle="Checking…" variant="secondary" compact action={async () => {
        const next = await sessionApi.retry(detail.id);
        navigation.setParams({ detail: next }); await onRefresh().catch(() => {});
        if (next.pendingChunks > 0) throw new Error("Still working on it. Try again in a few seconds.");
      }} />
    </Notice> : null}
    {unsent.length ? <Notice tone="danger" title="These didn't reach Heedly">
      {unsent.map((text, i) => <Text key={i} style={[type.body, { color: colors.danger }]}>"{text}"</Text>)}
      <Text style={[type.meta, { color: colors.danger }]}>Check your connection and say or type them again.</Text>
    </Notice> : null}

    {total === 0 ? <View style={styles.empty}>
      <Text style={[type.sectionTitle, { textAlign: "center" }]}>Nothing to review yet.</Text>
      <Text style={[type.body, { color: colors.textSecondary, textAlign: "center" }]}>Try a reminder with a time or place, like "Pick up my prescription when I'm near a pharmacy."</Text>
      <Button title="Start listening" variant="secondary" onPress={() => navigation.replace("Listen")} />
    </View> : null}

    {newItems.length ? <View style={styles.section}><SectionHeader title="New" count={newItems.length} />{newItems.map(r => arrive(reminderCard(r, "new")))}</View> : null}
    {updated.length ? <View style={styles.section}><SectionHeader title="Updated" count={updated.length} />{updated.map(r => arrive(reminderCard(r, "updated")))}</View> : null}
    {completed.length ? <View style={styles.section}><SectionHeader title="Completed" count={completed.length} />{completed.map(r => arrive(reminderCard(r, "completed")))}</View> : null}
    {drafts.length ? <View style={styles.section}>
      <SectionHeader title="Email drafts needing approval" count={drafts.length} />
      {drafts.map(a => {
        const state = pending[a.id];
        return arrive(<Card key={a.id} style={state ? { backgroundColor: colors.surfaceSubtle } : undefined}>
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
        </Card>);
      })}
    </View> : null}
    {learned.length ? <View style={styles.section}>
      <SectionHeader title="Heedly learned" count={learned.length} />
      {learned.map(m => {
        const state = pending[m.id];
        return arrive(<Card key={m.id} style={state ? { backgroundColor: colors.surfaceSubtle } : undefined}>
          <View style={styles.rowBetween}><Badge label={m.kind === "person" ? "Person" : "Usual place"} tone="new" />{saved[m.id] ? <Badge label="Forgotten" tone="neutral" /> : null}</View>
          <Text style={[type.cardTitle, state && { color: colors.textSecondary }]}>{memoryTitle(m)}</Text>
          <Text style={type.meta}>{state ? "Will be forgotten" : memoryUse(m)}</Text>
          {state ? <Button title="Undo" variant="ghost" compact style={styles.left} onPress={() => undo(m.id)} accessibilityLabel={`Keep ${m.label}`} />
            : <Button title="Forget" variant="dangerGhost" compact style={styles.left} accessibilityLabel={`Forget ${m.label}`} onPress={() => mark(m.id, "forget", `Heedly will forget ${m.label}.`)} />}
        </Card>);
      })}
    </View> : null}
    {askAlerts || askLocation ? <Notice tone="success" title="So Heedly can actually remind you">
      <Text style={[type.meta, { color: colors.success }]}>{askAlerts && askLocation ? "Turn on notifications for the timed reminders and location for the place ones." : askAlerts ? "Notifications are off, so Heedly can't tell you when these are due." : "Place reminders need your location. Heedly checks every couple of minutes, not constantly."}</Text>
      <View style={styles.actions}>
        {askAlerts ? <AsyncButton title="Turn on notifications" compact action={async () => {
          await enableNotifications().finally(() => notificationStatus().then(setAlerts, () => {}));
          await reconcileNotifications(reminders);
        }} /> : null}
        {askLocation ? <AsyncButton title="Turn on location" compact variant={askAlerts ? "secondary" : "primary"} action={async () => { await turnOnLocation(); setLocationOn(true); }} /> : null}
      </View>
    </Notice> : null}
  </Page>;
}

const styles = themedStyles(() => ({
  section: { gap: spacing.sm, marginTop: spacing.xs },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xxs },
  left: { alignSelf: "flex-start", paddingHorizontal: 0 },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  summaryPart: { ...type.fieldLabel, color: colors.brandGreen, backgroundColor: colors.successSurface, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, overflow: "hidden" },
  empty: { gap: spacing.sm, alignItems: "stretch", paddingVertical: spacing.xl },
}));
