// Browsers have no native encrypted vault. The device key lives in this browser's local
// storage so reminders are still there after the tab closes; it is never put in
// AsyncStorage or an EXPO_PUBLIC build variable. Privacy & data can forget it on a shared computer.
const store = () => {
  if (typeof localStorage === "undefined") throw new Error("Browser storage is unavailable. Allow site data for Heedly, or use the phone app.");
  return localStorage;
};

export const credentials = {
  async get(key: string): Promise<string | null> {
    const saved = store().getItem(key);
    if (saved !== null) return saved;
    // Earlier builds kept the key for the tab session only; carry it over once.
    const legacy = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(key);
    if (legacy !== null) { store().setItem(key, legacy); sessionStorage.removeItem(key); }
    return legacy;
  },
  async set(key: string, value: string) { store().setItem(key, value); },
  async forgetAll(prefix: string) {
    const storage = store();
    for (let i = storage.length - 1; i >= 0; i--) { const key = storage.key(i); if (key?.startsWith(prefix)) storage.removeItem(key); }
  },
};
