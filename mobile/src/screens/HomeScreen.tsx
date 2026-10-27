import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { actionsApi } from "../api/actions";
import { USE_MOCKS } from "../api/client";
import { Button, Notice, SectionHeader } from "../components/Controls";
import { ListenButton } from "../components/ListenButton";
import { ReminderCard } from "../components/ReminderCard";
import { RootStackParamList } from "../navigation/types";
import { groupReminders } from "../services/format";
import { colors, column, radii, spacing, type } from "../theme";
import { Reminder } from "../types/reminder";

type Props = NativeStackScreenProps<RootStackParamList, "Home"> & {
  reminders: Reminder[]; loaded: boolean; onRefresh: () => Promise<void>; refreshing: boolean; error: string; onToggle: (reminder: Reminder) => Promise<void>;
};

const logo = require("../../assets/logo-mark.png");

export function HomeScreen({ navigation, route, reminders, loaded, onRefresh, refreshing, error, onToggle }: Props) {
  const [showDone, setShowDone] = useState(false);
  const [drafts, setDrafts] = useState(0);
  const [toggleError, setToggleError] = useState("");
  const notice = route.params?.notice;
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => navigation.setParams({ notice: undefined }), 4000);
    return () => clearTimeout(timer);
  }, [notice, navigation]);
  useFocusEffect(useCallback(() => {
    let live = true;
    actionsApi.pending().then(rows => { if (live) setDrafts(rows.length); }, () => {});
    return () => { live = false; };
  }, []));
  const groups = useMemo(() => groupReminders(reminders), [reminders]);
  const active = groups.today.length + groups.upcoming.length + groups.place.length;
  const sections = [
    { key: "today", title: "Today", data: groups.today },
    { key: "upcoming", title: "Upcoming", data: groups.upcoming },
    { key: "place", title: "At a place", data: groups.place },
    ...(groups.done.length ? [{ key: "done", title: `Done (${groups.done.length})`, data: showDone ? groups.done : [] }] : []),
  ].filter(section => section.key === "done" || section.data.length);
  const toggle = (reminder: Reminder) => { setToggleError(""); onToggle(reminder).catch(e => setToggleError(e instanceof Error ? e.message : "Couldn't update that reminder.")); };

  const header = <View style={[column, { paddingHorizontal: spacing.lg }]}>
    <View style={styles.brand}>
      <View style={styles.brandLeft}>
        <Image source={logo} style={styles.logo} accessibilityIgnoresInvertColors accessible={false} />
        <Text style={type.brandName} accessibilityRole="header">Heedly</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => navigation.navigate("Settings")} style={styles.gear} hitSlop={4}>
        <Text style={styles.gearGlyph}>⚙︎</Text>
      </Pressable>
    </View>
    {notice ? <View style={{ marginBottom: spacing.md }}><Notice tone="success">{notice}</Notice></View> : null}
    <View style={styles.intro}>
      <Text style={[type.heroTitle, { textAlign: "center" }]}>A little less to remember.</Text>
      <Text style={[type.body, styles.introBody]}>Talk naturally. When you stop, Heedly turns what you said into reminders.</Text>
    </View>
    <View style={{ alignItems: "center", marginTop: spacing.xl }}>
      <ListenButton onPress={() => navigation.navigate("Listen")} />
      <View style={{ marginTop: spacing.xs, alignSelf: "stretch" }}><Button title="Type instead" variant="ghost" onPress={() => navigation.navigate("Listen", { typing: true })} /></View>
      <Text style={[type.meta, { textAlign: "center", marginTop: spacing.xs }]}>The microphone is on only while you choose to listen.</Text>
      {USE_MOCKS ? <Text style={[type.meta, { textAlign: "center", marginTop: spacing.xxs }]}>Demo mode: reminders stay on this device.</Text> : null}
    </View>
    <View style={{ height: spacing.xxl }} />
    {drafts > 0 ? <View style={[styles.drafts, { marginBottom: spacing.xl }]}>
      <Text style={type.cardTitle}>{drafts} email {drafts === 1 ? "draft needs" : "drafts need"} approval</Text>
      <Text style={type.meta}>Nothing has been sent.</Text>
      <Button title="Review drafts" variant="ghost" compact onPress={() => navigation.navigate("Email")} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} />
    </View> : null}
    {error ? <View style={{ marginBottom: spacing.xl }}><Notice tone="danger" title="We couldn't refresh your reminders."><Text style={[type.meta, { color: colors.danger }]}>{error}</Text><Button title="Try again" variant="secondary" compact onPress={onRefresh} style={{ alignSelf: "flex-start" }} /></Notice></View> : null}
    {toggleError ? <View style={{ marginBottom: spacing.md }}><Notice tone="danger">{toggleError}</Notice></View> : null}
    {!loaded ? <View style={styles.loading}><ActivityIndicator color={colors.brandGreen} /><Text style={type.meta}>Loading your reminders…</Text></View> : null}
    {loaded && active === 0 ? <View style={styles.empty}>
      <Image source={logo} style={styles.emptyLogo} accessible={false} />
      <Text style={[type.sectionTitle, { textAlign: "center" }]}>One less thing on your mind.</Text>
      <Text style={[type.body, { color: colors.textSecondary, textAlign: "center" }]}>Try saying, "Remind me to call the dentist tomorrow at 9."</Text>
    </View> : null}
  </View>;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => <View style={[column, styles.sectionPad]}>
          {section.key === "done"
            ? <Pressable accessibilityRole="button" accessibilityLabel="Show completed reminders" accessibilityState={{ expanded: showDone }} onPress={() => setShowDone(value => !value)} style={styles.doneRow}>
                <Text style={type.sectionTitle}>{section.title}</Text><Text style={[type.meta, { color: colors.brandGreen }]}>{showDone ? "Hide" : "Show"}</Text>
              </Pressable>
            : <SectionHeader title={section.title} count={section.data.length} />}
        </View>}
        renderItem={({ item }) => <View style={[column, { paddingHorizontal: spacing.lg }]}>
          <ReminderCard reminder={item} onPress={() => navigation.navigate("ReminderDetail", { reminder: item })} onToggle={() => toggle(item)} />
        </View>}
        renderSectionFooter={() => <View style={{ height: spacing.md }} />}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  brand: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: spacing.md, paddingBottom: spacing.xl },
  brandLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logo: { width: 44, height: 44, borderRadius: 14 },
  gear: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.pill },
  gearGlyph: { fontSize: 24, color: colors.textPrimary },
  intro: { alignItems: "center", gap: spacing.xs },
  introBody: { color: colors.textSecondary, textAlign: "center", maxWidth: 320 },
  drafts: { backgroundColor: colors.accentSurface, borderRadius: radii.card, padding: spacing.md, gap: spacing.xxs },
  loading: { flexDirection: "row", gap: spacing.xs, alignItems: "center", justifyContent: "center", paddingVertical: spacing.xl },
  empty: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  emptyLogo: { width: 56, height: 56, borderRadius: 16, marginBottom: spacing.xs },
  sectionPad: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  doneRow: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
