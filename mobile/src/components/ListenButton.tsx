import { useEffect, useRef } from "react";
import { AccessibilityInfo, ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, shadow, type } from "../theme";

// A microphone drawn with plain views so no icon library is needed.
export function MicGlyph({ color = colors.cream, size = 32 }: { color?: string; size?: number }) {
  const s = size / 32;
  return <View style={{ width: size, height: size, alignItems: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={{ width: 12 * s, height: 19 * s, borderRadius: 6 * s, backgroundColor: color }} />
    <View style={{ position: "absolute", top: 10 * s, width: 20 * s, height: 13 * s, borderBottomLeftRadius: 10 * s, borderBottomRightRadius: 10 * s, borderWidth: 2.5 * s, borderTopWidth: 0, borderColor: color }} />
    <View style={{ position: "absolute", top: 23 * s, width: 2.5 * s, height: 5 * s, backgroundColor: color }} />
    <View style={{ position: "absolute", top: 27.5 * s, width: 12 * s, height: 2.5 * s, borderRadius: 2 * s, backgroundColor: color }} />
  </View>;
}

export function ListenButton({ onPress, active = false, starting = false, label = "Listen", accessibilityLabel = "Start listening", size = 160 }: {
  onPress: () => void; active?: boolean; starting?: boolean; label?: string; accessibilityLabel?: string; size?: number;
}) {
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) { ring.stopAnimation(); ring.setValue(0); return; }
    let loop: Animated.CompositeAnimation | undefined; let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then(reduce => {
      if (cancelled) return;
      if (reduce) { ring.setValue(0.5); return; }
      loop = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1400, useNativeDriver: true }));
      loop.start();
    });
    return () => { cancelled = true; loop?.stop(); ring.setValue(0); };
  }, [active, ring]);
  const circle = size * 0.8;
  return <View style={{ alignItems: "center", gap: 12 }}>
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {active ? <Animated.View pointerEvents="none" style={[styles.ring, { width: circle, height: circle, borderRadius: circle / 2,
        opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.24, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }) }] }]} /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ busy: starting }} onPress={onPress} disabled={starting}
        style={({ pressed }) => [styles.circle, shadow.raised, { width: circle, height: circle, borderRadius: circle / 2, backgroundColor: active ? colors.micActive : pressed ? colors.brandPressed : colors.brandGreen, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
        {starting ? <ActivityIndicator color={colors.cream} size="large" /> : active ? <View style={styles.stop} /> : <MicGlyph />}
      </Pressable>
    </View>
    <Text style={type.listenLabel}>{starting ? "Starting…" : label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", backgroundColor: colors.micActive },
  stop: { width: 28, height: 28, borderRadius: 6, backgroundColor: colors.cream },
});
