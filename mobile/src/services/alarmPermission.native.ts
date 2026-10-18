import { Platform } from "react-native";
import { canScheduleExactAlarms, openSettings } from "react-native-permissions";
export async function exactAlarmsAllowed() {
  return Platform.OS !== "android" || Number(Platform.Version) < 31 || await canScheduleExactAlarms();
}
export async function requestExactAlarms() {
  if (!await exactAlarmsAllowed()) await openSettings("alarms");
}
