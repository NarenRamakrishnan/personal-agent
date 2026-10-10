import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { AppState } from "react-native";
import { stamp } from "../api/client";
import { evaluateContext, LOCATION_ENABLED } from "./context";
import { nearbyPlaces } from "./places";
let handler: (() => void) | undefined;
export const locationPreferenceChanged = () => handler?.();
export async function evaluateFix(fix: Location.LocationObject) {
  if (await AsyncStorage.getItem(LOCATION_ENABLED) !== "true") return;
  if (fix.coords.accuracy !== null && fix.coords.accuracy > 200) return;
  const { latitude, longitude } = fix.coords;
  // Saved/coordinate reminders still work when the places provider is unavailable.
  const places = await nearbyPlaces(latitude, longitude).catch(() => []);
  return evaluateContext({ ...stamp(), latitude, longitude, nearbyPlaces: places });
}
export function watchForegroundContext(failure: (error: unknown) => void) {
  let watcher: Location.LocationSubscription | undefined; let generation = 0; let closed = false;
  let queue = Promise.resolve();
  const reset = () => {
    const token = ++generation; watcher?.remove(); watcher = undefined;
    void (async () => {
      if (closed || AppState.currentState !== "active" || await AsyncStorage.getItem(LOCATION_ENABLED) !== "true") return;
      if (!(await Location.getForegroundPermissionsAsync()).granted) return;
      const next = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 200, timeInterval: 120000 }, fix => {
        queue = queue.then(async () => { if (!closed && token === generation) await evaluateFix(fix); }).catch(failure);
      });
      if (closed || token !== generation) next.remove(); else watcher = next;
    })().catch(failure);
  };
  handler = reset; const subscription = AppState.addEventListener("change", reset); reset();
  return () => { closed = true; generation++; watcher?.remove(); handler = undefined; subscription.remove(); };
}
