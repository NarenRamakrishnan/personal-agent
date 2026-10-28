import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { memoryApi } from "../api/memories";
import { AsyncButton, Badge, Button, Card, FadeIn, Field, Notice, Page, ScreenTitle, SectionHeader, errorMessage } from "../components/Controls";
import { RootStackParamList } from "../navigation/types";
import { linkedReminders, memoryTitle, memoryUse, repeatText, triggerText } from "../services/format";
import { colors, radii, spacing, type, themedStyles } from "../theme";
import { Memory } from "../types/memory";
import { Reminder } from "../types/reminder";

type Props = NativeStackScreenProps<RootStackParamList, "Memory"> & { reminders: Reminder[] };

const EXAMPLES = [
  "My mom's email is priya@example.com",
  "I always get groceries at Trader Joe's",
  "Take out the trash every Monday at 8pm",
];

// One remembered fact and the reminders it's connected to.
function MemoryCard({ memory, links, onForget, onSaved, onOpen }: {
  memory: Memory; links: Reminder[]; onForget: () => void; onSaved: (m: Memory) => void; onOpen: (r: Reminder) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(memory.kind === "person" ? memory.email ?? "" : memory.placeName ?? "");
  const person = memory.kind === "person";
  return <Card>
    <View style={styles.rowBetween}>
      <Badge label={person ? "Person" : "Usual place"} tone={person ? "email" : "new"} />
      {links.length ? <Text style={type.meta}>{links.length} {links.length === 1 ? "reminder" : "reminders"}</Text> : null}
    </View>
    <Text style={type.cardTitle}>{memoryTitle(memory)}</Text>
    <Text style={type.meta}>{memoryUse(memory)}</Text>
    {links.length ? <View style={styles.links} accessibilityLabel={`Connected to ${links.map(r => r.title).join(", ")}`}>
      {links.slice(0, 4).map(r => <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={`Open reminder: ${r.title}`} onPress={() => onOpen(r)}
        style={({ pressed }) => [styles.link, pressed && { backgroundColor: colors.surfaceSubtle }]}>
        <View style={styles.dot} /><Text style={[type.meta, { color: colors.textPrimary, flexShrink: 1 }]} numberOfLines={1}>{r.title}</Text>
      </Pressable>)}
    </View> : null}
    {editing ? <View style={{ gap: spacing.xs }}>
      <Field label={person ? `${memory.label}'s email` : `Where you go for ${memory.label}`} value={value} onChangeText={setValue}
        keyboardType={person ? "email-address" : "default"} autoFocus placeholder={person ? "name@example.com" : "Trader Joe's"} />
      <View style={styles.actions}>
        <AsyncButton title="Save" compact action={async () => {
          const next = await memoryApi.update(memory.id, person ? { email: value.trim() || undefined } : { placeName: value.trim() });
          onSaved(next); setEditing(false);
        }} />
        <Button title="Cancel" variant="ghost" compact onPress={() => setEditing(false)} />
      </View>
    </View> : <View style={styles.actions}>
      <Button title={person ? (memory.email ? "Change email" : "Add email") : "Change place"} variant="secondary" compact onPress={() => setEditing(true)} />
      <Button title="Forget" variant="dangerGhost" compact accessibilityLabel={`Forget ${memory.label}`} onPress={onForget} />
    </View>}
  </Card>;
}

export function MemoryScreen({ navigation, reminders }: Props) {
  const [rows, setRows] = useState<Memory[]>();
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<Memory>();
  const load = useCallback(() => { setError(""); memoryApi.list().then(setRows, e => setError(errorMessage(e))); }, []);
  useFocusEffect(load);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(undefined), 8000);
    return () => clearTimeout(timer);
  }, [undo]);

  const open = reminders.filter(r => !r.completed);
  const people = rows?.filter(m => m.kind === "person") ?? [];
  const placeFacts = rows?.filter(m => m.kind === "place") ?? [];
  const repeating = open.filter(r => r.repeat);
  const forget = async (m: Memory) => {
    setRows(current => current?.filter(x => x.id !== m.id));
    try { await memoryApi.forget(m.id); setUndo(m); } catch (e) { setError(errorMessage(e)); load(); }
  };
  const putBack = async (m: Memory) => {
    setUndo(undefined);
    try { await memoryApi.add({ kind: m.kind, label: m.label, alias: m.alias, email: m.email, placeName: m.placeName, placeType: m.placeType }); load(); }
    catch (e) { setError(errorMessage(e)); }
  };
  const card = (m: Memory) => <FadeIn key={m.id}><MemoryCard memory={m} links={linkedReminders(m, open)} onForget={() => { void forget(m); }}
    onSaved={next => setRows(current => current?.map(x => x.id === next.id ? next : x))} onOpen={r => navigation.navigate("ReminderDetail", { reminder: r })} /></FadeIn>;
  const empty = rows !== undefined && !rows.length && !repeating.length;

  return <Page>
    <ScreenTitle subtitle="Things you've told Heedly, so it can do more with less. Only this device can see them.">What Heedly remembers</ScreenTitle>
    {error ? <Notice tone="danger" title="We couldn't load what Heedly remembers."><Text style={[type.meta, { color: colors.danger }]}>{error}</Text><Button title="Try again" variant="secondary" compact onPress={load} /></Notice> : null}
    {undo ? <FadeIn><View style={styles.undo} accessibilityLiveRegion="polite">
      <Text style={[type.body, { flex: 1 }]}>Forgot {undo.label}.</Text>
      <Button title="Undo" variant="ghost" compact onPress={() => { void putBack(undo); }} />
    </View></FadeIn> : null}

    {rows !== undefined && !empty ? <View style={styles.stats} accessibilityLabel={`${people.length} people, ${placeFacts.length} usual places, ${repeating.length} repeating`}>
      {[[people.length, people.length === 1 ? "person" : "people"], [placeFacts.length, placeFacts.length === 1 ? "usual place" : "usual places"], [repeating.length, "repeating"]].map(([n, label]) =>
        <View key={label} style={styles.stat}><Text style={[type.sectionTitle, { color: colors.brandGreen }]}>{n}</Text><Text style={type.meta}>{label}</Text></View>)}
    </View> : null}

    {rows === undefined && !error ? <Text style={type.meta}>Loading…</Text> : null}
    {empty ? <View style={styles.empty}>
      <Text style={[type.sectionTitle, { textAlign: "center" }]}>Nothing yet.</Text>
      <Text style={[type.body, { color: colors.textSecondary, textAlign: "center" }]}>Heedly learns when you mention things like these while you talk:</Text>
      {EXAMPLES.map(e => <Text key={e} style={[type.body, { textAlign: "center" }]}>"{e}"</Text>)}
    </View> : null}

    {people.length ? <View style={styles.section}><SectionHeader title="People" count={people.length} />{people.map(card)}</View> : null}
    {placeFacts.length ? <View style={styles.section}><SectionHeader title="Usual places" count={placeFacts.length} />{placeFacts.map(card)}</View> : null}
    {repeating.length ? <View style={styles.section}>
      <SectionHeader title="Repeating" count={repeating.length} />
      {repeating.map(r => <FadeIn key={r.id}><Card>
        <Badge label={repeatText(r)} tone="updated" />
        <Text style={type.cardTitle}>{r.title}</Text>
        <Text style={type.meta}>Next: {triggerText({ ...r, repeat: undefined })}</Text>
        <Button title="Open" variant="secondary" compact style={{ alignSelf: "flex-start" }} onPress={() => navigation.navigate("ReminderDetail", { reminder: r })} />
      </Card></FadeIn>)}
    </View> : null}

    <Button title="Tell Heedly something" variant={empty ? "primary" : "ghost"} onPress={() => navigation.navigate("Listen", { typing: true })} />
    <Text style={[type.meta, { textAlign: "center" }]}>Deleting your data in Privacy & data also clears this.</Text>
  </Page>;
}

const styles = themedStyles(() => ({
  section: { gap: spacing.sm },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xxs },
  links: { borderLeftWidth: 2, borderLeftColor: colors.border, marginLeft: spacing.xxs, paddingLeft: spacing.sm, gap: 2 },
  link: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 32, borderRadius: radii.small, paddingRight: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brandGreen, marginLeft: -(spacing.sm + 5) },
  stats: { flexDirection: "row", gap: spacing.xs },
  stat: { flex: 1, alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, paddingVertical: spacing.sm },
  undo: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceSubtle, borderRadius: radii.card, paddingLeft: spacing.md, paddingRight: spacing.xxs, minHeight: 56 },
  empty: { gap: spacing.xs, paddingVertical: spacing.lg },
}));
