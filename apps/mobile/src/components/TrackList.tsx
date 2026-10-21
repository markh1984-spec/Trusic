import type { PlaySource, TrackSummary } from "@trusic/client";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { duration } from "../lib/format";
import { routes, useGo, usePlayTracks } from "../lib/navigation";
import { playableQueue } from "../lib/offline";
import { useOffline } from "../state/offline";
import { usePlayer } from "../state/player";
import { colors, space } from "../theme";
import { AiBadge } from "./AiBadge";
import { Artwork } from "./Artwork";
import { Icon } from "./Icon";
import { useTrackActions, type ExtraAction } from "./TrackActions";
import { Muted } from "./ui";

export interface TrackListProps {
  tracks: TrackSummary[];
  /** Shown in Now Playing as "Playing from …". */
  label?: string;
  /** Where these tracks are (an album, search…), recorded with each play for artists' stats. */
  source?: PlaySource;
  showArtist?: boolean;
  /** Track numbers instead of artwork, for albums. */
  numbered?: boolean;
  empty?: string;
  /** Extra items for each track's ⋯ sheet, e.g. "Remove from this playlist". */
  extraActions?: (track: TrackSummary, index: number) => ExtraAction[];
  /** Stable keys when the same track appears twice (playlists). */
  keys?: string[];
}

/** Tap a track to play the list from there; tap its AI label for the details. */
export function TrackList({
  tracks,
  label,
  source = "other",
  showArtist = true,
  numbered = false,
  empty,
  extraActions,
  keys,
}: TrackListProps) {
  const play = usePlayTracks();
  const player = usePlayer();
  const openActions = useTrackActions();
  const go = useGo();
  const offline = useOffline();
  // Offline, only downloaded tracks can play: the rest are greyed out and left out of the queue.
  const canPlay = (track: TrackSummary) => !offline.isOffline || offline.isPlayable(track.id);
  const playFrom = (i: number) => {
    const queue = offline.isOffline ? playableQueue(tracks, i, canPlay) : { tracks, startIndex: i };
    if (queue) play(queue.tracks, queue.startIndex, label, source);
  };

  if (tracks.length === 0) return <Muted style={{ paddingVertical: space.md }}>{empty ?? "No tracks yet."}</Muted>;

  return (
    <View>
      {tracks.map((track, i) => {
        const isCurrent = player.current?.id === track.id;
        const available = canPlay(track);
        return (
          <Pressable
            key={keys?.[i] ?? track.id}
            onPress={() => (isCurrent ? player.toggle() : playFrom(i))}
            onLongPress={() => openActions(track, extraActions?.(track, i))}
            disabled={!available && !isCurrent}
            accessibilityRole="button"
            accessibilityState={{ disabled: !available }}
            accessibilityLabel={
              available
                ? `${isCurrent && player.playing ? "Pause" : "Play"} ${track.title} by ${track.artist.name}`
                : `${track.title} by ${track.artist.name}, not downloaded`
            }
            style={({ pressed }) => [styles.row, pressed && styles.pressed, !available && styles.unavailable]}
          >
            {numbered ? (
              <View style={styles.number}>
                {isCurrent && player.playing ? (
                  <Icon name="pause" size={16} color={colors.primary} />
                ) : (
                  <Text style={[styles.numberText, isCurrent && { color: colors.primary }]}>
                    {track.trackNumber ?? i + 1}
                  </Text>
                )}
              </View>
            ) : (
              <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size={48} />
            )}
            <View style={styles.text}>
              <Text style={[styles.title, isCurrent && { color: colors.primary }]} numberOfLines={1}>
                {track.title}
              </Text>
              <View style={styles.meta}>
                <AiBadge score={track.aiScore} onPress={() => go(routes.track(track.id))} />
                <Text style={styles.sub} numberOfLines={1}>
                  {showArtist ? track.artist.name : duration(track.durationMs)}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => openActions(track, extraActions?.(track, i))}
              accessibilityRole="button"
              accessibilityLabel={`More options for ${track.title}`}
              hitSlop={10}
              style={styles.more}
            >
              <Icon name="more" size={20} color={colors.muted} />
            </Pressable>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm,
    borderRadius: 8,
  },
  pressed: { backgroundColor: colors.cardPressed },
  unavailable: { opacity: 0.35 },
  number: { width: 28, alignItems: "center" },
  numberText: { color: colors.muted, fontSize: 15, fontVariant: ["tabular-nums"] },
  text: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: colors.text, fontSize: 16, fontWeight: "600" },
  meta: { flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 },
  sub: { color: colors.muted, fontSize: 13, flexShrink: 1 },
  more: { padding: 6 },
});
