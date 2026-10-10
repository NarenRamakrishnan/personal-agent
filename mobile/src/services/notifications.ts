import { Reminder } from "../types/reminder";
export async function enableNotifications() { throw new Error("Native notifications require an iOS/Android development build. Browser reminders remain available."); }
export async function reconcileNotifications(_reminders: Reminder[]) {}
export async function cancelReminderNotification(_id: string) {}
export async function notifyNow(_reminder: Reminder) { throw new Error("Native notifications are unavailable in this browser."); }
export async function cancelAllNotifications() {}
export function listenForNotificationActions(_changed: () => void, _failure: (error: unknown) => void) { return () => {}; }
