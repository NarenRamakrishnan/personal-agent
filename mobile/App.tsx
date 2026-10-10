import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { reminderApi } from "./src/api/client";
import { errorMessage } from "./src/components/Controls";
import { cancelReminderNotification, listenForNotificationActions, reconcileNotifications } from "./src/services/notifications";
import { AddReminderScreen } from "./src/screens/AddReminderScreen";
import { ConfirmReminderScreen } from "./src/screens/ConfirmReminderScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ReminderDetailScreen } from "./src/screens/ReminderDetailScreen";
import { RootStackParamList } from "./src/navigation/types";
import { mockReminders } from "./src/data/mockReminders";
import { Reminder } from "./src/types/reminder";
import { LocationScreen } from "./src/screens/LocationScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => { setRefreshing(true); try { setReminders(await reminderApi.list()); setLoaded(true); setError(""); } catch (e) { setError(errorMessage(e)); } finally { setRefreshing(false); } };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => listenForNotificationActions(() => { void refresh(); }, e => setError(errorMessage(e))), []);
  useEffect(() => { if (loaded) void reconcileNotifications(reminders).catch(e => setError(errorMessage(e))); }, [reminders, loaded]);
  const addReminder = async (reminder: Reminder) => { const saved = await reminderApi.create(reminder); setReminders(current => [saved, ...current.filter(r => r.id !== saved.id)]); };
  const update = async (id: string, changes: Partial<Reminder>) => { const saved = await reminderApi.update(id, changes); setReminders(current => current.map(r => r.id === id ? saved : r)); };
  const completeReminder = (id: string) => update(id, { completed: true });
  const deleteReminder = async (id: string) => { await reminderApi.remove(id); setReminders(current => current.filter(r => r.id !== id)); await cancelReminderNotification(id); };
  const snoozeReminder = (id: string, snoozedUntil: string) => update(id, { snoozedUntil });

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator screenOptions={{ headerShown: true, headerTintColor: "#18212F", headerShadowVisible: false, headerStyle: { backgroundColor: "#F7F8FA" }, contentStyle: { backgroundColor: "#F7F8FA" } }}>
        <Stack.Screen name="Home" options={{ headerShown: false }}>{(props) => <HomeScreen {...props} reminders={reminders} onRefresh={refresh} refreshing={refreshing} error={error} />}</Stack.Screen>
        <Stack.Screen name="AddReminder" component={AddReminderScreen} options={{ title: "" }} />
        <Stack.Screen name="Location" component={LocationScreen} options={{ title: "Location" }} />
        <Stack.Screen name="ConfirmReminder" options={{ title: "" }}>{(props) => <ConfirmReminderScreen {...props} onSave={addReminder} />}</Stack.Screen>
        <Stack.Screen name="ReminderDetail" options={{ title: "" }}>{(props) => <ReminderDetailScreen {...props} reminders={reminders} onComplete={completeReminder} onDelete={deleteReminder} onSnooze={snoozeReminder} />}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
