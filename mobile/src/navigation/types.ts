import { Reminder } from "../types/reminder";

export type RootStackParamList = {
  Home: undefined;
  AddReminder: undefined;
  ReminderDetail: { reminder: Reminder };
};
