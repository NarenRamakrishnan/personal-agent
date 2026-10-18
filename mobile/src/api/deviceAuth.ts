export interface CredentialStore { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> }
export const credentialKey = (base: string) => `device.${Array.from(base.replace(/\/$/, "")).map(char => char.charCodeAt(0).toString(16).padStart(4, "0")).join("")}`;

export function createDeviceAuth(base: string, store: CredentialStore, fetcher: typeof fetch = (...args) => fetch(...args)) {
  const key = credentialKey(base);
  let pending: Promise<string> | undefined;
  return {
    getToken(): Promise<string> {
      if (!pending) {
        pending = (async () => {
          const saved = await store.get(key);
          if (saved) return saved;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          try {
            const response = await fetcher(`${base}/devices`, { method: "POST", signal: controller.signal });
            if (!response.ok) throw new Error(`Device registration failed (${response.status}). Try again later.`);
            const data = await response.json();
            if (typeof data.token !== "string" || !data.token || typeof data.deviceId !== "string") throw new Error("Invalid device registration response.");
            // Fail closed if durable storage fails; do not make authenticated calls
            // with an identity the device cannot restore on its next launch.
            await store.set(key, data.token);
            return data.token;
          } finally { clearTimeout(timer); }
        })().finally(() => { pending = undefined; });
      }
      return pending;
    },
  };
}
