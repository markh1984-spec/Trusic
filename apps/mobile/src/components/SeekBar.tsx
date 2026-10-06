import { useState } from "react";
import { StyleSheet, View, type GestureResponderEvent } from "react-native";
import { colors } from "../theme";

/**
 * A scrubber: tap or drag to seek. For previews, the part past `limitMs`
 * is greyed out and can't be reached.
 */
export function SeekBar({
  positionMs,
  durationMs,
  limitMs,
  onSeek,
  disabled = false,
}: {
  positionMs: number;
  durationMs: number;
  limitMs?: number | null;
  onSeek(ms: number): void;
  disabled?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const max = Math.max(1, durationMs);
  const reachable = Math.min(max, limitMs ?? max);

  const toMs = (e: GestureResponderEvent) =>
    width > 0 ? Math.min(reachable, Math.max(0, (e.nativeEvent.locationX / width) * max)) : 0;

  const shown = dragMs ?? positionMs;
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / max) * 100))}%` as const;
  const step = 10_000;

  return (
    <View
      style={styles.hit}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !disabled}
      onMoveShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => setDragMs(toMs(e))}
      onResponderMove={(e) => setDragMs(toMs(e))}
      onResponderRelease={(e) => {
        onSeek(toMs(e));
        setDragMs(null);
      }}
      onResponderTerminate={() => setDragMs(null)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Seek"
      accessibilityValue={{ min: 0, max: Math.round(max / 1000), now: Math.round(shown / 1000) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) =>
        onSeek(Math.min(reachable, Math.max(0, positionMs + (e.nativeEvent.actionName === "increment" ? step : -step))))
      }
    >
      <View style={styles.track} pointerEvents="none">
        {limitMs != null && limitMs < max ? <View style={[styles.locked, { left: pct(limitMs) }]} /> : null}
        <View style={[styles.fill, { width: pct(shown) }]} />
      </View>
      <View style={[styles.thumb, { left: pct(shown) }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 28, justifyContent: "center" },
  track: { height: 4, borderRadius: 2, backgroundColor: "#3a404c", overflow: "hidden" },
  locked: { position: "absolute", top: 0, bottom: 0, right: 0, backgroundColor: "#1f232b" },
  fill: { height: "100%", backgroundColor: colors.text },
  thumb: {
    position: "absolute",
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: colors.text,
  },
});
