import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { privacyApi } from "../api/actions";
import { USE_MOCKS } from "../api/client";
import { AsyncButton, Button, Page } from "../components/Controls";
import { PrivacyInfo, PrivacySettings } from "../types/context";
import { cancelAllNotifications, cancelContextNotifications } from "../services/notifications";
import { disableBackgroundContext } from "../services/background";
import { locationPreferenceChanged } from "../services/locationLifecycle";
import { LOCATION_ENABLED } from "../services/context";

export function PrivacyScreen({ onChanged }: { onChanged: () => Promise<void> }) {
  const [info, setInfo] = useState<PrivacyInfo>(); const [settings, setSettings] = useState<PrivacySettings>();
  const [confirm, setConfirm] = useState(false); const [message, setMessage] = useState("");
  const load = async () => { setInfo(await privacyApi.info()); setSettings(await privacyApi.settings()); };
  return <Page><Text style={{ fontSize: 28, fontWeight: "700" }}>Privacy & permissions</Text>
    <Text>{USE_MOCKS ? "Demo mode: reminder data stays in local app storage." : "Connected mode: reviewed commands and saved reminders go to your configured backend."} Local app storage is not an encrypted vault.</Text>
    <Text>Microphone access occurs only while you choose Speak. This app does not retain raw microphone recordings; your device/browser speech service may process audio online. Nearby places sends coordinates to Overpass; reminder evaluation sends them to your backend when location is enabled.</Text>
    <AsyncButton title="Load backend privacy settings" action={load} />
    {info && <Text>Backend audio stored: {String(info.audioStored)}. Transcript retention: {info.transcriptRetentionDays} days. Keeps transcripts: {String(info.storeTranscripts)}.</Text>}
    {settings && <View style={{ gap: 12 }}><Text>Server permits transcripts: {String(settings.serverKeepsTranscripts)}. Server retention limit: {settings.serverRetentionDays} days.</Text>
      <AsyncButton title="Disable transcript storage & erase retained transcripts" action={async () => { await privacyApi.update({ keepTranscripts: false }); await load(); }} />
      {!USE_MOCKS && settings.serverKeepsTranscripts && <AsyncButton title="Enable transcript storage" action={async () => { await privacyApi.update({ keepTranscripts: true }); await load(); }} />}
      {!USE_MOCKS && [1, 7, 30].map(days => <AsyncButton key={days} title={`Keep transcripts for at most ${days} days`} action={async () => { await privacyApi.update({ deleteTranscriptsAfterDays: days }); await load(); }} />)}
    </View>}
    <AsyncButton title="Disable location & background tasks" action={async () => { await AsyncStorage.setItem(LOCATION_ENABLED, "false"); locationPreferenceChanged(); await cancelContextNotifications(); await disableBackgroundContext(); setMessage("Location is disabled in this app."); }} />
    <AsyncButton title="Open device permission settings" action={async () => { await Linking.openSettings(); }} />
    <Button title="Delete reminder/draft/history data" onPress={() => setConfirm(true)} />
    {confirm && <View style={{ gap: 12 }}><Text>This permanently deletes all reminder, draft and listening history from the configured backend (or demo reminder storage). Saved places are kept. Proceed?</Text>
      <AsyncButton title="Confirm permanent history deletion" action={async () => {
        await AsyncStorage.setItem(LOCATION_ENABLED, "false"); locationPreferenceChanged();
        await disableBackgroundContext(); await cancelAllNotifications(); await privacyApi.deleteHistory();
        await AsyncStorage.removeItem("context-notification-ledger"); await onChanged(); setConfirm(false); setMessage("History deleted. Location is disabled; saved places remain.");
      }} /><Button title="Keep history" onPress={() => setConfirm(false)} /></View>}
    {message ? <Text>{message}</Text> : null}
  </Page>;
}
