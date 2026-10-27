import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { actionsApi } from "../api/actions";
import { USE_MOCKS } from "../api/client";
import { AsyncButton, Badge, Button, Card, Field, Notice, Page, ScreenTitle, SectionHeader } from "../components/Controls";
import { VoiceInput } from "../components/VoiceInput";
import { RootStackParamList } from "../navigation/types";
import { openMail } from "../services/mail";
import { colors, spacing, type } from "../theme";
import { EmailAction } from "../types/context";

export function EmailScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, "Email">) {
  const [command, setCommand] = useState(route.params?.text ?? ""); const [draft, setDraft] = useState<EmailAction>();
  const [to, setTo] = useState(""); const [subject, setSubject] = useState(""); const [body, setBody] = useState("");
  const [status, setStatus] = useState(""); const [queue, setQueue] = useState<EmailAction[]>();
  const [loadError, setLoadError] = useState("");
  const open = (action: EmailAction) => { setDraft(action); setTo(action.email.to ?? ""); setSubject(action.email.subject); setBody(action.email.body); setStatus(""); };
  useEffect(() => {
    if (route.params?.draftId) actionsApi.get(route.params.draftId).then(open, e => setLoadError(e instanceof Error ? e.message : "Couldn't load that draft."));
    else actionsApi.pending().then(setQueue, () => setQueue([]));
  }, [route.params?.draftId]);

  if (!draft) return <Page>
    <ScreenTitle subtitle="Say who it's for and what to say. Heedly writes a draft you check first. It never sends anything.">Draft an email</ScreenTitle>
    {loadError ? <Notice tone="danger">{loadError}</Notice> : null}
    {USE_MOCKS ? <Notice>Demo mode uses a sample draft to Alex. Connect the backend to draft your own.</Notice> : null}
    {queue?.length ? <View style={{ gap: spacing.sm }}>
      <SectionHeader title="Waiting for approval" count={queue.length} />
      {queue.map(a => <Card key={a.id}>
        <Badge label="Needs approval" tone="email" />
        <Text style={type.cardTitle}>{a.email.subject || "Email draft"}</Text>
        <Text style={type.meta}>{a.email.to || a.email.toName ? `To ${a.email.to || a.email.toName}` : "Recipient needed"}</Text>
        <Button title="Review & open mail" variant="secondary" compact onPress={() => open(a)} />
      </Card>)}
    </View> : null}
    <Field label="Email command" value={command} onChangeText={setCommand} multiline placeholder="Write an email to Alex saying I'll be ten minutes late" />
    <VoiceInput onTranscript={setCommand} />
    <AsyncButton title="Create draft" busyTitle="Writing your draft…" action={async () => {
      if (!command.trim()) throw new Error("Describe the email you want to write.");
      open(await actionsApi.draft(command));
    }} />
  </Page>;

  const footer = <>
    <AsyncButton title="Approve & open mail" action={async () => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) throw new Error("Enter a valid recipient email address.");
      if (!subject.trim() || !body.trim()) throw new Error("Subject and message are required.");
      const email = { ...draft.email, to: to.trim(), subject: subject.trim(), body: body.trim() };
      await actionsApi.edit(draft.id, email); await actionsApi.approve(draft.id);
      try { await openMail(email.to, email.subject, email.body); setStatus("Draft opened in your mail app. You choose whether to send it there."); }
      catch { setStatus("We couldn't open your mail app. Your draft is still here."); }
    }} />
    <Text style={[type.meta, { textAlign: "center" }]}>This opens a draft in your mail app. You choose whether to send it there.</Text>
  </>;

  return <Page footer={footer}>
    <ScreenTitle>Review email draft</ScreenTitle>
    <Notice tone="attention">Nothing has been sent. Heedly never sends email for you.</Notice>
    {draft.email.toName ? <Text style={type.meta}>Recipient: {draft.email.toName}</Text> : null}
    <Field label="Recipient email address" value={to} onChangeText={setTo} keyboardType="email-address" placeholder="alex@example.com" helper="Check the email address before continuing." />
    <Field label="Subject" value={subject} onChangeText={setSubject} />
    <Field label="Message" value={body} onChangeText={setBody} multiline />
    {status ? <Notice tone={status.startsWith("We couldn't") ? "danger" : "success"}>{status}</Notice> : null}
    <AsyncButton title="Cancel draft" variant="dangerGhost" action={async () => { await actionsApi.cancel(draft.id); navigation.goBack(); }} />
    {status && !status.startsWith("We couldn't") ? <Button title="Done" variant="secondary" onPress={() => navigation.goBack()} /> : null}
    <Text style={[type.meta, { color: colors.textSecondary }]}>Drafts are written by NVIDIA Nemotron from what you said. Read it before you approve.</Text>
  </Page>;
}
