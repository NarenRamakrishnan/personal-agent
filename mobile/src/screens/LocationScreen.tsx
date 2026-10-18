import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { contextApi, stamp } from "../api/client";
import { AsyncButton, Button, Field, Page } from "../components/Controls";
import { EvalContext, Evaluation, SavedPlace } from "../types/context";
import { nearbyPlaces } from "../services/places";
import { evaluateContext, LOCATION_ENABLED } from "../services/context";
import { disableBackgroundContext, enableBackgroundContext, syncBackgroundRegions } from "../services/background";
import { locationPreferenceChanged } from "../services/locationLifecycle";
import { cancelContextNotifications } from "../services/notifications";

export function LocationScreen() {
  const [enabled, setEnabled] = useState(false); const [context, setContext] = useState<EvalContext>();
  const [places, setPlaces] = useState<SavedPlace[]>([]); const [name, setName] = useState("home");
  const [radius, setRadius] = useState("150"); const [decisions, setDecisions] = useState<Evaluation[]>([]);
  const [status, setStatus] = useState("");
  useEffect(() => { void AsyncStorage.getItem(LOCATION_ENABLED).then(value => setEnabled(value === "true")); }, []);
  return <Page><Text style={{ fontSize: 28, fontWeight: "700" }}>Location & places</Text>
    <Text>Location is optional. Enable it to check nearby reminders. Coordinates are sent to the app backend for evaluation and to OpenStreetMap Overpass for nearby places. No GPS polling runs every few seconds.</Text>
    <Text>Location: {enabled ? "enabled" : "disabled"}</Text>
    <AsyncButton title="Enable location" action={async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error("Location permission denied. You can still use time reminders.");
      await AsyncStorage.setItem(LOCATION_ENABLED, "true"); setEnabled(true); locationPreferenceChanged();
    }} />
    <AsyncButton title="Disable all location access in this app" action={async () => {
      await AsyncStorage.setItem(LOCATION_ENABLED, "false"); setEnabled(false); setContext(undefined); locationPreferenceChanged(); await cancelContextNotifications(); await disableBackgroundContext();
    }} />
    <Text>Background mode checks places when you move and can use more battery. It sends coordinates to the same services even when this app is closed. Your OS may delay or stop events.</Text>
    <AsyncButton title="Enable background location & geofences" action={enableBackgroundContext} />
    <AsyncButton title="Stop background location & geofences" action={disableBackgroundContext} />
    <AsyncButton title="Check background status" action={async () => setStatus(await AsyncStorage.getItem("context-background-status") ?? "No background task error recorded.")} />
    <Text>{status}</Text>
    <AsyncButton title="Get current location" action={async () => {
      if (!enabled) throw new Error("Enable location first.");
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (fix.coords.accuracy !== null && fix.coords.accuracy > 200) throw new Error("Location accuracy is too low. Try again outdoors.");
      setContext({ ...stamp(), latitude: fix.coords.latitude, longitude: fix.coords.longitude, nearbyPlaces: [] });
      setStatus(`Accuracy ±${Math.round(fix.coords.accuracy ?? 0)} m`);
    }} />
    {context && <View style={{ gap: 12 }}><Text>{context.latitude?.toFixed(5)}, {context.longitude?.toFixed(5)} — {status}</Text>
      <AsyncButton title="Find nearby places" action={async () => { setContext({ ...context, nearbyPlaces: await nearbyPlaces(context.latitude!, context.longitude!) }); }} />
      <Text>© OpenStreetMap contributors. Nearby does not establish that you are inside a place.</Text>
      {context.nearbyPlaces.map((place, i) => <Text key={i}>{place.name ?? "Unnamed place"} · {place.types.join(", ")} · {Math.round(place.distanceMeters ?? 0)} m</Text>)}
      <AsyncButton title="Evaluate nearby reminders" action={async () => setDecisions(await evaluateContext(context))} />
      {decisions.map(decision => <Text key={decision.reminderId}>{decision.reminderId}: {decision.notify ? "Notify" : "Hold"} · score {decision.score} · {decision.reasons.map(r => r.label).join("; ")}</Text>)}
      <Field label="Saved place name (home, school, work, etc.)" value={name} onChangeText={setName} />
      <Field label="Radius in meters (50–1000)" value={radius} onChangeText={setRadius} />
      <AsyncButton title="Save current location as a place" action={async () => {
        const meters = Number(radius); if (!name.trim() || !Number.isFinite(meters) || meters < 50 || meters > 1000) throw new Error("Enter a name and radius from 50 to 1000 meters.");
        await contextApi.savePlace({ name: name.trim().toLowerCase().replace(/\s+/g, "_"), latitude: context.latitude!, longitude: context.longitude!, radiusMeters: meters });
        setPlaces(await contextApi.savedPlaces());
        await syncBackgroundRegions();
      }} />
    </View>}
    <AsyncButton title="Load saved places" action={async () => setPlaces(await contextApi.savedPlaces())} />
    {places.map(place => <View key={place.name} style={{ gap: 8 }}><Text>{place.name} · {place.radiusMeters} m</Text><AsyncButton title={`Delete ${place.name}`} action={async () => { await contextApi.deletePlace(place.name); setPlaces(await contextApi.savedPlaces()); await syncBackgroundRegions(); }} /></View>)}
  </Page>;
}
