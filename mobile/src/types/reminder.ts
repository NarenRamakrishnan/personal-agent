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
};

export type ParsedReminder = {
  intent: "create_reminder";
  title: string;
  deadline?: string;
  triggerType: ReminderTriggerType;
  location?: ReminderLocation;
};
