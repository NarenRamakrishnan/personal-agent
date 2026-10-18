import { ConfigContext, ExpoConfig } from "expo/config";
// A separate disposable identity for local emulator acceptance. Distribution IDs
// remain an explicit owner choice; do not silently claim an app-store identifier.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Context Assistant",
  slug: config.slug ?? "context-aware-personal-assistant",
  android: { ...config.android, ...(process.env.PERSON2_EMULATOR_TEST === "true" ? { package: "com.contextassistant.emulatortest" } : {}) },
});
