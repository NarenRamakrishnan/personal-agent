// Browsers have no native encrypted vault. Keep credentials only for this tab's
// session, never in AsyncStorage/localStorage or an EXPO_PUBLIC build variable.
export const credentials = {
  async get(key: string): Promise<string | null> {
    if (typeof sessionStorage === "undefined") throw new Error("Session storage is unavailable. Use a native build or allow browser session storage.");
    return sessionStorage.getItem(key);
  },
  async set(key: string, value: string) { sessionStorage.setItem(key, value); },
};
