import type { OfflineCollection, TrackSummary } from "@trusic/client";
import { Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Artwork } from "../components/Artwork";
import { LikedCover } from "../components/Tiles";
import { TrackList } from "../components/TrackList";
import { Muted, Note, PlayButton, Screen } from "../components/ui";
import { plural } from "../lib/format";
import { usePlayTracks } from "../lib/navigation";
import { usePlayer } from "../state/player";
import { colors, space } from "../theme";

/**
 * A downloaded release, playlist or liked songs, shown from what's on the phone when the server can't
 * be reached. Only the downloaded tracks are listed.
 */
export function OfflineCollectionScreen({
  collection,
  tracks,
}: {
  collection: OfflineCollection;
  tracks: TrackSummary[];
}) {
  const play = usePlayTracks();
  const player = usePlayer();
  const playingThis = player.playing && player.contextLabel === collection.title;

  return (
    <Screen>
      <Stack.Screen options={{ title: collection.title }} />
      <View style={styles.hero}>
        {collection.type === "liked" ? (
          <LikedCover size={220} />
        ) : (
          <Artwork url={collection.artworkUrl} title={collection.title} size={220} />
        )}
        <Text style={styles.title}>{collection.title}</Text>
        {collection.subtitle ? <Text style={styles.subtitle}>{collection.subtitle}</Text> : null}
        <Muted small>Downloaded · {plural(tracks.length, "track")}</Muted>
      </View>
      <Note>You're offline, so this shows what's downloaded on your phone.</Note>
      <View style={styles.actions}>
        <View style={{ flex: 1 }} />
        {tracks.length ? (
          <PlayButton
            playing={playingThis}
            label={`Play ${collection.title}`}
            onPress={() => (playingThis ? player.toggle() : play(tracks, 0, collection.title))}
          />
        ) : null}
      </View>
      <TrackList tracks={tracks} label={collection.title} empty="Nothing from here is downloaded yet." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: 4, marginBottom: space.md },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", textAlign: "center", marginTop: space.md },
  subtitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  actions: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.md },
});
