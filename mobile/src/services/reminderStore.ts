import { Reminder } from "../types/reminder";
type Api = {
  list(): Promise<Reminder[]>;
  create(reminder: Reminder): Promise<Reminder>;
  update(id: string, changes: Partial<Reminder>): Promise<Reminder>;
  remove(id: string): Promise<void>;
};
type Snapshot = { reminders: Reminder[]; loaded: boolean; refreshing: boolean; error: string };
export function createReminderStore(api: Api) {
  let snapshot: Snapshot = { reminders: [], loaded: false, refreshing: false, error: "" };
  const listeners = new Set<() => void>();
  const publish = (changes: Partial<Snapshot>) => { snapshot = { ...snapshot, ...changes }; listeners.forEach(listener => listener()); };
  let revision = 0; let request = 0; let writes = 0; let queue = Promise.resolve();
  const refresh = async () => {
    const token = ++request; const version = revision;
    publish({ refreshing: true });
    try {
      const reminders = await api.list();
      if (token === request && version === revision && writes === 0) publish({ reminders, loaded: true, error: "" });
    } catch (error) { if (token === request && version === revision && writes === 0) publish({ error: error instanceof Error ? error.message : "Could not load reminders." }); }
    finally { if (token === request) publish({ refreshing: false }); }
  };
  function mutate<T>(action: () => Promise<T>): Promise<T> {
    // Invalidate reads as soon as a mutation is queued, not only once it finishes.
    writes++; revision++;
    const result = queue.then(action);
    queue = result.then(() => {}, () => {});
    return result.finally(() => { revision++; writes--; if (!writes) void refresh(); });
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    add: (reminder: Reminder) => mutate(async () => { const saved = await api.create(reminder); publish({ reminders: [saved, ...snapshot.reminders.filter(row => row.id !== saved.id)] }); }),
    update: (id: string, changes: Partial<Reminder>) => mutate(async () => { const saved = await api.update(id, changes); publish({ reminders: snapshot.reminders.map(row => row.id === id ? saved : row) }); }),
    remove: (id: string) => mutate(async () => { await api.remove(id); publish({ reminders: snapshot.reminders.filter(row => row.id !== id) }); }),
  };
}
