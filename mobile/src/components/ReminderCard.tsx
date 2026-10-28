import { Pressable, Text, View } from "react-native";
import { isOverdue, missingInfo, triggerText, whenText } from "../services/format";
import { colors, radii, spacing, type, themedStyles } from "../theme";
import { Reminder } from "../types/reminder";

type Props = { reminder: Reminder; onPress: () => void; onToggle?: () => void; badge?: React.ReactNode };

export function reminderMeta(reminder: Reminder, now = new Date()) {
  if (reminder.completed) return "Completed";
  if (reminder.snoozedUntil && Date.parse(reminder.snoozedUntil) > now.getTime()) return `Snoozed until ${whenText(reminder.snoozedUntil, now)}`;
  const text = triggerText(reminder, now);
  return isOverdue(reminder, now) ? `Overdue · ${text}` : text;
}

export function ReminderCard({ reminder, onPress, onToggle, badge }: Props) {
  const meta = reminderMeta(reminder);
  const overdue = isOverdue(reminder);
  const missing = missingInfo(reminder);
  return (
    <View style={styles.card}>
      {onToggle ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: reminder.completed }} accessibilityLabel={reminder.completed ? `Mark ${reminder.title} as not done` : `Mark ${reminder.title} as done`}
        onPress={onToggle} hitSlop={4} style={styles.target}>
        <View style={[styles.circle, reminder.completed && styles.circleDone]}>{reminder.completed ? <Text style={styles.check}>✓</Text> : null}</View>
      </Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Open reminder: ${reminder.title}`} accessibilityHint={meta} onPress={onPress}
        style={({ pressed }) => [styles.content, pressed && { backgroundColor: colors.surfaceSubtle }]}>
        {badge ? <View style={{ marginBottom: spacing.xxs }}>{badge}</View> : null}
        <Text style={type.cardTitle}>{reminder.title}</Text>
        <Text style={[type.meta, { marginTop: spacing.xxs }, overdue && { color: colors.danger }]}>{meta}</Text>
        {missing ? <Text style={[type.meta, { color: colors.accent, fontWeight: "600" }]}>{missing.label}</Text> : null}
      </Pressable>
      <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">›</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  card: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, minHeight: 88, marginBottom: spacing.sm, overflow: "hidden" },
  target: { width: 56, alignSelf: "stretch", alignItems: "center", justifyContent: "center", paddingLeft: spacing.xs },
  circle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.controlBorder, alignItems: "center", justifyContent: "center" },
  circleDone: { backgroundColor: colors.brandGreen, borderColor: colors.brandGreen },
  check: { color: colors.onSolid, fontWeight: "700", fontSize: 14, lineHeight: 16 },
  content: { flex: 1, alignSelf: "stretch", justifyContent: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  chevron: { fontSize: 24, color: colors.textSecondary, paddingRight: spacing.md },
}));
