import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { contextApi } from "../api/client";
import { Button, Card, Chip, Chips, Field, Notice, Page, ScreenTitle } from "../components/Controls";
import { RootStackParamList } from "../navigation/types";
import { whereText } from "../services/format";
import { formatForField, parseHumanDate, timezoneLabel } from "../services/humanDate";
import { colors, spacing, type } from "../theme";
import { SavedPlace } from "../types/context";
import { Reminder, ReminderLocation, ReminderRepeat, ReminderTriggerType } from "../types/reminder";

type Props = NativeStackScreenProps<RootStackParamList, "ConfirmReminder"> & {
  onSave: (reminder: Reminder) => Promise<void>;
  onUpdate: (id: string, changes: Partial<Reminder>) => Promise<void>;
};

const TRIGGERS: { value: ReminderTriggerType; label: string }[] = [
  { value: "time", label: "At a time" }, { value: "location", label: "Near a place" }, { value: "time_and_location", label: "Time + place" },
];
const PLACE_KINDS: { value: Exclude<ReminderLocation["type"], "coordinate">; label: string }[] = [
  { value: "saved_place", label: "Saved place" }, { value: "place", label: "Place name" }, { value: "category", label: "Type of place" },
];
// Backend category keys (backend/app/places.py) with the words people use.
const CATEGORIES: { key: string; label: string }[] = [
  { key: "grocery_store", label: "Grocery store" }, { key: "pharmacy", label: "Pharmacy" }, { key: "gym", label: "Gym" },
  { key: "coffee_shop", label: "Coffee shop" }, { key: "restaurant", label: "Restaurant" }, { key: "shopping", label: "Shops" }, { key: "university", label: "Campus" },
];

const REPEATS: { value: ReminderRepeat | undefined; label: string }[] = [
  { value: undefined, label: "Doesn't repeat" }, { value: "daily", label: "Every day" }, { value: "weekly", label: "Every week" }, { value: "monthly", label: "Every month" },
];

const quick = (label: string, build: () => Date) => ({ label, build });
const QUICK = [
  quick("Tomorrow at 9", () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }),
  quick("Friday at 9", () => { const d = new Date(); d.setDate(d.getDate() + (((5 - d.getDay() + 7) % 7) || 7)); d.setHours(9, 0, 0, 0); return d; }),
  quick("In 1 hour", () => { const d = new Date(Date.now() + 3600000); d.setSeconds(0, 0); return d; }),
];

export function ConfirmReminderScreen({ navigation, route, onSave, onUpdate }: Props) {
  const { parsed, existing } = route.params;
  const [title, setTitle] = useState(parsed.title);
  const [when, setWhen] = useState(formatForField(parsed.deadline));
  const [trigger, setTrigger] = useState<ReminderTriggerType>(parsed.triggerType);
  const [repeat, setRepeat] = useState<ReminderRepeat | undefined>(parsed.repeat ?? existing?.repeat);
  const startKind = parsed.location?.type === "coordinate" ? "place" : parsed.location?.type ?? "category";
  const [placeKind, setPlaceKind] = useState<Exclude<ReminderLocation["type"], "coordinate">>(startKind);
  const [placeName, setPlaceName] = useState(parsed.location?.type === "category" ? "" : parsed.location?.name ?? "");
  const [category, setCategory] = useState(parsed.location?.category ?? "");
  const [saved, setSaved] = useState<SavedPlace[]>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [id] = useState(() => existing?.id ?? `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const pinned = parsed.location?.type === "coordinate" && parsed.location.latitude !== undefined ? parsed.location : undefined;
  const [usePinned, setUsePinned] = useState(!!pinned);

  useEffect(() => { contextApi.savedPlaces().then(setSaved, () => setSaved([])); }, []);
  const needsTime = trigger !== "location";
  const needsPlace = trigger !== "time";
  const parsedWhen = when.trim() ? parseHumanDate(when) : undefined;

  const location = (): ReminderLocation | undefined => {
    if (!needsPlace) return undefined;
    if (usePinned && pinned) return pinned;
    if (placeKind === "category") return category ? { type: "category", category } : undefined;
    const name = placeName.trim();
    return name ? { type: placeKind, name, ...(parsed.location?.radiusMeters ? { radiusMeters: parsed.location.radiusMeters } : {}) } : undefined;
  };
  const summary = () => {
    const what = title.trim() || "This reminder";
    const where = whereText(location());
    const date = parsedWhen && "date" in parsedWhen ? parsedWhen.date.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    const again = repeat && date ? ` Then ${{ daily: "every day", weekly: "every week", monthly: "every month" }[repeat]}, each time you finish it.` : "";
    if (trigger === "time") return date ? `${what} on ${date}.${again}` : `${what}, once you pick a time.`;
    if (trigger === "location") return where ? `${what} when you're ${where}.` : `${what}, once you pick a place.`;
    return `${what}${where ? ` when you're ${where}` : ""}${date ? `, by ${date}` : ""}. Heedly reminds you near the place and when the time comes close.`;
  };

  const save = async () => {
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = "Add what you want to remember.";
    let deadline: string | undefined;
    if (needsTime) {
      if (!when.trim()) next.when = "Enter a date and time, like Oct 30 at 9:00 AM.";
      else if (parsedWhen && "error" in parsedWhen) next.when = parsedWhen.error;
      else if (parsedWhen && "date" in parsedWhen) {
        if (parsedWhen.date.getTime() < Date.now() - 60000 && !existing?.completed) next.when = "That time has passed. Choose a future time.";
        deadline = parsedWhen.date.toISOString();
      }
    }
    const place = location();
    if (needsPlace && !place) next.place = "Choose a place for this reminder.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      // The API clears a field on an explicit null; an omitted field is left as it was.
      const repeats = deadline ? repeat ?? null : null;
      if (existing) await onUpdate(existing.id, { title: title.trim(), deadline: deadline ?? null, triggerType: trigger, location: place ?? null, repeat: repeats,
        ...(deadline !== existing.deadline ? { snoozedUntil: null, lastNotifiedAt: null } : {}) } as unknown as Partial<Reminder>);
      else await onSave({ id, title: title.trim(), createdAt: new Date().toISOString(), deadline, triggerType: trigger, location: place, completed: false, ...(repeats ? { repeat: repeats } : {}) });
      if (!existing && parsed.additional?.length) navigation.replace("ConfirmReminder", { parsed: { ...parsed.additional[0], additional: parsed.additional.slice(1) } });
      else navigation.goBack();
    } catch (e) { setErrors({ save: e instanceof Error ? e.message : "Couldn't save. Try again." }); }
    finally { setSaving(false); }
  };

  const footer = <>
    <Button title={saving ? "Saving…" : existing ? "Save changes" : "Save reminder"} busy={saving} onPress={() => { void save(); }} />
    <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
  </>;

  return <Page footer={footer}>
    <ScreenTitle>{existing ? "Edit reminder" : "Check your reminder"}</ScreenTitle>
    {errors.save ? <Notice tone="danger">{errors.save}</Notice> : null}
    <Field label="What should I remember?" value={title} onChangeText={setTitle} multiline placeholder="Call the dentist" error={errors.title} />

    <View style={{ gap: spacing.xs }}>
      <Text style={type.fieldLabel}>Remind me</Text>
      <Chips>{TRIGGERS.map(t => <Chip key={t.value} label={t.label} selected={trigger === t.value} onPress={() => setTrigger(t.value)} />)}</Chips>
    </View>

    {needsTime ? <View style={{ gap: spacing.xs }}>
      <Field label="When" value={when} onChangeText={setWhen} placeholder="Oct 30, 2026 at 9:00 AM" error={errors.when}
        helper={parsedWhen && "date" in parsedWhen ? `${parsedWhen.date.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} · ${timezoneLabel(parsedWhen.date)}` : "Type a day and time, like \"tomorrow at 9\", \"10/30 2pm\" or \"in 2 hours\"."} />
      <Chips>{QUICK.map(q => <Chip key={q.label} label={q.label} action accessibilityLabel={`Set time to ${q.label}`} onPress={() => setWhen(formatForField(q.build().toISOString()))} />)}</Chips>
      <Text style={type.fieldLabel}>Repeat</Text>
      <Chips>{REPEATS.map(r => <Chip key={r.label} label={r.label} selected={repeat === r.value} onPress={() => setRepeat(r.value)} accessibilityLabel={`Repeat: ${r.label}`} />)}</Chips>
    </View> : null}

    {needsPlace ? <View style={{ gap: spacing.xs }}>
      <Text style={type.fieldLabel}>Choose a place</Text>
      {pinned ? <Chip label="Pinned location" selected={usePinned} onPress={() => setUsePinned(v => !v)} /> : null}
      {!usePinned ? <>
        <Chips>{PLACE_KINDS.map(k => <Chip key={k.value} label={k.label} selected={placeKind === k.value} onPress={() => setPlaceKind(k.value)} />)}</Chips>
        {placeKind === "category" ? <Chips>{CATEGORIES.map(c => <Chip key={c.key} label={c.label} selected={category === c.key} onPress={() => setCategory(c.key)} />)}</Chips> : null}
        {placeKind === "place" ? <Field label="Place name" value={placeName} onChangeText={setPlaceName} placeholder="Target" /> : null}
        {placeKind === "saved_place" ? (saved?.length
          ? <Chips>{saved.map(p => <Chip key={p.name} label={p.name.charAt(0).toUpperCase() + p.name.slice(1)} selected={placeName.toLowerCase() === p.name.toLowerCase()} onPress={() => setPlaceName(p.name)} />)}</Chips>
          : <View style={{ gap: spacing.xs }}>
              <Text style={type.meta}>{saved ? "No saved places yet. You can still name one like home or work, and set where it is later." : "Loading saved places…"}</Text>
              <Field label="Saved place name" value={placeName} onChangeText={setPlaceName} placeholder="home" />
              <Button title="Add a place" variant="ghost" compact style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} onPress={() => navigation.navigate("Location")} />
            </View>) : null}
      </> : <Text style={type.meta}>{pinned?.latitude?.toFixed(5)}, {pinned?.longitude?.toFixed(5)}</Text>}
      {errors.place ? <Text accessibilityRole="alert" style={[type.meta, { color: colors.danger }]}>{errors.place}</Text> : null}
    </View> : null}

    <Card style={{ backgroundColor: colors.surfaceSubtle }}>
      <Text style={type.fieldLabel}>Your reminder</Text>
      <Text style={type.body}>{summary()}</Text>
    </Card>
    {!existing && parsed.additional?.length ? <Text style={type.meta}>{parsed.additional.length} more {parsed.additional.length === 1 ? "reminder" : "reminders"} to check after this one.</Text> : null}
  </Page>;
}
