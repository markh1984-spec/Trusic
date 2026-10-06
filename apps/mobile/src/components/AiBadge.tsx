import { AI_LABELS, aiLabel, type AiLabel } from "@trusic/core";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { badgeText } from "../lib/labels";
import { labelColors, radius } from "../theme";

/** The label every track carries, everywhere it appears: "Human-made · AI 0". */
export function AiBadge({ score, onPress, large = false }: { score: number; onPress?(): void; large?: boolean }) {
  const label = aiLabel(score);
  const color = labelColors[label];
  const text = badgeText(score);
  const body = (
    <View style={[styles.badge, large && styles.large, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, large && styles.largeText, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
  const a11y = `${text}. ${AI_LABELS[label].description}`;
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={a11y}>
        {body}
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${a11y} Show AI details.`} hitSlop={6}>
      {body}
    </Pressable>
  );
}

/** A label without a score, for whole releases. `label` null means a mix. */
export function LabelChip({ label, text }: { label: AiLabel | null; text: string }) {
  const color = label ? labelColors[label] : labelColors.ai_assisted;
  return (
    <View style={[styles.badge, styles.chip, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  chip: { backgroundColor: "rgba(12,13,16,0.85)" },
  large: { paddingHorizontal: 10, paddingVertical: 3, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11, fontWeight: "700" },
  largeText: { fontSize: 13 },
});
