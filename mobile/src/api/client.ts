import { Reminder } from "../types/reminder";

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

export type ReminderApi = {
  list(): Promise<Reminder[]>;
  create(reminder: Reminder): Promise<Reminder>;
  update(id: string, changes: Partial<Reminder>): Promise<Reminder>;
  remove(id: string): Promise<void>;
};

export const createReminderApi = (useMocks = true): ReminderApi => {
  let localReminders: Reminder[] = [];

  return {
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
