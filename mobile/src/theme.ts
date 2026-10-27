import { Platform, TextStyle, ViewStyle } from "react-native";

// Heedly design tokens (visual spec written with Codex, 2026-10-27). Light theme only.
export const colors = {
  background: "#FAF8F2",
  surface: "#FFFFFF",
  surfaceSubtle: "#F0F3EC",
  textPrimary: "#20352B",
  textSecondary: "#56665B",
  brandGreen: "#0B582F",
  brandPressed: "#084525",
  cream: "#FDF3DE",
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

export const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40, hero: 48 };
export const radii = { small: 8, field: 12, button: 14, card: 18, panel: 24, pill: 999 };

const t = (fontSize: number, fontWeight: TextStyle["fontWeight"], lineHeight: number): TextStyle => ({ fontSize, fontWeight, lineHeight, color: colors.textPrimary });
export const type = {
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
};

export const shadow = {
  raised: Platform.select<ViewStyle>({
    ios: { shadowColor: "#20352B", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 8 },
    android: { elevation: 2 },
    default: { boxShadow: "0 3px 8px rgba(32,53,43,0.10)" } as ViewStyle,
  }),
};

// Content column: full width on phones, centered and capped on wide screens.
export const column: ViewStyle = { width: "100%", maxWidth: 600, alignSelf: "center" };
