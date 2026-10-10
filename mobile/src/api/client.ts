import AsyncStorage from "@react-native-async-storage/async-storage";
import { ParsedReminder, Reminder } from "../types/reminder";
import { EvalContext, Evaluation, SavedPlace } from "../types/context";
import { mockReminders } from "../data/mockReminders";
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const USE_MOCKS = process.env.EXPO_PUBLIC_USE_MOCKS !== "false";
export const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const stamp = () => ({ now: new Date().toISOString(), timezone: timezone() });
export const MOCK_REMINDERS_KEY = "context-assistant:mock-reminders:v1";

export async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method, signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(process.env.EXPO_PUBLIC_API_KEY ? { "X-API-Key": process.env.EXPO_PUBLIC_API_KEY } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${response.status}).`);
    }
    return response.status === 204 ? undefined as T : await response.json() as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("The server took too long. Try again.");
    throw error;
  } finally { clearTimeout(timer); }
}

export function createReminderApi(useMocks = USE_MOCKS) {
  const load = async (): Promise<Reminder[]> => {
    const stored = await AsyncStorage.getItem(MOCK_REMINDERS_KEY);
    return stored ? JSON.parse(stored) : [...mockReminders];
  };
  const save = (rows: Reminder[]) => AsyncStorage.setItem(MOCK_REMINDERS_KEY, JSON.stringify(rows));
  let pending = Promise.resolve();
  function mutate<T>(fn: (rows: Reminder[]) => Promise<T>): Promise<T> {
    const result = pending.then(async () => fn(await load()));
    pending = result.then(() => undefined, () => undefined);
    return result;
  }
  return {
    async parse(text: string): Promise<ParsedReminder> {
      if (useMocks) return mockParse(text);
      const parsed = await request<ParsedReminder>("/parse", "POST", { text, ...stamp() });
      if (!parsed.title || !["time", "location", "time_and_location"].includes(parsed.triggerType)) throw new Error("The parser returned an invalid reminder. Try again.");
      return parsed;
    },
    async list(): Promise<Reminder[]> {
      if (useMocks) { await pending; return load(); }
      const result: Reminder[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = await request<Reminder[]>(`/reminders?limit=200&offset=${offset}`);
        result.push(...page);
        if (page.length < 200) return result;
      }
    },
    async create(reminder: Reminder): Promise<Reminder> {
      if (!useMocks) return request("/reminders", "POST", reminder);
      return mutate(async rows => { await save([reminder, ...rows.filter(r => r.id !== reminder.id)]); return reminder; });
    },
    async update(id: string, changes: Partial<Reminder>): Promise<Reminder> {
      if (!useMocks) return request(`/reminders/${encodeURIComponent(id)}`, "PATCH", changes);
      return mutate(async rows => {
        const row = rows.find(r => r.id === id);
        if (!row) throw new Error("Reminder not found.");
        const updated = { ...row, ...changes };
        await save(rows.map(r => r.id === id ? updated : r)); return updated;
      });
    },
    async remove(id: string): Promise<void> {
      if (!useMocks) return request(`/reminders/${encodeURIComponent(id)}`, "DELETE");
      return mutate(async rows => { await save(rows.filter(r => r.id !== id)); });
    },
  };
}
export const reminderApi = createReminderApi();
export const contextApi = {
  async savedPlaces(): Promise<SavedPlace[]> {
    return USE_MOCKS ? JSON.parse(await AsyncStorage.getItem("saved-places") ?? "[]") : request("/saved-places");
  },
  async savePlace(place: SavedPlace): Promise<SavedPlace> {
    if (!USE_MOCKS) return request(`/saved-places/${encodeURIComponent(place.name)}`, "PUT", place);
    await AsyncStorage.setItem("saved-places", JSON.stringify([...(await this.savedPlaces()).filter(p => p.name !== place.name), place])); return place;
  },
  async deletePlace(name: string) {
    if (!USE_MOCKS) return request<void>(`/saved-places/${encodeURIComponent(name)}`, "DELETE");
    await AsyncStorage.setItem("saved-places", JSON.stringify((await this.savedPlaces()).filter(p => p.name !== name)));
  },
  async evaluate(reminder: Reminder, context: EvalContext): Promise<Evaluation> {
    if (!USE_MOCKS) return request("/evaluate-reminder", "POST", { reminder, context });
    return { reminderId: reminder.id, notify: false, score: 0, timeStatus: "mock", reasons: [{ label: "Use real API mode to evaluate context", points: 0 }] };
  },
};

export function mockParse(text: string, now = new Date()): ParsedReminder {
  const input = text.trim();
  if (!input) throw new Error("Enter a reminder first.");
  const lower = input.toLowerCase();
  const location = lower.includes("grocery") ? { type: "category" as const, category: "grocery_store" }
    : lower.includes("pharmacy") ? { type: "category" as const, category: "pharmacy" }
    : lower.includes("home") ? { type: "saved_place" as const, name: "home" }
    : lower.includes("target") ? { type: "place" as const, name: "Target" } : undefined;
  let deadline: string | undefined;
  const relative = lower.match(/in (\d+|five|two|ten|thirty) minutes?/);
  if (relative) {
    const words: Record<string, number> = { five: 5, two: 2, ten: 10, thirty: 30 };
    deadline = new Date(now.getTime() + (words[relative[1]] ?? Number(relative[1])) * 60000).toISOString();
  } else if (/tomorrow|tonight|today|at \d/.test(lower)) {
    const date = new Date(now);
    if (lower.includes("tomorrow")) date.setDate(date.getDate() + 1);
    const time = lower.match(/(?:at|before) (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    let hour = time ? Number(time[1]) : lower.includes("tonight") ? 20 : 17;
    if (time?.[3] === "pm" && hour < 12) hour += 12;
    if (time?.[3] === "am" && hour === 12) hour = 0;
    if (!time?.[3] && hour < 12) hour += 12;
    date.setHours(hour, Number(time?.[2] ?? 0), 0, 0); deadline = date.toISOString();
  }
  const title = input.replace(/^remind me(?: in (?:\w+) minutes?)? to\s*/i, "")
    .replace(/\s+(when |if |tonight|tomorrow|today|in \w+ minutes|at \d).*$/i, "").replace(/\.$/, "").trim();
  return { intent: "create_reminder", title: title || input, deadline, location, triggerType: location ? deadline ? "time_and_location" : "location" : "time" };
}
