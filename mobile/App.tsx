import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { AddReminderScreen } from "./src/screens/AddReminderScreen";
import { ConfirmReminderScreen } from "./src/screens/ConfirmReminderScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ReminderDetailScreen } from "./src/screens/ReminderDetailScreen";
import { RootStackParamList } from "./src/navigation/types";
import { mockReminders } from "./src/data/mockReminders";
import { Reminder } from "./src/types/reminder";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [reminders, setReminders] = useState<Reminder[]>(mockReminders);
  const addReminder = (reminder: Reminder) => setReminders((current) => [reminder, ...current]);
  const completeReminder = (id: string) => setReminders((current) => current.map((reminder) => reminder.id === id ? { ...reminder, completed: true } : reminder));
  const deleteReminder = (id: string) => setReminders((current) => current.filter((reminder) => reminder.id !== id));
  const snoozeReminder = (id: string, snoozedUntil: string) => setReminders((current) => current.map((reminder) => reminder.id === id ? { ...reminder, snoozedUntil } : reminder));

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator screenOptions={{ headerShown: true, headerTintColor: "#18212F", headerShadowVisible: false, headerStyle: { backgroundColor: "#F7F8FA" }, contentStyle: { backgroundColor: "#F7F8FA" } }}>
        <Stack.Screen name="Home" options={{ headerShown: false }}>{(props) => <HomeScreen {...props} reminders={reminders} onChange={setReminders} />}</Stack.Screen>
        <Stack.Screen name="AddReminder" options={{ title: "" }}>{(props) => <AddReminderScreen {...props} onSave={addReminder} />}</Stack.Screen>
        <Stack.Screen name="ConfirmReminder" options={{ title: "" }}>{(props) => <ConfirmReminderScreen {...props} onSave={addReminder} />}</Stack.Screen>
        <Stack.Screen name="ReminderDetail" options={{ title: "" }}>{(props) => <ReminderDetailScreen {...props} onComplete={completeReminder} onDelete={deleteReminder} onSnooze={snoozeReminder} />}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
