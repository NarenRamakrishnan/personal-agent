import { describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Platform: { OS: "ios", select: (options: any) => options.ios ?? options.default }, StyleSheet: { create: (styles: any) => styles } }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: vi.fn(async () => "dark"), setItem: vi.fn(async () => {}) } }));
import { applyScheme, colors, palettes, themed, themedStyles, type } from "../src/theme";
import { loadAppearance, resolveScheme } from "../src/services/appearance";

// WCAG relative-luminance contrast, to keep both palettes readable.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

describe("appearance", () => {
  it("follows the device unless a look is pinned", () => {
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", null)).toBe("light");
    expect(resolveScheme("light", "dark")).toBe("light");
    expect(resolveScheme("dark", "light")).toBe("dark");
  });

  it("remembers the saved choice", async () => { expect(await loadAppearance()).toBe("dark"); });

  it("swaps the live palette, text styles and themed style sheets together", () => {
    const styles = themedStyles(() => ({ page: { backgroundColor: colors.background } }));
    const tones = themed(() => ({ primary: colors.brandGreen }));
    expect(styles.page.backgroundColor).toBe(palettes.light.background);
    applyScheme("dark");
    expect(colors.background).toBe(palettes.dark.background);
    expect(type.body.color).toBe(palettes.dark.textPrimary);
    expect(styles.page.backgroundColor).toBe(palettes.dark.background);
    expect(tones.primary).toBe(palettes.dark.brandGreen);
    applyScheme("light");
    expect(styles.page.backgroundColor).toBe(palettes.light.background);
  });

  it.each(["light", "dark"] as const)("keeps text readable in %s mode (WCAG AA)", scheme => {
    const p = palettes[scheme];
    const pairs: [string, string][] = [
      [p.textPrimary, p.background], [p.textPrimary, p.surface], [p.textSecondary, p.background], [p.textSecondary, p.surface],
      [p.brandGreen, p.background], [p.brandGreen, p.surface], [p.brandGreen, p.successSurface], [p.accent, p.accentSurface],
      [p.danger, p.dangerSurface], [p.danger, p.background], [p.success, p.successSurface], [p.micActive, p.micSurface],
      [p.onSolid, p.brandGreen], [p.onSolid, p.brandPressed], [p.onSolid, p.danger], [p.onSolid, p.micActive], [p.textSecondary, p.disabledSurface],
    ];
    for (const [fg, bg] of pairs) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
