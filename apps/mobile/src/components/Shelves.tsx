import type { HomeShelf, PlaySource, RecommendedArtist, RecommendedTrack } from "@trusic/client";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { plural } from "../lib/format";
import { labelName } from "../lib/labels";
import { routes, useGo, usePlayTracks } from "../lib/navigation";
import { usePlayer } from "../state/player";
import { colors, space } from "../theme";
import { AiBadge } from "./AiBadge";
import { Artwork } from "./Artwork";
import { Icon } from "./Icon";
import { ReleaseTile, Shelf } from "./Tiles";
import { useTrackActions } from "./TrackActions";
import { Heading } from "./ui";

const TILE = 148;

/** "Why am I seeing this?": every recommendation explains itself. Tap to read why. */
export function Why({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.why}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        style={styles.whyButton}
      >
        <Icon name="info" size={15} color={colors.muted} />
        <Text style={styles.whyLabel}>Why am I seeing this?</Text>
      </Pressable>
      {open ? <Text style={styles.whyText}>{text}</Text> : null}
    </View>
  );
}

/** A titled row of tiles that scrolls sideways, with its explanation. */
function ShelfFrame({ title, why, children }: { title: string; why: string; children: ReactNode }) {
  return (
    <View style={styles.shelf}>
      <Heading style={styles.heading}>{title}</Heading>
      <Why text={why} />
      <Shelf>{children}</Shelf>
    </View>
  );
}

function TrackTile({ item, onPlay }: { item: RecommendedTrack; onPlay(): void }) {
  const { track, reason } = item;
  const player = usePlayer();
  const go = useGo();
  const openActions = useTrackActions();
  const isCurrent = player.current?.id === track.id;
  const pause = isCurrent && player.playing;
  return (
    <View style={styles.tile}>
      <Pressable
        onPress={() => (isCurrent ? player.toggle() : onPlay())}
        onLongPress={() => openActions(track)}
        accessibilityRole="button"
        accessibilityLabel={`${pause ? "Pause" : "Play"} ${track.title} by ${track.artist.name}`}
        style={({ pressed }) => pressed && { opacity: 0.8 }}
      >
        <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size={TILE} />
        <View style={[styles.play, isCurrent && styles.playCurrent]}>
          <Icon name={pause ? "pause" : "play"} size={18} color={colors.primaryInk} />
        </View>
      </Pressable>
      <View style={styles.titleRow}>
        <Pressable onPress={() => go(routes.track(track.id))} accessibilityRole="link" style={styles.titleLink}>
          <Text style={[styles.title, isCurrent && { color: colors.primary }]} numberOfLines={1}>
            {track.title}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => openActions(track)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${track.title}`}
        >
          <Icon name="more" size={18} color={colors.muted} />
        </Pressable>
      </View>
      <Text style={styles.sub} numberOfLines={1}>
        {track.artist.name}
      </Text>
      <View style={styles.badge}>
        <AiBadge score={track.aiScore} onPress={() => go(routes.track(track.id))} />
      </View>
      <Text style={styles.reason} numberOfLines={3}>
        {reason}
      </Text>
    </View>
  );
}

/** Recommended tracks. Playing one plays the shelf from there; artists see these plays as recommendations. */
export function TrackShelf({
  title,
  why,
  items,
  source = "recommendations",
}: {
  title: string;
  why: string;
  items: RecommendedTrack[];
  source?: PlaySource;
}) {
  const play = usePlayTracks();
  const tracks = items.map((i) => i.track);
  return (
    <ShelfFrame title={title} why={why}>
      {items.map((item, i) => (
        <TrackTile key={item.track.id} item={item} onPlay={() => play(tracks, i, title, source)} />
      ))}
    </ShelfFrame>
  );
}

function ArtistTile({ item }: { item: RecommendedArtist }) {
  const { artist, reason, tracks, humanMadeTracks } = item;
  const go = useGo();
  const counts = `${humanMadeTracks} of ${tracks} ${labelName("human")}`;
  return (
    <Pressable
      onPress={() => go(routes.artist(artist.slug))}
      accessibilityRole="button"
      accessibilityLabel={`${artist.name}, artist. ${humanMadeTracks} of ${plural(tracks, "track")} ${labelName("human")}. ${reason}`}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
    >
      <Artwork url={artist.imageUrl} title={artist.name} size={TILE} round />
      <Text style={[styles.title, styles.center, { marginTop: 6 }]} numberOfLines={1}>
        {artist.name}
      </Text>
      <Text style={[styles.sub, styles.center]} numberOfLines={1}>
        {counts}
      </Text>
      <Text style={[styles.reason, styles.center]} numberOfLines={3}>
        {reason}
      </Text>
    </Pressable>
  );
}

export function ArtistShelf({ title, why, items }: { title: string; why: string; items: RecommendedArtist[] }) {
  return (
    <ShelfFrame title={title} why={why}>
      {items.map((item) => (
        <ArtistTile key={item.artist.id} item={item} />
      ))}
    </ShelfFrame>
  );
}

/** Any shelf from the home feed. */
export function HomeShelfView({ shelf }: { shelf: HomeShelf }) {
  if (shelf.kind === "tracks") return <TrackShelf title={shelf.title} why={shelf.why} items={shelf.tracks} />;
  if (shelf.kind === "artists") return <ArtistShelf title={shelf.title} why={shelf.why} items={shelf.artists} />;
  return (
    <ShelfFrame title={shelf.title} why={shelf.why}>
      {shelf.releases.map((r) => (
        <ReleaseTile key={r.id} release={r} showArtist />
      ))}
    </ShelfFrame>
  );
}

const styles = StyleSheet.create({
  shelf: { marginTop: space.xl },
  heading: { marginBottom: 2 },
  why: { marginBottom: space.md },
  whyButton: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingVertical: 2 },
  whyLabel: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  whyText: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: space.xs },
  tile: { width: TILE, gap: 2 },
  play: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  playCurrent: { backgroundColor: colors.text },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  titleLink: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 14, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: 13 },
  badge: { marginTop: 3 },
  reason: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 4 },
  center: { textAlign: "center" },
});
