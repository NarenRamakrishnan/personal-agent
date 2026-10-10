import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Text, View } from "react-native";
import { actionsApi } from "../api/actions";
import { AsyncButton, Field, Page } from "../components/Controls";
import { VoiceInput } from "../components/VoiceInput";
import { EmailAction } from "../types/context";
import { RootStackParamList } from "../navigation/types";
import { openMail } from "../services/mail";
import { USE_MOCKS } from "../api/client";
export function EmailScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, "Email">) {
  const [command, setCommand] = useState(route.params?.text ?? ""); const [draft, setDraft] = useState<EmailAction>();
  const [to, setTo] = useState(""); const [subject, setSubject] = useState(""); const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  return <Page><Text style={{ fontSize: 28, fontWeight: "700" }}>Email draft</Text>
    {USE_MOCKS && <Text>Demo mode uses a sample Alex draft. Connect the backend to draft your actual command.</Text>}
    {!draft ? <View style={{ gap: 16 }}><Field label="Email command" value={command} onChangeText={setCommand} multiline /><VoiceInput onTranscript={setCommand} />
      <AsyncButton title="Create draft" action={async () => {
        if (!command.trim()) throw new Error("Describe the email you want to write.");
        const result = await actionsApi.draft(command); setDraft(result); setTo(result.email.to ?? ""); setSubject(result.email.subject); setBody(result.email.body);
      }} /></View> : <View style={{ gap: 16 }}>
      <Text>Recipient name: {draft.email.toName ?? "Not provided"}. Verify the email address before opening Mail.</Text>
      <Field label="Recipient email address" value={to} onChangeText={setTo} />
      <Field label="Subject" value={subject} onChangeText={setSubject} />
      <Field label="Message" value={body} onChangeText={setBody} multiline />
      <Text>Nothing has been sent. Review the draft; sending is a separate action in your mail app.</Text>
      <AsyncButton title="Approve & open Mail" action={async () => {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) throw new Error("Enter a valid recipient email address.");
        if (!subject.trim() || !body.trim()) throw new Error("Subject and message are required.");
        const email = { ...draft.email, to: to.trim(), subject: subject.trim(), body: body.trim() };
        await actionsApi.edit(draft.id, email); await actionsApi.approve(draft.id);
        await openMail(email.to, email.subject, email.body); setStatus("Draft opened in Mail. Finish or cancel it there.");
      }} />
      <AsyncButton title="Cancel draft" action={async () => { await actionsApi.cancel(draft.id); navigation.goBack(); }} />
      <Text>{status}</Text>
    </View>}
  </Page>;
}
