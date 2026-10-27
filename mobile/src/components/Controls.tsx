import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, column, radii, spacing, type } from "../theme";

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Try again.";

// Scrolling content with an optional fixed footer that never covers it.
export function Page({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      <View style={[column, styles.stack]}>{children}</View>
    </ScrollView>
    {footer ? <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}><View style={[column, styles.footerStack]}>{footer}</View></View> : null}
  </KeyboardAvoidingView>;
}

export function ScreenTitle({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return <View style={{ gap: spacing.xs }}>
    <Text accessibilityRole="header" style={type.screenTitle}>{children}</Text>
    {subtitle ? <Text style={[type.body, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
  </View>;
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerGhost";
const variantStyle: Record<ButtonVariant, { bg: string; pressed: string; text: string; border?: string }> = {
  primary: { bg: colors.brandGreen, pressed: colors.brandPressed, text: colors.cream },
  secondary: { bg: colors.surface, pressed: colors.surfaceSubtle, text: colors.brandGreen, border: colors.controlBorder },
  ghost: { bg: "transparent", pressed: colors.surfaceSubtle, text: colors.brandGreen },
  danger: { bg: colors.danger, pressed: colors.dangerPressed, text: "#FFFFFF" },
  dangerGhost: { bg: "transparent", pressed: colors.dangerSurface, text: colors.danger },
};

export function Button({ title, onPress, disabled = false, variant = "primary", busy = false, accessibilityLabel, compact = false, style }: {
  title: string; onPress: () => void; disabled?: boolean; variant?: ButtonVariant; busy?: boolean; accessibilityLabel?: string; compact?: boolean; style?: ViewStyle;
}) {
  const v = variantStyle[variant];
  const off = disabled || busy;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress}
    style={({ pressed }) => [styles.button, compact && styles.compact, { backgroundColor: off && variant !== "ghost" && variant !== "dangerGhost" ? colors.disabledSurface : pressed ? v.pressed : v.bg },
      v.border ? { borderWidth: 1, borderColor: v.border } : null, style]}>
    <View style={styles.buttonRow}>
      {busy ? <ActivityIndicator size="small" color={v.text} /> : null}
      <Text style={[type.buttonLabel, { color: off ? colors.textSecondary : v.text, textAlign: "center" }]}>{title}</Text>
    </View>
  </Pressable>;
}

export function AsyncButton({ title, busyTitle, action, variant = "primary", accessibilityLabel, compact }: {
  title: string; busyTitle?: string; action: () => Promise<unknown>; variant?: ButtonVariant; accessibilityLabel?: string; compact?: boolean;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const run = async () => { if (busy) return; setBusy(true); setError(""); try { await action(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  return <View style={{ gap: spacing.xs }}>
    <Button title={busy ? busyTitle ?? "Please wait…" : title} accessibilityLabel={accessibilityLabel ?? title} onPress={run} busy={busy} variant={variant} compact={compact} />
    {error ? <Text accessibilityRole="alert" style={[type.meta, { color: colors.danger }]}>{error}</Text> : null}
  </View>;
}

export function Field({ label, value, onChangeText, multiline = false, placeholder, helper, error, keyboardType, autoFocus }: {
  label: string; value: string; onChangeText: (text: string) => void; multiline?: boolean; placeholder?: string; helper?: string; error?: string;
  keyboardType?: "default" | "email-address" | "numeric"; autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return <View style={{ gap: spacing.xs }}>
    <Text style={type.fieldLabel}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} multiline={multiline} placeholder={placeholder} placeholderTextColor={colors.textSecondary}
      keyboardType={keyboardType} autoFocus={autoFocus} autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={[styles.input, multiline && { minHeight: 104, textAlignVertical: "top" }, (focused || error) && { borderWidth: 2, padding: 13, borderColor: error ? colors.danger : colors.brandGreen }]} />
    {error ? <Text accessibilityRole="alert" style={[type.meta, { color: colors.danger }]}>{error}</Text> : helper ? <Text style={type.meta}>{helper}</Text> : null}
  </View>;
}

// A choice chip (radio) by default; `action` makes it a one-tap button like "Snooze 1 hour".
export function Chip({ label, selected = false, onPress, accessibilityLabel, action = false }: { label: string; selected?: boolean; onPress: () => void; accessibilityLabel?: string; action?: boolean }) {
  return <Pressable accessibilityRole={action ? "button" : "radio"} accessibilityState={action ? undefined : { checked: selected }} accessibilityLabel={accessibilityLabel ?? label} onPress={onPress}
    style={({ pressed }) => [styles.chip, selected ? { backgroundColor: colors.brandGreen, borderColor: colors.brandGreen } : pressed ? { backgroundColor: colors.surfaceSubtle } : null]}>
    <Text style={[type.buttonLabel, { fontSize: 15, color: selected ? colors.cream : colors.textPrimary }]}>{selected ? "✓ " : ""}{label}</Text>
  </Pressable>;
}

export function Chips({ children }: { children: React.ReactNode }) {
  return <View accessibilityRole="radiogroup" style={styles.chips}>{children}</View>;
}

export type BadgeTone = "new" | "updated" | "completed" | "email" | "error" | "neutral";
const badgeTone: Record<BadgeTone, { bg: string; text: string }> = {
  new: { bg: colors.successSurface, text: colors.brandGreen },
  updated: { bg: colors.accentSurface, text: colors.accent },
  completed: { bg: colors.successSurface, text: colors.success },
  email: { bg: colors.accentSurface, text: colors.accent },
  error: { bg: colors.dangerSurface, text: colors.danger },
  neutral: { bg: colors.surfaceSubtle, text: colors.textSecondary },
};
export function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  return <View style={[styles.badge, { backgroundColor: badgeTone[tone].bg }]}><Text style={[type.badgeLabel, { color: badgeTone[tone].text }]}>{label}</Text></View>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({ title, count }: { title: string; count?: number }) {
  return <View style={styles.sectionHeader}>
    <Text accessibilityRole="header" style={type.sectionTitle}>{title}</Text>
    {count !== undefined ? <Text style={type.meta}>{count}</Text> : null}
  </View>;
}

// A tinted message panel: neutral for expected states, danger for failures.
export function Notice({ tone = "neutral", title, children }: { tone?: "neutral" | "danger" | "attention" | "success"; title?: string; children?: React.ReactNode }) {
  const palette = { neutral: [colors.surfaceSubtle, colors.textPrimary], danger: [colors.dangerSurface, colors.danger], attention: [colors.accentSurface, colors.accent], success: [colors.successSurface, colors.success] }[tone];
  return <View accessibilityRole={tone === "danger" ? "alert" : undefined} style={[styles.notice, { backgroundColor: palette[0] }]}>
    {title ? <Text style={[type.cardTitle, { color: palette[1] }]}>{title}</Text> : null}
    {typeof children === "string" ? <Text style={[type.body, { color: tone === "neutral" ? colors.textSecondary : palette[1] }]}>{children}</Text> : children}
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  page: { padding: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  stack: { gap: spacing.md },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  footerStack: { gap: spacing.xs },
  button: { minHeight: 52, borderRadius: radii.button, paddingHorizontal: spacing.lg, paddingVertical: 14, justifyContent: "center" },
  compact: { minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: 10 },
  buttonRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.controlBorder, borderRadius: radii.field, padding: 14, minHeight: 52, fontSize: 16, lineHeight: 24, color: colors.textPrimary },
  chip: { minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.controlBorder, backgroundColor: colors.surface, justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  badge: { minHeight: 26, paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs, borderRadius: radii.small, alignSelf: "flex-start", justifyContent: "center" },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, padding: spacing.md, gap: spacing.xs },
  sectionHeader: { minHeight: 32, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xxs },
  notice: { borderRadius: radii.panel, padding: spacing.md, gap: spacing.xs },
});
