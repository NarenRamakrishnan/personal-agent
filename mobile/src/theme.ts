import { Platform, StyleSheet, TextStyle, ViewStyle } from "react-native";

// Heedly design tokens (visual spec written with Codex, 2026-10-27; dark palette 2026-10-28).
// `onSolid` is the label/icon color on solid brand, danger and mic fills.
const light = {
  background: "#FAF8F2",
  surface: "#FFFFFF",
  surfaceSubtle: "#F0F3EC",
  textPrimary: "#20352B",
  textSecondary: "#56665B",
  brandGreen: "#0B582F",
  brandPressed: "#084525",
  cream: "#FDF3DE",
  onSolid: "#FDF3DE",
  accent: "#79501B",
  accentSurface: "#FFF0D1",
  danger: "#A82E32",
  dangerPressed: "#8A2428",
  dangerSurface: "#FCEBEC",
  success: "#20603B",
  successSurface: "#EAF4EB",
  border: "#D9E0D5",
  controlBorder: "#788477",
  micActive: "#A13B20",
  micSurface: "#FFF0E8",
  disabledSurface: "#E6E9E1",
  scrim: "rgba(32,53,43,0.40)",
};
export type Palette = typeof light;

const dark: Palette = {
  background: "#111B15",
  surface: "#1B2920",
  surfaceSubtle: "#243329",
  textPrimary: "#F5EEDC",
  textSecondary: "#B9C5B4",
  brandGreen: "#A5D6A7",
  brandPressed: "#82B38C",
  cream: "#FDF3DE",
  onSolid: "#102019",
  accent: "#E8C184",
  accentSurface: "#352D1E",
  danger: "#F2A09B",
  dangerPressed: "#DE807E",
  dangerSurface: "#3A2425",
  success: "#A7D6AE",
  successSurface: "#21362A",
  border: "#3A4B3D",
  controlBorder: "#83957E",
  micActive: "#F2AA83",
  micSurface: "#38291F",
  disabledSurface: "#2D3A2F",
  scrim: "rgba(5,12,8,0.72)",
};

export const palettes = { light, dark };
export type Scheme = keyof typeof palettes;

// The live palette. Screens read `colors.x` while rendering; App swaps the values with
// applyScheme and remounts the tree, so every screen picks up the new palette at once.
export const colors: Palette = { ...light };
export let scheme: Scheme = "light";
let version = 0;

export const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40, hero: 48 };
export const radii = { small: 8, field: 12, button: 14, card: 18, panel: 24, pill: 999 };

const t = (fontSize: number, fontWeight: TextStyle["fontWeight"], lineHeight: number): TextStyle => ({ fontSize, fontWeight, lineHeight, color: colors.textPrimary });
const buildType = () => ({
  brandName: t(28, "700", 34),
  screenTitle: t(28, "700", 36),
  heroTitle: t(24, "600", 32),
  sectionTitle: t(18, "600", 26),
  cardTitle: t(17, "600", 24),
  body: t(16, "400", 24),
  buttonLabel: t(16, "600", 24),
  fieldLabel: t(14, "600", 20),
  meta: { ...t(14, "400", 20), color: colors.textSecondary } as TextStyle,
  badgeLabel: t(12, "600", 18),
  listenLabel: t(20, "600", 28),
  timer: { ...t(16, "600", 24), fontVariant: ["tabular-nums"] } as TextStyle,
});
export const type = buildType();

const buildShadow = () => ({
  raised: scheme === "dark"
    ? Platform.select<ViewStyle>({
      ios: { shadowColor: "#000000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 12 },
      android: { elevation: 3, shadowColor: "#000000" },
      default: { boxShadow: "0 4px 12px rgba(0,0,0,0.28)" } as ViewStyle,
    })
    : Platform.select<ViewStyle>({
      ios: { shadowColor: "#20352B", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 8 },
      android: { elevation: 2 },
      default: { boxShadow: "0 3px 8px rgba(32,53,43,0.10)" } as ViewStyle,
    }),
});
export const shadow = buildShadow();

export function applyScheme(next: Scheme) {
  if (next === scheme) return;
  scheme = next;
  Object.assign(colors, palettes[next]);
  Object.assign(type, buildType());
  Object.assign(shadow, buildShadow());
  version++;
  if (Platform.OS === "web" && typeof document !== "undefined") {
    document.documentElement.style.colorScheme = next;
    document.body.style.backgroundColor = colors.background;
  }
}

// Style sheets that use colors are rebuilt on first use after the scheme changes.
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(build: () => T): T {
  let built: T | undefined; let at = -1;
  const current = () => { if (at !== version) { built = StyleSheet.create(build()); at = version; } return built!; };
  return new Proxy({} as T, { get: (_, key) => current()[key as keyof T] });
}

// The same for any other object computed from the palette (button variants, badge tones).
export function themed<T extends object>(build: () => T): T {
  let built: T | undefined; let at = -1;
  const current = () => { if (at !== version) { built = build(); at = version; } return built!; };
  return new Proxy({} as T, { get: (_, key) => current()[key as keyof T] });
}

// Content column: full width on phones, centered and capped on wide screens.
export const column: ViewStyle = { width: "100%", maxWidth: 600, alignSelf: "center" };
