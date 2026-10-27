import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { contextApi, reminderApi } from "../api/client";
import { BACKGROUND_ENABLED, LOCATION_ENABLED } from "./context";
import { evaluateFix } from "./locationLifecycle";
const GEO = "context-assistant-geofence"; const UPDATES = "context-assistant-location";
let consentGeneration = 0;
async function rememberError(error: unknown) {
  // No coordinates, transcripts, or task payloads are logged.
  await AsyncStorage.setItem("context-background-status", `Last task failed at ${new Date().toISOString()}. Reopen Location to retry.`);
}
TaskManager.defineTask<{ eventType: Location.GeofencingEventType; region: Location.LocationRegion }>(GEO, async ({ data, error }) => {
  if (error) { await rememberError(error); return; }
  if (await AsyncStorage.getItem(BACKGROUND_ENABLED) !== "true" || data?.eventType !== Location.GeofencingEventType.Enter) return;
  try { await evaluateFix(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })); }
  catch (e) { await rememberError(e); }
});
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(UPDATES, async ({ data, error }) => {
  if (error) { await rememberError(error); return; }
  if (await AsyncStorage.getItem(BACKGROUND_ENABLED) !== "true") return;
  const fix = data?.locations.at(-1); if (!fix) return;
  try { await evaluateFix(fix); } catch (e) { await rememberError(e); }
});
export async function syncBackgroundRegions() {
  if (await AsyncStorage.getItem(BACKGROUND_ENABLED) !== "true") return;
  const places = await contextApi.savedPlaces();
  const reminders = await reminderApi.list();
  const coordinates = reminders.filter(r => !r.completed && r.location?.type === "coordinate" && r.location.latitude !== undefined && r.location.longitude !== undefined)
    .map(r => ({ identifier: `reminder:${r.id}`, latitude: r.location!.latitude!, longitude: r.location!.longitude!, radius: r.location!.radiusMeters ?? 150, notifyOnEnter: true, notifyOnExit: false }));
  const regions = [...places.map(p => ({ identifier: `place:${p.name}`, latitude: p.latitude, longitude: p.longitude, radius: p.radiusMeters, notifyOnEnter: true, notifyOnExit: false })), ...coordinates];
  if (regions.length > 20) throw new Error("At most 20 geofences are supported. Remove unused saved places or coordinate reminders.");
  if (await AsyncStorage.getItem(BACKGROUND_ENABLED) !== "true") return;
  if (regions.length) await Location.startGeofencingAsync(GEO, regions);
  else if (await Location.hasStartedGeofencingAsync(GEO)) await Location.stopGeofencingAsync(GEO);
  if (await AsyncStorage.getItem(BACKGROUND_ENABLED) !== "true" && await Location.hasStartedGeofencingAsync(GEO)) await Location.stopGeofencingAsync(GEO);
}
export async function enableBackgroundContext() {
  const generation = ++consentGeneration;
  if (await AsyncStorage.getItem(LOCATION_ENABLED) !== "true") throw new Error("Enable foreground location first.");
  if (!await TaskManager.isAvailableAsync()) throw new Error("Background tasks need a native development build.");
  if (!(await Location.requestBackgroundPermissionsAsync()).granted) throw new Error("Background location denied. Foreground reminders still work.");
  if (generation !== consentGeneration || await AsyncStorage.getItem(LOCATION_ENABLED) !== "true") return;
  await AsyncStorage.setItem(BACKGROUND_ENABLED, "true");
  if (generation !== consentGeneration) { await disableBackgroundContext(); return; }
  try {
    await syncBackgroundRegions();
    if (await AsyncStorage.getItem(BACKGROUND_ENABLED) !== "true") return;
    await Location.startLocationUpdatesAsync(UPDATES, { accuracy: Location.Accuracy.Balanced, distanceInterval: 200, timeInterval: 120000, deferredUpdatesDistance: 200, deferredUpdatesInterval: 120000, pausesUpdatesAutomatically: true, showsBackgroundLocationIndicator: true,
      ...(Platform.OS === "android" ? { foregroundService: { notificationTitle: "Location reminders active", notificationBody: "Heedly checks places as you move." } } : {}) });
    if (await AsyncStorage.getItem(BACKGROUND_ENABLED) !== "true") await disableBackgroundContext();
  } catch (e) { await disableBackgroundContext(); throw e; }
}
export async function disableBackgroundContext() {
  consentGeneration++;
  await AsyncStorage.setItem(BACKGROUND_ENABLED, "false");
  const results = await Promise.allSettled([
    (async () => { if (await Location.hasStartedGeofencingAsync(GEO)) await Location.stopGeofencingAsync(GEO); })(),
    (async () => { if (await Location.hasStartedLocationUpdatesAsync(UPDATES)) await Location.stopLocationUpdatesAsync(UPDATES); })(),
  ]);
  const failure = results.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}
