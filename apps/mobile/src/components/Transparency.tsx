import { AI_LABELS, DEFAULT_RUBRIC, type AiLabel, type ScoreBreakdown as Breakdown } from "@trusic/core";
import { StyleSheet, Text, View } from "react-native";
import { colors, labelColors, space } from "../theme";

/** The score in a coloured ring, like the web app's dial. */
export function ScoreDial({ score, label }: { score: number; label: AiLabel }) {
  return (
    <View
      style={[styles.dial, { borderColor: labelColors[label] }]}
      accessible
      accessibilityLabel={`AI score ${score} out of 100, ${AI_LABELS[label].name}`}
    >
      <Text style={[styles.dialValue, { color: labelColors[label] }]}>{score}</Text>
      <Text style={styles.dialCaption}>AI SCORE</Text>
    </View>
  );
}

const LEVEL_COLORS = {
  none: colors.human,
  assisted: colors.assisted,
  generated: colors.generated,
  not_applicable: colors.muted,
} as const;

/** One bar per creative stage, filled by how much it adds to the score. */
export function ScoreBreakdown({ breakdown }: { breakdown: Breakdown }) {
  return (
    <View style={{ gap: space.md }}>
      {breakdown.stages.map((s) => {
        const na = s.declared === "not_applicable";
        const level = s.declared === "not_applicable" ? "Doesn't apply" : DEFAULT_RUBRIC.levels[s.declared].label;
        const fill = s.effectiveWeight ? (s.points / s.effectiveWeight) * 100 : 0;
        return (
          <View key={s.stage} style={styles.row}>
            <View style={{ flex: 1, gap: 5 }}>
              <View style={styles.rowHead}>
                <Text style={styles.stage} numberOfLines={1}>
                  {s.label}
                </Text>
                <Text style={[styles.level, { color: LEVEL_COLORS[s.declared] }]}>{level}</Text>
              </View>
              <View style={styles.bar}>
                <View style={[styles.weight, { width: `${s.effectiveWeight}%` }]}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${fill}%` },
                      s.declared === "assisted" && { backgroundColor: colors.assisted },
                    ]}
                  />
                </View>
              </View>
            </View>
            <Text style={styles.points}>{na ? "–" : `+${Math.round(s.points)}`}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dial: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  dialValue: { fontSize: 30, fontWeight: "800", lineHeight: 34 },
  dialCaption: { fontSize: 9, letterSpacing: 1, color: colors.muted, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  rowHead: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  stage: { color: colors.text, fontSize: 14, flexShrink: 1 },
  level: { fontSize: 13, fontWeight: "600" },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.raised, overflow: "hidden" },
  weight: { height: "100%", backgroundColor: "#2b313c" },
  fill: { height: "100%", backgroundColor: colors.generated },
  points: { width: 36, textAlign: "right", color: colors.text, fontWeight: "800", fontVariant: ["tabular-nums"] },
});
