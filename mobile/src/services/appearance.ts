import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext } from "react";
import { Scheme } from "../theme";

// "system" follows the phone or browser; light and dark pin the look.
export type AppearancePreference = "system" | Scheme;
const KEY = "heedly.appearance";

export async function loadAppearance(): Promise<AppearancePreference> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch { return "system"; }
}

export async function saveAppearance(preference: AppearancePreference) {
  try { await AsyncStorage.setItem(KEY, preference); } catch { /* the choice still applies for this visit */ }
}

export const resolveScheme = (preference: AppearancePreference, system: string | null | undefined): Scheme =>
  preference === "system" ? (system === "dark" ? "dark" : "light") : preference;

export const AppearanceContext = createContext<{ preference: AppearancePreference; setPreference: (preference: AppearancePreference) => void }>({
  preference: "system", setPreference: () => {},
});
export const useAppearance = () => useContext(AppearanceContext);
