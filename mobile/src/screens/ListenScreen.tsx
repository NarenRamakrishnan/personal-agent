import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Linking, Platform, Text, View } from "react-native";
import { sessionApi } from "../api/sessions";
import { Badge, Button, Card, FadeIn, Field, Notice, Page, PulseDot, SectionHeader, ThinkingDots } from "../components/Controls";
import { useContinuousSpeech } from "../components/useContinuousSpeech";
import { RootStackParamList } from "../navigation/types";
import { triggerText } from "../services/format";
import { createListenSession, FeedItem } from "../services/listenSession";
import { colors, radii, spacing, type, themedStyles } from "../theme";

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
  // Everything said this session. It goes to Nemotron as a whole when the person stops,
  // so corrections ("actually make it Friday") are read in context, not as loose halves.
  const talkRef = useRef<string[]>([]);
  const [talk, setTalk] = useState<string[]>([]);
  const speech = useContinuousSpeech({ onPhrase: text => { talkRef.current = [...talkRef.current, text]; setTalk(talkRef.current); } });
  const [showTyping, setShowTyping] = useState(typingOnly);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState("");
  const [typedNote, setTypedNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const leaving = useRef(false);
  const announced = useRef(0);

  // Start the session (and the mic, unless typing) as soon as the screen opens.
  useEffect(() => {
    session.start().then(() => { if (!typingOnly) void speech.start(); }, () => {});
  }, []);
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
      await session.sayAll(talkRef.current);
      talkRef.current = [];
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
    setTypedError(""); setTypedNote(""); setAdding(true);
    const before = session.getSnapshot().heard;
    const caught = session.getSnapshot().feed;
    await session.say(text);
    setAdding(false);
    if (session.getSnapshot().heard > before) {
      setTyped("");
      // Heedly read it but found nothing new, often because that reminder already exists.
      const after = session.getSnapshot().feed;
      if (after.length === caught.length && after.every((item, i) => item === caught[i])) setTypedNote(`Nothing new in "${text.length > 60 ? `${text.slice(0, 57)}…` : text}". You may already have that reminder, or try adding a time or place.`);
    }
    else setTypedError("We couldn't process those words. Try again or edit the text.");
  };

  const listening = speech.status === "on";
  const micBusy = speech.status === "starting" || speech.status === "stopping";
  const pending = state.pendingChunks;

  const typedPanel = <Card>
    <Field label="Your words" value={typed} onChangeText={setTyped} multiline autoFocus={typingOnly} placeholder="Call the dentist tomorrow at 9, and buy milk near a grocery store" error={typedError}
      onEnter={() => { if (!adding) void addTyped(); }} helper={Platform.OS === "web" ? "Press Enter to add. Shift+Enter starts a new line." : undefined} />
    <Button title={adding ? "Adding…" : "Add to session"} variant="secondary" busy={adding} onPress={() => { void addTyped(); }} />
    {typedNote ? <Text accessibilityRole="alert" style={type.meta}>{typedNote}</Text> : null}
  </Card>;

  const footer = <>
    <Button title={finishing ? "Picking out your tasks…" : typingOnly && !speech.status.match(/on|starting/) ? "Review session" : "Stop & review"} busy={finishing}
      accessibilityLabel="Stop listening and review caught items" onPress={finish} disabled={state.status === "starting" || state.status === "idle" && !state.error} />
    <Text style={[type.meta, { textAlign: "center" }]}>{typingOnly && !speech.status.match(/on|starting/) ? "You'll review everything at the end." : "When you stop, Heedly picks out the tasks and shows them for review."}</Text>
  </>;

  return <Page footer={footer}>
    <Text accessibilityRole="header" style={type.screenTitle}>{typingOnly && !listening ? "Type a session" : "Listening"}</Text>

    {state.status === "idle" && state.error ? <Notice tone="danger" title="Couldn't start a session.">
      <Text style={[type.meta, { color: colors.danger }]}>{state.error}</Text>
      <Button title="Try again" variant="secondary" compact onPress={() => { void session.start().then(() => { if (!typingOnly) void speech.start(); }, () => {}); }} />
    </Notice> : null}

    {finishing ? <FadeIn><View style={styles.thinking} accessibilityLiveRegion="polite">
      <Text style={type.meta}>Microphone off</Text>
      <View style={styles.micLeft}><Text style={[type.cardTitle, { color: colors.brandGreen }]}>Finding your reminders</Text><ThinkingDots color={colors.brandGreen} /></View>
      <Text style={type.meta}>Nemotron is reading everything you said as a whole, corrections included.</Text>
    </View></FadeIn> : listening || micBusy ? <View style={styles.mic} accessibilityLiveRegion="polite">
      <View style={styles.micRow}>
        <View style={styles.micLeft}>{listening ? <PulseDot color={colors.micActive} /> : null}<Text style={[type.cardTitle, { color: colors.micActive }]}>{listening ? "Microphone active" : speech.status === "starting" ? "Starting microphone…" : "Finishing your session…"}</Text></View>
        {listening ? <Text style={[type.timer, { color: colors.micActive }]}>{clock(seconds)}</Text> : null}
      </View>
      <Text style={[type.meta, { color: colors.textPrimary }]}>Talk as long as you like. You can add, change or finish reminders, and correct yourself as you go.</Text>
    </View> : null}

    {!listening && !micBusy && speech.error ? <Notice tone="danger" title="Listening stopped.">
      <Text style={[type.meta, { color: colors.danger }]}>{speech.error}</Text>
      <View style={styles.row}>
        <Button title="Resume listening" variant="secondary" compact onPress={() => { speech.clearError(); void speech.start(); }} />
        {/permission/i.test(speech.error) ? <Button title="Open settings" variant="ghost" compact onPress={() => { void Linking.openSettings().catch(() => {}); }} /> : null}
      </View>
    </Notice> : null}

    {!finishing && !listening && !micBusy && !speech.error && !typingOnly && state.status === "listening" ? <Notice title="Listening paused.">
      <Text style={type.meta}>The microphone is off. Everything you said so far is kept.</Text>
      <Button title="Resume listening" variant="secondary" compact onPress={() => { void speech.start(); }} />
    </Notice> : null}

    {typingOnly && !listening && !micBusy && !finishing ? <Button title="Use the microphone instead" variant="ghost" onPress={() => { void speech.start(); }} /> : null}

    {typingOnly && !listening && !micBusy ? (finishing ? null : typedPanel) : <View style={{ gap: spacing.xs }}>
      <Text style={type.fieldLabel}>What you've said</Text>
      <View style={styles.transcript} accessibilityLabel="Transcript so far">
        {talk.length || speech.heard ? <>
          {talk.map((line, i) => <FadeIn key={i}><Text style={type.body}>{line}</Text></FadeIn>)}
          {speech.heard ? <Text style={[type.body, { color: colors.textSecondary }]}>{speech.heard}</Text> : null}
        </> : <Text style={[type.body, { color: colors.textSecondary }]}>Your words will appear here. Try "Call the dentist tomorrow at 9 and buy milk on the way home."</Text>}
      </View>
    </View>}

    {state.error ? <Notice tone="attention">{state.error}</Notice> : null}
    {pending > 0 ? <Notice tone="attention">{pending === 1 ? "One phrase is" : `${pending} phrases are`} still being worked on. Heedly will finish when you stop.</Notice> : null}

    {state.feed.length || typingOnly ? <View style={{ gap: spacing.sm }}>
      <SectionHeader title="Caught so far" count={state.feed.length} />
      {state.sending ? <Text style={type.meta}>Working on what you said…</Text> : null}
      {state.feed.length === 0 ? <Text style={type.meta}>Add what you'd like to remember. You can put several things in one go.</Text> : null}
      {state.feed.map(item => <FadeIn key={item.key}><FeedCard item={item} /></FadeIn>)}
    </View> : null}

    {typingOnly && !listening && !micBusy || finishing ? null : showTyping ? typedPanel : <Button title="Type what you would say" variant="ghost" onPress={() => setShowTyping(true)} />}
  </Page>;
}

const styles = themedStyles(() => ({
  mic: { backgroundColor: colors.micSurface, borderRadius: radii.panel, padding: spacing.md, gap: spacing.xs },
  micRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  micLeft: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  thinking: { backgroundColor: colors.successSurface, borderRadius: radii.panel, padding: spacing.md, gap: spacing.xs },
  transcript: { minHeight: 72, backgroundColor: colors.surface, borderRadius: radii.field, borderWidth: 1, borderColor: colors.border, padding: spacing.md, justifyContent: "center" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
}));
