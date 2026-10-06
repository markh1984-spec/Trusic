import { Stack } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LabelChip } from "../components/AiBadge";
import { Artwork } from "../components/Artwork";
import { TrackList } from "../components/TrackList";
import { ErrorScreen, Loading, PlayButton, Screen } from "../components/ui";
import { api } from "../lib/api";
import { duration, plural, RELEASE_TYPE_NAMES, releaseYear } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { releaseAiSummary, releaseLabel } from "../lib/labels";
import { routes, useGo, usePlayTracks } from "../lib/navigation";
import { usePlayer } from "../state/player";
import { colors, space } from "../theme";

export function ReleaseScreen({ id }: { id: string }) {
  const { data: release, error, loading, reload } = useAsync(() => api.release(id), [id]);
  const play = usePlayTracks();
  const player = usePlayer();
  const go = useGo();

  if (error) return <ErrorScreen message={error} />;
  if (loading || !release) return <Loading />;

  const label = releaseLabel(release);
  const playingThis = player.playing && player.contextLabel === release.title;
  const year = releaseYear(release);

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: release.title }} />
      <View style={styles.hero}>
        <Artwork url={release.artworkUrl} title={release.title} label={label?.label ?? undefined} size={220} />
        <Text style={styles.title}>{release.title}</Text>
        <Pressable onPress={() => go(routes.artist(release.artist.slug))} accessibilityRole="link">
          <Text style={styles.artist}>{release.artist.name}</Text>
        </Pressable>
        <Text style={styles.meta}>
          {[RELEASE_TYPE_NAMES[release.type], year, plural(release.trackCount, "track"), duration(release.durationMs)]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      <View style={styles.actions}>
        <View style={{ flex: 1, gap: 6 }}>
          {label ? <LabelChip label={label.label} text={label.text} /> : null}
          <Text style={styles.summary}>{releaseAiSummary(release)}</Text>
        </View>
        {release.tracks.length ? (
          <PlayButton
            playing={playingThis}
            label={`Play ${release.title}`}
            onPress={() => (playingThis ? player.toggle() : play(release.tracks, 0, release.title))}
          />
        ) : null}
      </View>
      <TrackList tracks={release.tracks} label={release.title} numbered showArtist={false} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: 4, marginBottom: space.lg },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", textAlign: "center", marginTop: space.md },
  artist: { color: colors.text, fontSize: 16, fontWeight: "600" },
  meta: { color: colors.muted, fontSize: 14, textAlign: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.md },
  summary: { color: colors.muted, fontSize: 13 },
});
