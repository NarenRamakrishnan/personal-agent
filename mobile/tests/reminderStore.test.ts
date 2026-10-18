import { expect, it, vi } from "vitest";
import { createReminderStore } from "../src/services/reminderStore";
import { Reminder } from "../src/types/reminder";
const row: Reminder = { id: "r", title: "Milk", triggerType: "time", completed: false, createdAt: "2026-01-01T00:00:00Z" };
function setup() {
  let rows = [row];
  const api = { list: vi.fn(async () => rows), create: vi.fn(async (r: Reminder) => { rows = [r, ...rows]; return r; }), update: vi.fn(async (id: string, changes: Partial<Reminder>) => { const saved = { ...rows.find(r => r.id === id)!, ...changes }; rows = rows.map(r => r.id === id ? saved : r); return saved; }), remove: vi.fn(async (id: string) => { rows = rows.filter(r => r.id !== id); }) };
  return { api, store: createReminderStore(api) };
}
it("does not let a delayed pre-completion refresh resurrect an active reminder", async () => {
  const { api, store } = setup(); await store.refresh(); let resolve!: (rows: Reminder[]) => void;
  api.list.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const pending = store.refresh();
  await store.update("r", { completed: true }); resolve([row]); await pending;
  await vi.waitFor(() => expect(store.getSnapshot().reminders[0].completed).toBe(true));
});
it("does not let an older refresh overwrite a newer list", async () => {
  const { api, store } = setup(); let resolve!: (rows: Reminder[]) => void;
  api.list.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValueOnce([{ ...row, completed: true }]);
  const pending = store.refresh(); await store.refresh(); resolve([row]); await pending; expect(store.getSnapshot().reminders[0].completed).toBe(true);
});
it("serializes writes and refreshes from the server afterward", async () => { const { store } = setup(); await store.refresh(); await Promise.all([store.update("r", { title: "Bread" }), store.update("r", { completed: true })]); await vi.waitFor(() => expect(store.getSnapshot().reminders[0]).toMatchObject({ title: "Bread", completed: true })); });
it("recovers after a failed mutation and reports list errors", async () => { const { api, store } = setup(); api.update.mockRejectedValueOnce(new Error("Offline")); await expect(store.update("r", {})).rejects.toThrow("Offline"); await store.update("r", { completed: true }); api.list.mockRejectedValueOnce(new Error("Cannot connect")); await store.refresh(); expect(store.getSnapshot().error).toBe("Cannot connect"); });
