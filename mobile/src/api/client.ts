import { ParsedReminder, Reminder } from "../types/reminder";

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

export type ReminderApi = {
  parse(text: string): Promise<ParsedReminder>;
  list(): Promise<Reminder[]>;
  create(reminder: Reminder): Promise<Reminder>;
  update(id: string, changes: Partial<Reminder>): Promise<Reminder>;
  remove(id: string): Promise<void>;
};

export const createReminderApi = (useMocks = true): ReminderApi => {
  let localReminders: Reminder[] = [];

  return {
    async parse(text) {
      if (!useMocks) {
        const response = await fetch(`${API_BASE_URL}/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!response.ok) throw new Error("Unable to parse reminder.");
        return response.json() as Promise<ParsedReminder>;
      }
      return mockParse(text);
    },
    async list() {
      if (useMocks) return [...localReminders];
      const response = await fetch(`${API_BASE_URL}/reminders`);
      if (!response.ok) throw new Error("Unable to load reminders.");
      return response.json() as Promise<Reminder[]>;
    },
    async create(reminder) {
      if (useMocks) {
        localReminders = [reminder, ...localReminders];
        return reminder;
      }
      const response = await fetch(`${API_BASE_URL}/reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reminder),
      });
      if (!response.ok) throw new Error("Unable to create reminder.");
      return response.json() as Promise<Reminder>;
    },
    async update(id, changes) {
      if (useMocks) {
        const existing = localReminders.find((reminder) => reminder.id === id);
        if (!existing) throw new Error("Reminder not found.");
        const updated = { ...existing, ...changes };
        localReminders = localReminders.map((reminder) => (reminder.id === id ? updated : reminder));
        return updated;
      }
      const response = await fetch(`${API_BASE_URL}/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!response.ok) throw new Error("Unable to update reminder.");
      return response.json() as Promise<Reminder>;
    },
    async remove(id) {
      if (useMocks) {
        localReminders = localReminders.filter((reminder) => reminder.id !== id);
        return;
      }
      const response = await fetch(`${API_BASE_URL}/reminders/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to delete reminder.");
    },
  };
};

function mockParse(text: string): ParsedReminder {
  const normalized = text.trim().toLowerCase();
  if (!normalized) throw new Error("Enter a reminder first.");

  const location = normalized.includes("grocery")
    ? { type: "category" as const, category: "grocery_store" }
    : normalized.includes("pharmacy")
      ? { type: "category" as const, category: "pharmacy" }
      : normalized.includes("target")
        ? { type: "place" as const, name: "Target" }
        : undefined;

  let deadline: string | undefined;
  const now = new Date();
  if (normalized.includes("in 30 minutes")) deadline = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  else if (normalized.includes("tomorrow")) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(17, 0, 0, 0);
    deadline = tomorrow.toISOString();
  } else if (normalized.includes("tonight")) {
    const tonight = new Date(now);
    tonight.setHours(20, 0, 0, 0);
    deadline = tonight.toISOString();
  }

  const title = normalized
    .replace(/^remind me to\s*/i, "")
    .replace(/\s+(when i'm|when i am|tonight|tomorrow|in 30 minutes|at \d{1,2}(?::\d{2})?\s*(am|pm)?)\b.*$/i, "")
    .trim()
    .replace(/\.$/, "") || text.trim();

  return {
    intent: "create_reminder",
    title: title.charAt(0).toUpperCase() + title.slice(1),
    deadline,
    triggerType: location ? (deadline ? "time_and_location" : "location") : "time",
    location,
  };
}
