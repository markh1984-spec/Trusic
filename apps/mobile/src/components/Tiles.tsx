import type { Artist, PlaylistSummary, ReleaseSummary } from "@trusic/client";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { RELEASE_TYPE_NAMES, releaseYear } from "../lib/format";
import { releaseAiSummary, releaseLabel } from "../lib/labels";
import { routes, useGo } from "../lib/navigation";
import { colors, space } from "../theme";
import { LabelChip } from "./AiBadge";
import { Artwork, PlaylistCover } from "./Artwork";
import { Icon } from "./Icon";

const TILE = 148;

/** A sideways-scrolling row of tiles. */
export function Shelf({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.shelf}
      style={styles.shelfOuter}
    >
      {children}
    </ScrollView>
  );
}

export function ReleaseTile({ release, showArtist = false }: { release: ReleaseSummary; showArtist?: boolean }) {
  const go = useGo();
  const label = releaseLabel(release);
  const sub = [releaseYear(release), RELEASE_TYPE_NAMES[release.type], showArtist ? release.artist.name : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      onPress={() => go(routes.release(release.id))}
      accessibilityRole="button"
      accessibilityLabel={`${release.title}, ${sub}. ${releaseAiSummary(release)}`}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
    >
      <View>
        <Artwork url={release.artworkUrl} title={release.title} label={label?.label ?? undefined} size={TILE} />
        {label ? (
          <View style={styles.tileLabel}>
            <LabelChip label={label.label} text={label.text} />
          </View>
        ) : null}
      </View>
      <Text style={styles.tileTitle} numberOfLines={1}>
        {release.title}
      </Text>
      <Text style={styles.tileSub} numberOfLines={1}>
        {sub}
      </Text>
    </Pressable>
  );
}

export function ArtistTile({ artist }: { artist: Artist }) {
  const go = useGo();
  return (
    <Pressable
      onPress={() => go(routes.artist(artist.slug))}
      accessibilityRole="button"
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
    >
      <Artwork url={artist.imageUrl} title={artist.name} size={TILE} round />
      <Text style={[styles.tileTitle, { textAlign: "center" }]} numberOfLines={1}>
        {artist.name}
      </Text>
      <Text style={[styles.tileSub, { textAlign: "center" }]}>Artist</Text>
    </Pressable>
  );
}

/** A full-width row linking to a playlist (or Liked songs). */
export function CollectionRow({
  title,
  subtitle,
  cover,
  href,
}: {
  title: string;
  subtitle: string;
  cover: ReactNode;
  href: string;
}) {
  const go = useGo();
  return (
    <Pressable
      onPress={() => go(href)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.collection, pressed && { backgroundColor: colors.cardPressed }]}
    >
      {cover}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.collectionTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.tileSub} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Icon name="chevronRight" size={18} color={colors.muted} />
    </Pressable>
  );
}

export function PlaylistRow({ playlist }: { playlist: PlaylistSummary }) {
  return (
    <CollectionRow
      title={playlist.name}
      subtitle={`Playlist · ${playlist.trackCount} tracks · ${playlist.owner.displayName}`}
      cover={<PlaylistCover urls={playlist.artworkUrls} title={playlist.name} size={56} />}
      href={routes.playlist(playlist.id)}
    />
  );
}

/** The green heart cover for Liked songs. */
export function LikedCover({ size = 56 }: { size?: number }) {
  return (
    <View style={[styles.liked, { width: size, height: size, borderRadius: size * 0.1 }]} aria-hidden>
      <Icon name="heartFilled" size={size * 0.5} color={colors.primaryInk} />
    </View>
  );
}

const styles = StyleSheet.create({
  shelfOuter: { marginHorizontal: -space.lg },
  shelf: { gap: space.md, paddingHorizontal: space.lg },
  tile: { width: TILE, gap: 2 },
  tileLabel: { position: "absolute", left: 6, bottom: 6, right: 6 },
  tileTitle: { color: colors.text, fontSize: 14, fontWeight: "700", marginTop: 6 },
  tileSub: { color: colors.muted, fontSize: 13 },
  collection: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, borderRadius: 8 },
  collectionTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  liked: { backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});
