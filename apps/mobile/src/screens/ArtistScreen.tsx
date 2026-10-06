import { aiLabel } from "@trusic/core";
import { Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Artwork } from "../components/Artwork";
import { ReleaseTile, Shelf } from "../components/Tiles";
import { TrackList } from "../components/TrackList";
import { Button, ErrorScreen, Heading, Loading, Muted, PlayButton, Screen } from "../components/ui";
import { api } from "../lib/api";
import { plural } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { labelName } from "../lib/labels";
import { usePlayTracks } from "../lib/navigation";
import { useAuth } from "../state/auth";
import { useLibrary } from "../state/library";
import { usePlayer } from "../state/player";
import { useToast } from "../state/toast";
import { colors, space } from "../theme";

export function ArtistScreen({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useAsync(() => api.artist(slug), [slug]);
  const { me } = useAuth();
  const library = useLibrary();
  const play = usePlayTracks();
  const player = usePlayer();
  const toast = useToast();

  if (error) return <ErrorScreen message={error} />;
  if (loading || !data) return <Loading />;

  const { artist, tracks, releases } = data;
  const human = tracks.filter((t) => aiLabel(t.aiScore) === "human").length;
  const following = library.isFollowing(artist.id);
  // Keep the count in step when the listener follows or unfollows here.
  const followers = data.followers - (data.isFollowing ? 1 : 0) + (following ? 1 : 0);
  const playingThis = player.playing && player.contextLabel === artist.name;

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: artist.name }} />
      <View style={styles.hero}>
        <Artwork url={artist.imageUrl} title={artist.name} size={180} round />
        <Text style={styles.name}>{artist.name}</Text>
        <Muted small>
          {plural(followers, "follower")} · {plural(tracks.length, "track")} · {human} {labelName("human")}
        </Muted>
      </View>

      <View style={styles.actions}>
        {me && !data.isOwner ? (
          <Button
            title={following ? "Following" : "Follow"}
            variant={following ? "ghost" : "primary"}
            onPress={() =>
              void library
                .toggleFollow(artist.id)
                .then(() => toast(following ? `Unfollowed ${artist.name}` : `Following ${artist.name}`))
                .catch(() => toast("Couldn't update. Try again."))
            }
          />
        ) : null}
        <View style={{ flex: 1 }} />
        {tracks.length ? (
          <PlayButton
            playing={playingThis}
            label={`Play ${artist.name}`}
            onPress={() => (playingThis ? player.toggle() : play(tracks, 0, artist.name))}
          />
        ) : null}
      </View>

      {artist.bio ? <Text style={styles.bio}>{artist.bio}</Text> : null}

      {releases.length ? (
        <View style={styles.section}>
          <Heading>Discography</Heading>
          <Shelf>
            {releases.map((r) => (
              <ReleaseTile key={r.id} release={r} />
            ))}
          </Shelf>
        </View>
      ) : null}

      <View style={styles.section}>
        <Heading>Tracks</Heading>
        <TrackList tracks={tracks} showArtist={false} label={artist.name} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: 6, marginBottom: space.lg },
  name: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: space.md, textAlign: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.md },
  bio: { color: colors.muted, fontSize: 15, lineHeight: 22, marginBottom: space.md },
  section: { marginTop: space.lg },
});
