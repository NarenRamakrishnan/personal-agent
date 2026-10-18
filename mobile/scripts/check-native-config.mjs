// Validate generated permission configuration without building or writing native projects.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const mobile = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../node_modules/expo/bin/cli", import.meta.url));
const result = spawnSync(process.execPath, [cli, "config", "--type", "introspect", "--json"], { cwd: mobile, encoding: "utf8", timeout: 60000 });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("Expo native config introspection failed.");
const config = JSON.parse(result.stdout);
const mods = config._internal?.modResults;
const permissions = new Set((mods?.android?.manifest?.manifest?.["uses-permission"] ?? []).map(item => item.$["android:name"]));
for (const permission of ["RECORD_AUDIO", "ACCESS_FINE_LOCATION", "ACCESS_BACKGROUND_LOCATION", "FOREGROUND_SERVICE_LOCATION", "SCHEDULE_EXACT_ALARM"]) {
  if (!permissions.has(`android.permission.${permission}`)) throw new Error(`Missing Android permission: ${permission}`);
}
const plist = mods?.ios?.infoPlist;
for (const key of ["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription", "NSLocationWhenInUseUsageDescription", "NSLocationAlwaysAndWhenInUseUsageDescription"]) {
  if (!plist?.[key]) throw new Error(`Missing iOS permission explanation: ${key}`);
}
if (!plist?.UIBackgroundModes?.includes("location")) throw new Error("Missing iOS background location mode.");
if (!config.plugins.some(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-secure-store")) throw new Error("Missing SecureStore plugin.");
console.log("Native config verified: microphone, speech, foreground/background location, exact alarms and SecureStore.");
console.log("This validates generated configuration only, not native compilation or device delivery.");
