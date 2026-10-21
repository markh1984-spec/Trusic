import type { TrackSummary } from "@trusic/client";
import { AI_LABELS } from "@trusic/core";
import { StyleSheet, Switch, Text, View } from "react-native";
import { errorMessage } from "../lib/api";
import { useAuth } from "../state/auth";
import { useHumanOnly } from "../state/human-only";
import { useToast } from "../state/toast";
import { colors, radius, space } from "../theme";
import { Icon } from "./Icon";
import { Note } from "./ui";

/** "Human-made only", from the label's name in @trusic/core. */
export const HUMAN_ONLY = `${AI_LABELS.human.name} only`;

const EXPLAINER =
  `Leaves tracks labelled ${AI_LABELS.ai_assisted.name} and ${AI_LABELS.ai_generated.name} out of browsing, ` +
  "search, recommendations and radio. Albums, playlists and artists you open yourself still play in full, with " +
  "every track labelled.";

/** The "Human-made only" switch. `detailed` adds what it does and where it's kept, for the Account tab. */
export function HumanOnlySwitch({ detailed = false }: { detailed?: boolean }) {
  const { humanOnly, setHumanOnly } = useHumanOnly();
  const { me } = useAuth();
  const toast = useToast();

  const change = (on: boolean) =>
    void setHumanOnly(on)
      .then(() => toast(on ? HUMAN_ONLY : "Showing everything, labelled"))
      .catch((e: unknown) => toast(errorMessage(e, "Couldn't change the setting. Try again.")));

  return (
    <View style={[styles.row, detailed && styles.rowDetailed, humanOnly && styles.rowOn]}>
      <Icon name={humanOnly ? "check" : "info"} size={20} color={humanOnly ? colors.human : colors.muted} />
      <View style={styles.text}>
        <Text style={styles.label}>{HUMAN_ONLY}</Text>
        <Text style={styles.status}>
          {humanOnly
            ? `Leaving out ${AI_LABELS.ai_assisted.name} and ${AI_LABELS.ai_generated.name}`
            : "Showing everything, labelled"}
        </Text>
        {detailed ? (
          <>
            <Text style={styles.detail}>{EXPLAINER}</Text>
            <Text style={styles.detail}>
              {me
                ? "Kept on your account, so it's the same on the website and your other devices."
                : "Kept on this phone. Log in to keep it on your account."}
            </Text>
          </>
        ) : null}
      </View>
      <Switch
        value={humanOnly}
        onValueChange={change}
        accessibilityLabel={HUMAN_ONLY}
        accessibilityHint={EXPLAINER}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor={colors.text}
      />
    </View>
  );
}

/**
 * On an album, playlist or artist the listener opened themselves, everything still plays, with every track
 * labelled. When the switch is on, say so, so nothing is a surprise (as the website does).
 */
export function OpenedYourselfNote({ tracks, what }: { tracks: TrackSummary[]; what: string }) {
  const { humanOnly } = useHumanOnly();
  const others = tracks.filter((t) => t.aiLabel !== "human").length;
  if (!humanOnly || others === 0) return null;
  return (
    <Note>
      {HUMAN_ONLY} is on, but {what} plays in full because you opened it yourself.{" "}
      {others === 1 ? "1 track here is" : `${others} tracks here are`} labelled {AI_LABELS.ai_assisted.name} or{" "}
      {AI_LABELS.ai_generated.name}.
    </Note>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  rowDetailed: { alignItems: "flex-start", paddingVertical: space.md },
  rowOn: { borderColor: "rgba(63,217,154,0.45)" },
  text: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: colors.text, fontSize: 15, fontWeight: "700" },
  status: { color: colors.muted, fontSize: 13 },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: space.xs },
});
