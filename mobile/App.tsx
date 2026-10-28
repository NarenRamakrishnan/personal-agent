import { DarkTheme, DefaultTheme, NavigationContainer, NavigationState } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform, Pressable, Text, useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { reminderApi } from "./src/api/client";
import { errorMessage } from "./src/components/Controls";
import { cancelReminderNotification, listenForNotificationActions, reconcileNotifications } from "./src/services/notifications";
import { ConfirmReminderScreen } from "./src/screens/ConfirmReminderScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ListenScreen } from "./src/screens/ListenScreen";
import { ReminderDetailScreen } from "./src/screens/ReminderDetailScreen";
import { ReviewScreen } from "./src/screens/ReviewScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { RootStackParamList } from "./src/navigation/types";
import { Reminder } from "./src/types/reminder";
import { LocationScreen } from "./src/screens/LocationScreen";
import { EmailScreen } from "./src/screens/EmailScreen";
import { PrivacyScreen } from "./src/screens/PrivacyScreen";
import { syncBackgroundRegions } from "./src/services/background";
import { watchForegroundContext } from "./src/services/locationLifecycle";
import { createReminderStore } from "./src/services/reminderStore";
import { AppearanceContext, AppearancePreference, loadAppearance, resolveScheme, saveAppearance } from "./src/services/appearance";
import { applyScheme, colors, spacing, type } from "./src/theme";

const Stack = createNativeStackNavigator<RootStackParamList>();

// The web build draws its own back button: the stock one is an image that the static deploy leaves out.
function WebBack({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onPress} hitSlop={8}
    style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: spacing.xs, borderRadius: 10, opacity: pressed ? 0.6 : 1 })}>
    <Text style={[type.buttonLabel, { color: colors.brandGreen, fontSize: 26, lineHeight: 28, marginTop: -3 }]}>‹</Text>
    <Text style={[type.buttonLabel, { color: colors.brandGreen }]}>Back</Text>
  </Pressable>;
}

export default function App() {
  const [store] = useState(() => createReminderStore(reminderApi));
  const { reminders, loaded, refreshing, error: loadError } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [serviceError, setError] = useState("");
  const error = serviceError || loadError;
  const refresh = async () => { setError(""); await store.refresh(); };
  useEffect(() => { void refresh(); const subscription = AppState.addEventListener("change", state => { if (state === "active") void refresh(); }); return () => subscription.remove(); }, []);
  useEffect(() => listenForNotificationActions(() => { void refresh(); }, e => setError(errorMessage(e))), []);
  useEffect(() => watchForegroundContext(e => setError(errorMessage(e))), []);
  useEffect(() => { if (loaded) void reconcileNotifications(reminders).catch(e => setError(errorMessage(e))); }, [reminders, loaded]);
  useEffect(() => { if (loaded) void syncBackgroundRegions().catch(e => setError(errorMessage(e))); }, [reminders, loaded]);
  const addReminder = store.add;
  const update = store.update;
  const setCompleted = (id: string, completed: boolean) => update(id, { completed });
  const deleteReminder = async (id: string) => { await store.remove(id); await cancelReminderNotification(id); };
  const snoozeReminder = (id: string, snoozedUntil: string) => update(id, { snoozedUntil });

  // Light, dark or follow the device. Changing it swaps the palette and remounts the screens,
  // keeping the navigation history so the person stays where they were.
  const [preference, setPreferenceState] = useState<AppearancePreference>("system");
  useEffect(() => { void loadAppearance().then(setPreferenceState); }, []);
  const appearance = useMemo(() => ({ preference, setPreference: (next: AppearancePreference) => { setPreferenceState(next); void saveAppearance(next); } }), [preference]);
  const scheme = resolveScheme(preference, useColorScheme());
  applyScheme(scheme);
  const navState = useRef<NavigationState | undefined>(undefined);
  const navTheme = useMemo(() => {
    const base = scheme === "dark" ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: colors.background, card: colors.background, text: colors.textPrimary, primary: colors.brandGreen, border: colors.border } };
  }, [scheme]);

  return (
    <SafeAreaProvider>
      <AppearanceContext.Provider value={appearance}>
      <NavigationContainer key={scheme} theme={navTheme} initialState={navState.current} onStateChange={state => { navState.current = state; }} documentTitle={{ formatter: (options, route) => options?.title ? `${options.title} · Heedly` : route?.name === "Home" ? "Heedly" : "Heedly" }}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <Stack.Navigator screenOptions={({ navigation }) => ({ ...(Platform.OS === "web" ? { headerLeft: ({ canGoBack }: { canGoBack?: boolean }) => canGoBack ? <WebBack onPress={() => navigation.goBack()} /> : null } : null), headerShown: true, headerTintColor: colors.brandGreen, headerTitleStyle: { color: colors.textPrimary }, headerShadowVisible: false, headerStyle: { backgroundColor: colors.background }, headerBackTitle: "Back", contentStyle: { backgroundColor: colors.background } })}>
          <Stack.Screen name="Home" options={{ headerShown: false, title: "" }}>{(props) => <HomeScreen {...props} reminders={reminders} loaded={loaded} onRefresh={refresh} refreshing={refreshing} error={error} onToggle={r => setCompleted(r.id, !r.completed)} />}</Stack.Screen>
          <Stack.Screen name="Listen" options={{ title: "" }}>{(props) => <ListenScreen {...props} onSessionEnded={refresh} />}</Stack.Screen>
          <Stack.Screen name="Review" options={{ title: "", headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }}>{(props) => <ReviewScreen {...props} reminders={reminders} onDelete={deleteReminder} onUpdate={update} onRefresh={refresh} />}</Stack.Screen>
          <Stack.Screen name="Settings" options={{ title: "" }}>{(props) => <SettingsScreen {...props} reminders={reminders} />}</Stack.Screen>
          <Stack.Screen name="Location" component={LocationScreen} options={{ title: "" }} />
          <Stack.Screen name="Email" component={EmailScreen} options={{ title: "" }} />
          <Stack.Screen name="Privacy" options={{ title: "" }}>{() => <PrivacyScreen onChanged={refresh} />}</Stack.Screen>
          <Stack.Screen name="ConfirmReminder" options={{ title: "" }}>{(props) => <ConfirmReminderScreen {...props} onSave={addReminder} onUpdate={update} />}</Stack.Screen>
          <Stack.Screen name="ReminderDetail" options={{ title: "" }}>{(props) => <ReminderDetailScreen {...props} reminders={reminders} onComplete={setCompleted} onDelete={deleteReminder} onSnooze={snoozeReminder} />}</Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
      </AppearanceContext.Provider>
    </SafeAreaProvider>
  );
}
