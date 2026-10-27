import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { contextApi, stamp } from "../api/client";
import { AsyncButton, Badge, Button, Card, Field, Notice, Page, ScreenTitle, SectionHeader } from "../components/Controls";
import { EvalContext, Evaluation, SavedPlace } from "../types/context";
import { nearbyPlaces } from "../services/places";
import { evaluateContext, LOCATION_ENABLED } from "../services/context";
import { disableBackgroundContext, enableBackgroundContext, syncBackgroundRegions } from "../services/background";
import { locationPreferenceChanged } from "../services/locationLifecycle";
import { cancelContextNotifications } from "../services/notifications";
import { spacing, type } from "../theme";

const pretty = (name: string) => name.replaceAll("_", " ").replace(/^\w/, c => c.toUpperCase());

export function LocationScreen() {
  const [enabled, setEnabled] = useState(false); const [context, setContext] = useState<EvalContext>();
  const [places, setPlaces] = useState<SavedPlace[]>(); const [name, setName] = useState("home");
  const [radius, setRadius] = useState("150"); const [decisions, setDecisions] = useState<Evaluation[]>([]);
  const [status, setStatus] = useState(""); const [placesError, setPlacesError] = useState("");
  const [diagnostics, setDiagnostics] = useState(false);
  const loadPlaces = async () => { setPlacesError(""); try { setPlaces(await contextApi.savedPlaces()); } catch (e) { setPlacesError(e instanceof Error ? e.message : "Couldn't load saved places."); } };
  useEffect(() => { void AsyncStorage.getItem(LOCATION_ENABLED).then(value => setEnabled(value === "true")); void loadPlaces(); }, []);
  const locate = async () => {
    if (!enabled) throw new Error("Turn on location reminders first.");
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    if (fix.coords.accuracy !== null && fix.coords.accuracy > 200) throw new Error("Location accuracy is too low. Try again outdoors.");
    const next = { ...stamp(), latitude: fix.coords.latitude, longitude: fix.coords.longitude, nearbyPlaces: [] };
    setContext(next); setStatus(`Accuracy ±${Math.round(fix.coords.accuracy ?? 0)} m`); return next;
  };

  return <Page>
    <ScreenTitle subtitle="Get reminded when you're near the right place, like a grocery store for milk or home for the laundry.">Location</ScreenTitle>

    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={type.cardTitle}>Location reminders</Text>
        <Badge label={enabled ? "On" : "Off"} tone={enabled ? "new" : "neutral"} />
      </View>
      <Text style={type.meta}>When location is on, coordinates are sent to Heedly's backend and to OpenStreetMap Overpass for nearby places. Heedly doesn't poll GPS every few seconds.</Text>
      {enabled
        ? <AsyncButton title="Turn off location" variant="secondary" compact action={async () => {
            await AsyncStorage.setItem(LOCATION_ENABLED, "false"); setEnabled(false); setContext(undefined); locationPreferenceChanged(); await cancelContextNotifications(); await disableBackgroundContext();
          }} />
        : <AsyncButton title="Turn on location" compact action={async () => {
            const permission = await Location.requestForegroundPermissionsAsync();
            if (!permission.granted) throw new Error("Location permission denied. You can still use time reminders.");
            await AsyncStorage.setItem(LOCATION_ENABLED, "true"); setEnabled(true); locationPreferenceChanged();
          }} />}
    </Card>

    <Card>
      <Text style={type.cardTitle}>Background location</Text>
      <Text style={type.meta}>Check places while Heedly is closed. This may use more battery, and your device may delay alerts.</Text>
      <AsyncButton title="Turn on background location" variant="secondary" compact action={enableBackgroundContext} />
      <AsyncButton title="Stop background location" variant="ghost" compact action={disableBackgroundContext} />
      <AsyncButton title="Check background status" variant="ghost" compact action={async () => setStatus(await AsyncStorage.getItem("context-background-status") ?? "No background task error recorded.")} />
      {status ? <Text style={type.meta}>{status}</Text> : null}
    </Card>

    <View style={{ gap: spacing.sm }}>
      <SectionHeader title="Saved places" count={places?.length} />
      {placesError ? <Notice tone="danger">{placesError}</Notice> : null}
      {places && !places.length ? <Text style={type.meta}>Save a place for reminders like "when I'm near home."</Text> : null}
      {places?.map(place => <Card key={place.name}>
        <Text style={type.cardTitle}>{pretty(place.name)}</Text>
        <Text style={type.meta}>Within {place.radiusMeters} meters</Text>
        <AsyncButton title="Delete" variant="dangerGhost" compact accessibilityLabel={`Delete ${place.name}`} action={async () => { await contextApi.deletePlace(place.name); await loadPlaces(); await syncBackgroundRegions(); }} />
      </Card>)}
      <Card>
        <Text style={type.cardTitle}>Add a place</Text>
        <Field label="Place name" value={name} onChangeText={setName} placeholder="home" />
        <Field label="Distance in meters" value={radius} onChangeText={setRadius} keyboardType="numeric" helper="Choose a distance from 50 to 1,000 meters." />
        <AsyncButton title="Save my current location" compact action={async () => {
          const meters = Number(radius); if (!name.trim() || !Number.isFinite(meters) || meters < 50 || meters > 1000) throw new Error("Enter a name and a distance from 50 to 1,000 meters.");
          const here = context ?? await locate();
          await contextApi.savePlace({ name: name.trim().toLowerCase().replace(/\s+/g, "_"), latitude: here.latitude!, longitude: here.longitude!, radiusMeters: meters });
          await loadPlaces(); await syncBackgroundRegions();
        }} />
      </Card>
    </View>

    <Button title={diagnostics ? "Hide location diagnostics" : "Location diagnostics"} variant="ghost" onPress={() => setDiagnostics(v => !v)} />
    {diagnostics ? <Card>
      <AsyncButton title="Get current location" variant="secondary" compact action={locate} />
      {context ? <View style={{ gap: spacing.xs }}>
        <Text style={type.meta}>{context.latitude?.toFixed(5)}, {context.longitude?.toFixed(5)} · {status}</Text>
        <AsyncButton title="Find nearby places" variant="secondary" compact action={async () => { setContext({ ...context, nearbyPlaces: await nearbyPlaces(context.latitude!, context.longitude!) }); }} />
        <Text style={type.meta}>© OpenStreetMap contributors. Nearby does not mean you are inside a place.</Text>
        {context.nearbyPlaces.slice(0, 20).map((place, i) => <Text key={i} style={type.meta}>{place.name ?? "Unnamed place"} · {place.types.join(", ") || "named place"} · {Math.round(place.distanceMeters ?? 0)} m</Text>)}
        <AsyncButton title="Check my reminders here" variant="secondary" compact action={async () => setDecisions(await evaluateContext(context))} />
        {decisions.map(decision => <Text key={decision.reminderId} style={type.meta}>{decision.reminderId}: {decision.notify ? "Notify" : "Hold"} · score {decision.score} · {decision.reasons.map(r => r.label).join("; ")}</Text>)}
      </View> : null}
    </Card> : null}
  </Page>;
}
