import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import { privacyApi } from "../api/actions";
import { USE_MOCKS } from "../api/client";
import { AsyncButton, Button, Card, Chip, Chips, Notice, Page, ScreenTitle } from "../components/Controls";
import { PrivacyInfo, PrivacySettings } from "../types/context";
import { cancelAllNotifications, cancelContextNotifications } from "../services/notifications";
import { disableBackgroundContext } from "../services/background";
import { locationPreferenceChanged } from "../services/locationLifecycle";
import { LOCATION_ENABLED } from "../services/context";
import { colors, spacing, type } from "../theme";

export function PrivacyScreen({ onChanged }: { onChanged: () => Promise<void> }) {
  const [info, setInfo] = useState<PrivacyInfo>(); const [settings, setSettings] = useState<PrivacySettings>();
  const [confirm, setConfirm] = useState(false); const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const load = async () => { setLoadError(""); try { setInfo(await privacyApi.info()); setSettings(await privacyApi.settings()); } catch { setLoadError("We couldn't load your privacy settings."); } };
  useEffect(() => { void load(); }, []);
  return <Page>
    <ScreenTitle subtitle="What Heedly keeps, what it doesn't and how to delete it.">Privacy & data</ScreenTitle>

    <Card>
      <Text style={type.cardTitle}>Microphone & speech</Text>
      <Text style={type.body}>Heedly doesn't retain raw microphone recordings. The microphone is on only while you choose to listen. Your device or browser speech service may process audio online.</Text>
      <Text style={type.meta}>{USE_MOCKS ? "Demo mode stores reminder data on this device." : "The words you say and the reminders Heedly saves go to Heedly's backend, kept separate for each device."} Local app storage is not an encrypted vault.</Text>
      {!USE_MOCKS ? <Text style={type.meta}>{process.env.EXPO_PUBLIC_API_KEY ? "Shared-key mode: everyone with this key shares the same data. Don't use it for a public app." : "Phones keep their private key in encrypted device storage. In a browser it lasts for this tab session, so a new session may start a fresh, empty space."}</Text> : null}
      <Text style={type.meta}>Location, when on, sends coordinates to Heedly's backend and to OpenStreetMap Overpass for nearby places.</Text>
    </Card>

    <Card>
      <Text style={type.cardTitle}>Transcript storage</Text>
      {loadError ? <Notice tone="danger"><Text style={[type.meta, { color: colors.danger }]}>{loadError}</Text><Button title="Try again" variant="secondary" compact onPress={() => { void load(); }} /></Notice> : null}
      {info ? <Text style={type.meta}>Audio stored on the server: {info.audioStored ? "yes" : "no"}. Transcripts kept: {info.storeTranscripts ? `yes, up to ${info.transcriptRetentionDays} days` : "no"}.</Text> : !loadError ? <Text style={type.meta}>Loading…</Text> : null}
      {settings ? <View style={{ gap: spacing.xs }}>
        {settings.keepTranscripts
          ? <AsyncButton title="Turn off transcript storage and erase kept transcripts" variant="secondary" compact action={async () => { await privacyApi.update({ keepTranscripts: false }); await load(); }} />
          : !USE_MOCKS && settings.serverKeepsTranscripts ? <AsyncButton title="Keep transcripts so I can check what was heard" variant="secondary" compact action={async () => { await privacyApi.update({ keepTranscripts: true }); await load(); }} /> : <Text style={type.meta}>Transcripts are off.</Text>}
        {!USE_MOCKS && settings.keepTranscripts ? <>
          <Text style={type.fieldLabel}>Delete transcripts after</Text>
          <Chips>{[1, 7, 30].map(days => <Chip key={days} label={`${days} ${days === 1 ? "day" : "days"}`} selected={settings.deleteTranscriptsAfterDays === days}
            onPress={() => { void privacyApi.update({ deleteTranscriptsAfterDays: days }).then(load); }} />)}</Chips>
        </> : null}
      </View> : null}
    </Card>

    <Card>
      <Text style={type.cardTitle}>Permissions</Text>
      <AsyncButton title="Turn off location and background checks" variant="secondary" compact action={async () => { await AsyncStorage.setItem(LOCATION_ENABLED, "false"); locationPreferenceChanged(); await cancelContextNotifications(); await disableBackgroundContext(); setMessage("Location is off in Heedly."); }} />
      <AsyncButton title="Open device permission settings" variant="ghost" compact action={async () => { await Linking.openSettings(); }} />
    </Card>

    {message ? <Notice tone="success">{message}</Notice> : null}

    {!confirm ? <Button title="Delete reminders, drafts & history" variant="dangerGhost" onPress={() => setConfirm(true)} />
      : <Notice tone="danger" title="Delete reminders, drafts & history?">
        <Text style={[type.body, { color: colors.danger }]}>This permanently deletes those records from Heedly's backend (or demo storage). Location will turn off. Saved places will remain.</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
          <Button title="Keep my data" variant="secondary" compact onPress={() => setConfirm(false)} />
          <AsyncButton title="Delete data" variant="danger" compact accessibilityLabel="Confirm permanent history deletion" action={async () => {
            await AsyncStorage.setItem(LOCATION_ENABLED, "false"); locationPreferenceChanged();
            await disableBackgroundContext(); await cancelAllNotifications(); await privacyApi.deleteHistory();
            await AsyncStorage.removeItem("context-notification-ledger"); await onChanged(); setConfirm(false); setMessage("Data deleted. Location is off. Saved places remain.");
          }} />
        </View>
      </Notice>}
  </Page>;
}
