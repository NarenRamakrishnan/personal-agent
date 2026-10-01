export type ReminderTriggerType = "time" | "location" | "time_and_location";

export type ReminderLocation = {
  type: "coordinate" | "place" | "category";
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
