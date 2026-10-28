import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { API_BASE_URL, USE_MOCKS } from "../api/client";
import { AsyncButton, Chip, Chips, Notice, Page, ScreenTitle } from "../components/Controls";
import { AppearancePreference, useAppearance } from "../services/appearance";
import { RootStackParamList } from "../navigation/types";
import { enableExactTimeAlerts, enableNotifications, notificationTimingStatus, reconcileNotifications } from "../services/notifications";
import { colors, radii, spacing, type, themedStyles } from "../theme";
import { Reminder } from "../types/reminder";

type Props = NativeStackScreenProps<RootStackParamList, "Settings"> & { reminders: Reminder[] };

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={{ gap: spacing.xs }}>
    <Text accessibilityRole="header" style={type.sectionTitle}>{title}</Text>
    <View style={styles.panel}>{children}</View>
  </View>;
}

function LinkRow({ title, summary, onPress, last }: { title: string; summary: string; onPress: () => void; last?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={summary} onPress={onPress}
    style={({ pressed }) => [styles.row, !last && styles.divider, pressed && { backgroundColor: colors.surfaceSubtle }]}>
    <View style={{ flex: 1, gap: 2 }}><Text style={type.cardTitle}>{title}</Text><Text style={type.meta}>{summary}</Text></View>
    <Text style={styles.chevron}>›</Text>
  </Pressable>;
}

export function SettingsScreen({ navigation, reminders }: Props) {
  const [timing, setTiming] = useState("");
  const { preference, setPreference } = useAppearance();
  const looks: [AppearancePreference, string][] = [["system", "Match device"], ["light", "Light"], ["dark", "Dark"]];
  return <Page>
    <ScreenTitle>Settings</ScreenTitle>

    <Group title="Appearance">
      <View style={[styles.row, styles.column]}>
        <Chips>{looks.map(([value, label]) => <Chip key={value} label={label} selected={preference === value} onPress={() => setPreference(value)} accessibilityLabel={`Appearance: ${label}`} />)}</Chips>
      </View>
    </Group>

    <Group title="Notifications">
      <View style={[styles.row, styles.divider, styles.column]}>
        <Text style={type.cardTitle}>Reminder notifications</Text>
        <Text style={type.meta}>Heedly buzzes you when a reminder is due or you're near the right place. Reminders are saved either way.</Text>
        <AsyncButton title="Enable reminder notifications" variant="secondary" compact action={async () => { await enableNotifications(); setTiming(await notificationTimingStatus()); await reconcileNotifications(reminders); }} />
      </View>
      {Platform.OS === "android" ? <View style={[styles.row, styles.divider, styles.column]}>
        <Text style={type.cardTitle}>Precise timing</Text>
        <Text style={type.meta}>Allow exact-time alerts for time reminders.</Text>
        <AsyncButton title="Allow exact-time alerts" variant="secondary" compact action={enableExactTimeAlerts} />
      </View> : null}
      <View style={[styles.row, styles.column]}>
        <Text style={type.cardTitle}>Check notification status</Text>
        <AsyncButton title="Check notification timing" variant="ghost" compact action={async () => { setTiming(await notificationTimingStatus()); await reconcileNotifications(reminders); }} />
        {timing ? <Text accessibilityRole="alert" style={type.meta}>{timing}</Text> : null}
      </View>
    </Group>

    <Group title="Memory">
      <LinkRow title="What Heedly remembers" summary="People, usual places and repeating reminders it has learned from you." onPress={() => navigation.navigate("Memory")} last />
    </Group>

    <Group title="Location & saved places">
      <LinkRow title="Location reminders" summary="Turn on place reminders and save spots like home or work." onPress={() => navigation.navigate("Location")} last />
    </Group>

    <Group title="Email">
      <LinkRow title="Email drafts" summary="Drafts open in your mail app after you approve them. Heedly never sends email." onPress={() => navigation.navigate("Email")} last />
    </Group>

    <Group title="Privacy">
      <LinkRow title="Privacy & data" summary="Transcript storage, what is kept and deleting your history." onPress={() => navigation.navigate("Privacy")} />
      <LinkRow title="Device permissions" summary="Microphone, speech, location and notifications." onPress={() => { void Linking.openSettings().catch(() => {}); }} last />
    </Group>

    <Notice>
      <Text style={type.meta}>{USE_MOCKS ? "Demo mode: reminders are stored on this device." : `Connected to ${API_BASE_URL.replace(/^https?:\/\//, "")}. Each device gets its own private space; nobody else sees your reminders.`}</Text>
      <Text style={type.meta}>Heedly understands speech with NVIDIA Nemotron on Nebius Token Factory. Nearby places © OpenStreetMap contributors.</Text>
    </Notice>
  </Page>;
}

const styles = themedStyles(() => ({
  panel: { backgroundColor: colors.surface, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { minHeight: 64, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  column: { flexDirection: "column", alignItems: "stretch", gap: spacing.xs },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  chevron: { fontSize: 24, color: colors.textSecondary },
}));
