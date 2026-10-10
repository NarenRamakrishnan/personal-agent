import { ParsedReminder, Reminder } from "../types/reminder";

export type RootStackParamList = {
  Home: undefined;
  Location: undefined;
  Email: { text?: string } | undefined;
  AddReminder: undefined;
  ConfirmReminder: { parsed: ParsedReminder };
  ReminderDetail: { reminder: Reminder };
};
