import AsyncStorage from "@react-native-async-storage/async-storage";
import { Reminder } from "../types/reminder";
export const HELD_KEY = "context-assistant:held-notifications";
export const LEDGER_KEY = "context-notification-ledger";
export type HeldNotification = { until: string; fingerprint: string };
export const fingerprint = (row: Reminder) => JSON.stringify([row.title, row.description, row.deadline, row.triggerType, row.snoozedUntil, row.location?.type, row.location?.name, row.location?.category, row.location?.latitude, row.location?.longitude, row.location?.radiusMeters]);
export async function loadHeld(): Promise<Record<string, HeldNotification>> { return JSON.parse(await AsyncStorage.getItem(HELD_KEY) ?? "{}"); }
export async function saveHeld(rows: Record<string, HeldNotification>) { await AsyncStorage.setItem(HELD_KEY, JSON.stringify(rows)); }
let ledgerQueue = Promise.resolve();
function updateLedger(action: () => Promise<void>) { const result = ledgerQueue.then(action); ledgerQueue = result.catch(() => {}); return result; }
export function reserveCooldown(id: string, until: string) { return updateLedger(async () => {
  const ledger = JSON.parse(await AsyncStorage.getItem(LEDGER_KEY) ?? "{}"); ledger[id] = Date.parse(until);
  await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
}); }
export function releaseCooldown(id: string, until: string) { return updateLedger(async () => {
  const ledger = JSON.parse(await AsyncStorage.getItem(LEDGER_KEY) ?? "{}");
  if (ledger[id] === Date.parse(until) && ledger[id] > Date.now()) { delete ledger[id]; await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); }
}); }
