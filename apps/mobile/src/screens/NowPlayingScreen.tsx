import type { TrackSummary } from "@trusic/client";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AiBadge } from "../components/AiBadge";
import { Artwork } from "../components/Artwork";
import { Icon } from "../components/Icon";
import { LikeButton } from "../components/LikeButton";
import { SeekBar } from "../components/SeekBar";
import { useTrackActions } from "../components/TrackActions";
import { IconButton, PlayButton } from "../components/ui";
import { duration } from "../lib/format";
import { routes, useGo } from "../lib/navigation";
import { usePlayer, useProgress } from "../state/player";
import { colors, space } from "../theme";

const REPEAT_LABELS = { off: "Repeat", all: "Repeat one", one: "Don't repeat" } as const;

/** The full-screen player. */
export function NowPlayingScreen() {
  const player = usePlayer();
  const router = useRouter();
  const go = useGo();
  const openActions = useTrackActions();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const track = player.current;

  // Nothing playing (e.g. after logging out): go back.
  useEffect(() => {
    if (!track && router.canGoBack()) router.back();
  }, [track, router]);

  if (!track) return <View style={styles.screen} />;

  const art = Math.min(width - space.xl * 2, height * 0.42, 420);
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="down" label="Close player" onPress={close} size={28} />
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>PLAYING FROM</Text>
          <Text style={styles.context} numberOfLines={1}>
            {player.contextLabel ?? track.release?.title ?? "Trusic"}
          </Text>
        </View>
        <IconButton icon="more" label="More options" onPress={() => openActions(track)} />
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xl }]}>
        <View style={styles.artWrap}>
          <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size={art} />
        </View>

        <View style={styles.titleRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={2}>
              {track.title}
            </Text>
            <Pressable onPress={() => go(routes.artist(track.artist.slug))} accessibilityRole="link">
              <Text style={styles.artist} numberOfLines={1}>
                {track.artist.name}
              </Text>
            </Pressable>
          </View>
          <LikeButton trackId={track.id} size={28} />
        </View>

        <View style={styles.badgeRow}>
          <AiBadge score={track.aiScore} large onPress={() => go(routes.track(track.id))} />
          <Text style={styles.rate}>Earns {track.payoutRatePercent}% of the human rate</Text>
        </View>

        {player.previewMs !== null ? (
          <View style={styles.preview} role="status">
            <Text style={styles.previewText}>Preview. Subscribe to hear the full track</Text>
            <Pressable onPress={() => go(routes.account)} accessibilityRole="link">
              <Text style={styles.previewLink}>How to subscribe</Text>
            </Pressable>
          </View>
        ) : null}

        <Progress />

        <View style={styles.controls}>
          <IconButton
            icon="shuffle"
            label={player.shuffle ? "Shuffle on" : "Shuffle off"}
            onPress={player.toggleShuffle}
            active={player.shuffle}
            color={colors.muted}
          />
          <IconButton icon="previous" label="Previous" onPress={player.previous} size={34} />
          <PlayButton playing={player.playing} label="Play" onPress={player.toggle} size={68} />
          <IconButton icon="next" label="Next" onPress={player.next} size={34} />
          <View>
            <IconButton
              icon="repeat"
              label={REPEAT_LABELS[player.repeat]}
              onPress={player.cycleRepeat}
              active={player.repeat !== "off"}
              color={colors.muted}
            />
            {player.repeat === "one" ? <Text style={styles.repeatOne}>1</Text> : null}
          </View>
        </View>

        {player.error ? <Text style={styles.error}>{player.error}</Text> : null}

        <Queue />
      </ScrollView>
    </View>
  );
}

function Progress() {
  const player = usePlayer();
  const { positionMs, durationMs } = useProgress();
  return (
    <View style={styles.progress}>
      <SeekBar positionMs={positionMs} durationMs={durationMs} limitMs={player.previewMs} onSeek={player.seek} />
      <View style={styles.times}>
        <Text style={styles.time}>{duration(positionMs)}</Text>
        <Text style={styles.time}>{duration(durationMs)}</Text>
      </View>
    </View>
  );
}

/** What plays next: tracks queued by hand, then the rest of the album or playlist. */
function Queue() {
  const player = usePlayer();
  if (!player.upNext.length && !player.upcoming.length) return null;
  return (
    <View style={styles.queue}>
      {player.upNext.length ? (
        <>
          <Text style={styles.queueHeading}>Next in queue</Text>
          {player.upNext.map((t, i) => (
            <QueueRow
              key={`${t.id}-${i}`}
              track={t}
              onPress={() => player.jumpToQueued(i)}
              onRemove={() => player.removeFromQueue(i)}
            />
          ))}
        </>
      ) : null}
      {player.upcoming.length ? (
        <>
          <Text style={styles.queueHeading}>
            Next from {player.contextLabel ?? "this list"}
            {player.shuffle ? " (shuffled)" : ""}
          </Text>
          {player.upcoming.slice(0, 30).map(({ track, orderIndex }) => (
            <QueueRow key={orderIndex} track={track} onPress={() => player.jumpToUpcoming(orderIndex)} />
          ))}
        </>
      ) : null}
    </View>
  );
}

function QueueRow({ track, onPress, onRemove }: { track: TrackSummary; onPress(): void; onRemove?(): void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Play ${track.title} now`}
      style={({ pressed }) => [styles.queueRow, pressed && { opacity: 0.7 }]}
    >
      <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size={40} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={styles.queueTitle} numberOfLines={1}>
          {track.title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <AiBadge score={track.aiScore} />
          <Text style={styles.queueArtist} numberOfLines={1}>
            {track.artist.name}
          </Text>
        </View>
      </View>
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${track.title} from the queue`}
        >
          <Icon name="close" size={18} color={colors.muted} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#15171c" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, paddingVertical: space.sm },
  headerText: { flex: 1, alignItems: "center" },
  eyebrow: { color: colors.muted, fontSize: 10, letterSpacing: 1.2, fontWeight: "700" },
  context: { color: colors.text, fontSize: 14, fontWeight: "700" },
  body: { paddingHorizontal: space.xl },
  artWrap: { alignItems: "center", marginTop: space.md, marginBottom: space.xl },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  artist: { color: colors.muted, fontSize: 17, marginTop: 2 },
  badgeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
  rate: { color: colors.muted, fontSize: 13 },
  preview: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: 10,
    backgroundColor: "rgba(244,191,79,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,191,79,0.45)",
    gap: 4,
  },
  previewText: { color: colors.assisted, fontWeight: "700", fontSize: 14 },
  previewLink: { color: colors.text, fontSize: 14, textDecorationLine: "underline" },
  progress: { marginTop: space.lg },
  times: { flexDirection: "row", justifyContent: "space-between" },
  time: { color: colors.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.md,
  },
  repeatOne: {
    position: "absolute",
    right: 0,
    top: 0,
    color: colors.primary,
    fontSize: 10,
    fontWeight: "800",
  },
  error: { color: colors.danger, textAlign: "center", marginTop: space.md },
  queue: { marginTop: space.xxl, gap: space.sm },
  queueHeading: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: space.md },
  queueRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 4 },
  queueTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  queueArtist: { color: colors.muted, fontSize: 13, flexShrink: 1 },
});
