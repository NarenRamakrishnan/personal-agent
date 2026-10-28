export type ReminderTriggerType = "time" | "location" | "time_and_location";

export type ReminderLocation = {
  type: "coordinate" | "place" | "category" | "saved_place";
  name?: string;
  category?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
};

export type Reminder = {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  deadline?: string;
  triggerType: ReminderTriggerType;
  location?: ReminderLocation;
  completed: boolean;
  lastNotifiedAt?: string;
  snoozedUntil?: string;
  // Comes back after it's done: the backend makes the next one when this one is completed.
  repeat?: ReminderRepeat;
};

export type ReminderRepeat = "daily" | "weekly" | "monthly";

export type ParsedReminder = {
  intent: "create_reminder";
  title: string;
  deadline?: string;
  triggerType: ReminderTriggerType;
  location?: ReminderLocation;
  repeat?: ReminderRepeat;
  additional?: ParsedReminder[];
};
