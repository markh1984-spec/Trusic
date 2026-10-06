import type { TrackDetail } from "@trusic/client";
import { AI_LABELS, aiLabel } from "@trusic/core";
import { Stack } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AiBadge } from "../components/AiBadge";
import { Artwork } from "../components/Artwork";
import { LikeButton } from "../components/LikeButton";
import { useTrackActions } from "../components/TrackActions";
import { ScoreBreakdown, ScoreDial } from "../components/Transparency";
import {
  Body,
  Card,
  ErrorScreen,
  Heading,
  IconButton,
  Loading,
  Muted,
  Note,
  PlayButton,
  Screen,
} from "../components/ui";
import { api } from "../lib/api";
import { duration } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { routes, useGo, usePlayTracks } from "../lib/navigation";
import { usePlayer } from "../state/player";
import { colors, space } from "../theme";

const TOOL_NAMES: Record<string, string> = {
  mastering: "Mastering",
  mixing: "Mixing",
  stem_separation: "Stem separation",
  audio_restoration: "Audio restoration",
  pitch_correction: "Pitch correction",
  transcription: "Transcription",
};

const SOURCE_TEXT = {
  declared: "Score from the artist's own declaration.",
  detected: "Our detection found more AI than the artist declared, so the higher score applies.",
  review: "Score set by Trusic's review team.",
} as const;

export function TrackScreen({ id }: { id: string }) {
  const { data: track, error, loading, reload } = useAsync(() => api.track(id), [id]);
  const play = usePlayTracks();
  const player = usePlayer();
  const go = useGo();
  const openActions = useTrackActions();

  if (error) return <ErrorScreen message={error} />;
  if (loading || !track) return <Loading />;

  const isCurrent = player.current?.id === track.id;
  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: track.title }} />
      <View style={styles.hero}>
        <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size={220} />
        <Text style={styles.title}>{track.title}</Text>
        <Pressable onPress={() => go(routes.artist(track.artist.slug))} accessibilityRole="link">
          <Text style={styles.artist}>{track.artist.name}</Text>
        </Pressable>
        <Text style={styles.meta}>
          {[track.release?.title, track.genre, duration(track.durationMs)].filter(Boolean).join(" · ")}
        </Text>
      </View>

      <View style={styles.actions}>
        <AiBadge score={track.aiScore} large />
        <View style={styles.spacer} />
        <LikeButton trackId={track.id} />
        <IconButton icon="more" label="More options" onPress={() => openActions(track)} color={colors.muted} />
        <PlayButton
          playing={isCurrent && player.playing}
          label={`Play ${track.title}`}
          onPress={() => (isCurrent ? player.toggle() : play([track], 0))}
        />
      </View>

      <TransparencyCard track={track} />
      <HowPaidCard track={track} />
    </Screen>
  );
}

function TransparencyCard({ track }: { track: TrackDetail }) {
  const label = aiLabel(track.aiScore);
  const d = track.declaration;
  return (
    <Card style={styles.card}>
      <Heading>AI transparency</Heading>
      <View style={styles.summary}>
        <ScoreDial score={track.aiScore} label={label} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.labelName}>{AI_LABELS[label].name}</Text>
          <Muted>{AI_LABELS[label].description}</Muted>
          <Body>
            Earns <Text style={styles.strong}>{track.payoutRatePercent}%</Text> of the human rate per stream.
          </Body>
        </View>
      </View>
      <Muted small>{SOURCE_TEXT[track.scoreSource]}</Muted>

      <Text style={styles.subheading}>What the artist declared</Text>
      <ScoreBreakdown breakdown={track.breakdown} />
      {d.assistiveTools.length ? (
        <Body style={styles.small}>
          <Text style={styles.strong}>AI engineering tools (never affect the score): </Text>
          {d.assistiveTools.map((t) => TOOL_NAMES[t] ?? t).join(", ")}
        </Body>
      ) : null}
      {d.toolsUsed.length ? (
        <Body style={styles.small}>
          <Text style={styles.strong}>Tools named: </Text>
          {d.toolsUsed.join(", ")}
        </Body>
      ) : null}
      {d.notes ? <Note>{d.notes}</Note> : null}
      {track.detection && track.detection.verdict !== "inconclusive" ? (
        <Note tone={track.detection.verdict === "likely_ai" ? "warn" : "info"}>
          <Text style={styles.strong}>Detection ({track.detection.detector}): </Text>
          {track.detection.verdict === "likely_ai" ? "likely AI-generated" : "likely human"},{" "}
          {Math.round(track.detection.confidence * 100)}% confidence.
          {track.detection.evidence.map((e) => `\n• ${e}`).join("")}
        </Note>
      ) : null}
    </Card>
  );
}

function HowPaidCard({ track }: { track: TrackDetail }) {
  return (
    <Card style={styles.card}>
      <Heading>How this track gets paid</Heading>
      <Body>
        When a subscriber plays this track, part of that listener's 80% artist share comes here. Each stream is weighted
        by <Text style={styles.strong}>{track.payoutRatePercent}%</Text>, so the score cuts this track's per-stream rate
        and the difference goes to the human-made tracks the same listener played.
      </Body>
      <Muted small style={{ marginTop: space.sm }}>
        Example: a listener plays this and a human-made track 10 times each. The human track earns 100 units per stream
        and this one earns {track.payoutRatePercent}.
      </Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: 4, marginBottom: space.lg },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", textAlign: "center", marginTop: space.md },
  artist: { color: colors.text, fontSize: 16, fontWeight: "600" },
  meta: { color: colors.muted, fontSize: 14, textAlign: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.lg },
  spacer: { flex: 1 },
  card: { marginBottom: space.lg, gap: space.md },
  summary: { flexDirection: "row", gap: space.lg, alignItems: "center" },
  labelName: { color: colors.text, fontSize: 20, fontWeight: "800" },
  strong: { fontWeight: "800", color: colors.text },
  subheading: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: space.sm },
  small: { fontSize: 14 },
});
