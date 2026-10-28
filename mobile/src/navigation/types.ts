import { SessionDetail } from "../api/sessions";
import { ParsedReminder, Reminder } from "../types/reminder";

export type RootStackParamList = {
  Home: { notice?: string; deleted?: Reminder } | undefined;
  Listen: { typing?: boolean } | undefined;
  Review: { detail: SessionDetail; unsent?: string[] };
  Settings: undefined;
  Location: undefined;
  Privacy: undefined;
  Email: { text?: string; draftId?: string } | undefined;
  ConfirmReminder: { parsed: ParsedReminder; existing?: Reminder };
  ReminderDetail: { reminder: Reminder };
};
