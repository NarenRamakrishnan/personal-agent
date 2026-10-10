import AsyncStorage from "@react-native-async-storage/async-storage";
import { contextApi, reminderApi, stamp } from "../api/client";
import { EvalContext, Evaluation } from "../types/context";
import { notifyNow } from "./notifications";
import { mayNotify } from "./reminderPolicy";
export const LOCATION_ENABLED = "context-assistant:location-enabled";
export const BACKGROUND_ENABLED = "context-assistant:background-enabled";
let queue = Promise.resolve();
export function evaluateContext(context: EvalContext, deliver = true): Promise<Evaluation[]> {
  const result = queue.then(async () => {
    const decisions: Evaluation[] = [];
    if (await AsyncStorage.getItem(LOCATION_ENABLED) !== "true") return decisions;
    const ledger: Record<string, number> = JSON.parse(await AsyncStorage.getItem("context-notification-ledger") ?? "{}");
    for (const reminder of await reminderApi.list()) {
      if (reminder.triggerType === "time" || !mayNotify(reminder) || Date.now() - (ledger[reminder.id] ?? 0) < 1800000) continue;
      const decision = await contextApi.evaluate(reminder, { ...context, ...stamp() }); decisions.push(decision);
      if (deliver && decision.notify && await AsyncStorage.getItem(LOCATION_ENABLED) === "true") {
        await notifyNow(reminder);
        ledger[reminder.id] = Date.now();
        await AsyncStorage.setItem("context-notification-ledger", JSON.stringify(ledger));
        await reminderApi.update(reminder.id, { lastNotifiedAt: new Date(ledger[reminder.id]).toISOString() });
      }
    }
    return decisions;
  });
  queue = result.then(() => undefined, () => undefined); return result;
}
