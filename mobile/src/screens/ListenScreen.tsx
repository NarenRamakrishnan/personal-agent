import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Linking, StyleSheet, Text, View } from "react-native";
import { sessionApi } from "../api/sessions";
import { Badge, Button, Card, Field, Notice, Page, SectionHeader } from "../components/Controls";
import { useContinuousSpeech } from "../components/useContinuousSpeech";
import { RootStackParamList } from "../navigation/types";
import { triggerText } from "../services/format";
import { createListenSession, FeedItem } from "../services/listenSession";
import { colors, radii, spacing, type } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Listen"> & { onSessionEnded: () => Promise<void> };

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

export function FeedCard({ item }: { item: FeedItem }) {
  if (item.kind === "email") return <Card>
    <Badge label="Email draft" tone="email" />
    <Text style={type.cardTitle}>{item.email.email.subject || "Email draft"}</Text>
    <Text style={type.meta}>{item.email.email.toName ? `To ${item.email.email.toName} · ` : ""}Needs approval · Nothing sent</Text>
  </Card>;
  const { reminder } = item;
  const badge = { new: <Badge label="New" tone="new" />, updated: <Badge label="Updated" tone="updated" />, completed: <Badge label="Completed" tone="completed" /> }[item.kind];
  return <Card>
    {badge}
    <Text style={type.cardTitle}>{reminder.title}</Text>
    <Text style={type.meta}>{item.kind === "completed" ? "Marked done" : triggerText(reminder)} · Saved</Text>
  </Card>;
}

export function ListenScreen({ navigation, route, onSessionEnded }: Props) {
  const typingOnly = !!route.params?.typing;
  const [session] = useState(() => createListenSession(sessionApi));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [lastHeard, setLastHeard] = useState("");
  const speech = useContinuousSpeech({ onPhrase: text => { setLastHeard(text); void session.say(text); } });
  const [showTyping, setShowTyping] = useState(typingOnly);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState("");
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const leaving = useRef(false);
  const announced = useRef(0);

  // Start the session (and the mic, unless typing) as soon as the screen opens.
  useEffect(() => {
    session.start().then(() => { if (!typingOnly) void speech.start(); }, () => {});
  }, []);
  useEffect(() => { if (speech.heard) setLastHeard(speech.heard); }, [speech.heard]);
  useEffect(() => {
    if (speech.status !== "on") return;
    const timer = setInterval(() => setSeconds(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [speech.status]);
  useEffect(() => { if (speech.error) setShowTyping(true); }, [speech.error]);
  useEffect(() => {
    // Announce new catches for screen readers, but not every partial word.
    const fresh = state.feed.length - announced.current;
    if (fresh > 0 && announced.current >= 0) {
      const item = state.feed[0];
      AccessibilityInfo.announceForAccessibility(item.kind === "email" ? `Email draft caught: ${item.email.email.subject}` : `${item.kind === "new" ? "New reminder" : item.kind === "updated" ? "Reminder updated" : "Reminder completed"}: ${item.reminder.title}`);
    }
    announced.current = state.feed.length;
  }, [state.feed]);

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await speech.stop();
      const detail = await session.stop();
      await onSessionEnded().catch(() => {});
      leaving.current = true;
      if (detail) navigation.replace("Review", { detail, unsent: state.unsent });
      else navigation.goBack();
    } catch { setFinishing(false); }
  };

  // Leaving by the back button or gesture still stops the mic and shows the review.
  useEffect(() => navigation.addListener("beforeRemove", event => {
    if (leaving.current || session.getSnapshot().status !== "listening") return;
    event.preventDefault(); void finish();
  }), [navigation, finishing]);

  const addTyped = async () => {
    const text = typed.trim();
    if (!text) { setTypedError("Type something you'd like Heedly to remember."); return; }
    setTypedError(""); setAdding(true);
    const before = session.getSnapshot().heard;
    await session.say(text);
    setAdding(false);
    if (session.getSnapshot().heard > before) { setTyped(""); setLastHeard(text); }
    else setTypedError("We couldn't process those words. Try again or edit the text.");
  };

  const listening = speech.status === "on";
  const micBusy = speech.status === "starting" || speech.status === "stopping";
  const pending = state.pendingChunks;

  const typedPanel = <Card>
    <Field label="Your words" value={typed} onChangeText={setTyped} multiline placeholder="Call the dentist tomorrow at 9, and buy milk near a grocery store" error={typedError} />
    <Button title={adding ? "Adding…" : "Add to session"} variant="secondary" busy={adding} onPress={() => { void addTyped(); }} />
  </Card>;

  const footer = <>
    <Button title={finishing ? "Finishing your session…" : typingOnly && !speech.status.match(/on|starting/) ? "Review session" : "Stop & review"} busy={finishing}
      accessibilityLabel="Stop listening and review caught items" onPress={finish} disabled={state.status === "starting" || state.status === "idle" && !state.error} />
    <Text style={[type.meta, { textAlign: "center" }]}>You'll review everything at the end. Reminders save as you go.</Text>
  </>;

  return <Page footer={footer}>
    <Text accessibilityRole="header" style={type.screenTitle}>{typingOnly && !listening ? "Type a session" : "Listening"}</Text>

    {state.status === "idle" && state.error ? <Notice tone="danger" title="Couldn't start a session.">
      <Text style={[type.meta, { color: colors.danger }]}>{state.error}</Text>
      <Button title="Try again" variant="secondary" compact onPress={() => { void session.start().then(() => { if (!typingOnly) void speech.start(); }, () => {}); }} />
    </Notice> : null}

    {listening || micBusy ? <View style={styles.mic} accessibilityLiveRegion="polite">
      <View style={styles.micRow}>
        <View style={styles.micLeft}>{listening ? <View style={styles.dot} /> : null}<Text style={[type.cardTitle, { color: colors.micActive }]}>{listening ? "Microphone active" : speech.status === "starting" ? "Starting microphone…" : "Finishing your session…"}</Text></View>
        {listening ? <Text style={[type.timer, { color: colors.micActive }]}>{clock(seconds)}</Text> : null}
      </View>
      <Text style={[type.meta, { color: colors.textPrimary }]}>Speak naturally. You can add, change, or finish a reminder.</Text>
    </View> : null}

    {!listening && !micBusy && speech.error ? <Notice tone="danger" title="Listening stopped.">
      <Text style={[type.meta, { color: colors.danger }]}>{speech.error}</Text>
      <View style={styles.row}>
        <Button title="Resume listening" variant="secondary" compact onPress={() => { speech.clearError(); void speech.start(); }} />
        {/permission/i.test(speech.error) ? <Button title="Open settings" variant="ghost" compact onPress={() => { void Linking.openSettings().catch(() => {}); }} /> : null}
      </View>
    </Notice> : null}

    {!listening && !micBusy && !speech.error && !typingOnly && state.status === "listening" ? <Notice title="Listening paused.">
      <Text style={type.meta}>The microphone is off. Your caught items are still here.</Text>
      <Button title="Resume listening" variant="secondary" compact onPress={() => { void speech.start(); }} />
    </Notice> : null}

    {typingOnly && !listening && !micBusy ? <Button title="Use the microphone instead" variant="ghost" onPress={() => { void speech.start(); }} /> : null}

    {typingOnly && !listening && !micBusy ? typedPanel : <View style={{ gap: spacing.xs }}>
      <Text style={type.fieldLabel}>What I'm hearing</Text>
      <View style={styles.transcript}><Text style={[type.body, { color: lastHeard ? colors.textPrimary : colors.textSecondary }]} numberOfLines={3}>{lastHeard || "Your words will appear here."}</Text></View>
    </View>}

    {state.error ? <Notice tone="attention">{state.error}</Notice> : null}
    {pending > 0 ? <Notice tone="attention">{pending === 1 ? "One phrase is" : `${pending} phrases are`} still being worked on. Heedly will finish when you stop.</Notice> : null}

    <View style={{ gap: spacing.sm }}>
      <SectionHeader title="Caught so far" count={state.feed.length} />
      {state.sending ? <Text style={type.meta}>Working on what you said…</Text> : null}
      {state.feed.length === 0 ? <Text style={type.meta}>I'm listening for things you want to remember. Try "Call the dentist tomorrow at 9 and buy milk on the way home."</Text> : null}
      {state.feed.map(item => <FeedCard key={item.key} item={item} />)}
    </View>

    {typingOnly && !listening && !micBusy ? null : showTyping ? typedPanel : <Button title="Type what you would say" variant="ghost" onPress={() => setShowTyping(true)} />}
  </Page>;
}

const styles = StyleSheet.create({
  mic: { backgroundColor: colors.micSurface, borderRadius: radii.panel, padding: spacing.md, gap: spacing.xs },
  micRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  micLeft: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.micActive },
  transcript: { minHeight: 72, backgroundColor: colors.surface, borderRadius: radii.field, borderWidth: 1, borderColor: colors.border, padding: spacing.md, justifyContent: "center" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
});
