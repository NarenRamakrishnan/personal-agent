import { ParsedReminder, Reminder } from "../types/reminder";

export type RootStackParamList = {
  Home: undefined;
  AddReminder: undefined;
  ConfirmReminder: { parsed: ParsedReminder };
  ReminderDetail: { reminder: Reminder };
};
