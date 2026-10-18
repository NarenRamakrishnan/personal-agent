import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { reminderApi } from "./src/api/client";
import { errorMessage } from "./src/components/Controls";
import { cancelReminderNotification, listenForNotificationActions, reconcileNotifications } from "./src/services/notifications";
import { AddReminderScreen } from "./src/screens/AddReminderScreen";
import { ConfirmReminderScreen } from "./src/screens/ConfirmReminderScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ReminderDetailScreen } from "./src/screens/ReminderDetailScreen";
import { RootStackParamList } from "./src/navigation/types";
import { Reminder } from "./src/types/reminder";
import { LocationScreen } from "./src/screens/LocationScreen";
import { EmailScreen } from "./src/screens/EmailScreen";
import { PrivacyScreen } from "./src/screens/PrivacyScreen";
import { syncBackgroundRegions } from "./src/services/background";
import { watchForegroundContext } from "./src/services/locationLifecycle";
import { createReminderStore } from "./src/services/reminderStore";

const Stack = createNativeStackNavigator<RootStackParamList>();

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
  const completeReminder = (id: string) => update(id, { completed: true });
  const deleteReminder = async (id: string) => { await store.remove(id); await cancelReminderNotification(id); };
  const snoozeReminder = (id: string, snoozedUntil: string) => update(id, { snoozedUntil });

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator screenOptions={{ headerShown: true, headerTintColor: "#18212F", headerShadowVisible: false, headerStyle: { backgroundColor: "#F7F8FA" }, contentStyle: { backgroundColor: "#F7F8FA" } }}>
        <Stack.Screen name="Home" options={{ headerShown: false }}>{(props) => <HomeScreen {...props} reminders={reminders} onRefresh={refresh} refreshing={refreshing} error={error} />}</Stack.Screen>
        <Stack.Screen name="AddReminder" component={AddReminderScreen} options={{ title: "" }} />
        <Stack.Screen name="Location" component={LocationScreen} options={{ title: "Location" }} />
        <Stack.Screen name="Email" component={EmailScreen} options={{ title: "Email draft" }} />
        <Stack.Screen name="Privacy" options={{ title: "Privacy" }}>{() => <PrivacyScreen onChanged={refresh} />}</Stack.Screen>
        <Stack.Screen name="ConfirmReminder" options={{ title: "" }}>{(props) => <ConfirmReminderScreen {...props} onSave={addReminder} />}</Stack.Screen>
        <Stack.Screen name="ReminderDetail" options={{ title: "" }}>{(props) => <ReminderDetailScreen {...props} reminders={reminders} onComplete={completeReminder} onDelete={deleteReminder} onSnooze={snoozeReminder} />}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
