import type { PlaylistDetail } from "@trusic/client";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Platform, StyleSheet, Text, View } from "react-native";
import { PlaylistCover } from "../components/Artwork";
import { LikedCover } from "../components/Tiles";
import { TrackList } from "../components/TrackList";
import { Button, ErrorScreen, Loading, Muted, PlayButton, Screen, SignInPrompt } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { duration, plural } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { usePlayTracks } from "../lib/navigation";
import { useAuth } from "../state/auth";
import { useLibrary } from "../state/library";
import { usePlayer } from "../state/player";
import { useToast } from "../state/toast";
import { colors, space } from "../theme";

/** Ask before doing something that can't be undone. */
function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: action, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

export function PlaylistScreen({ id }: { id: string }) {
  const { data, error, loading, reload } = useAsync(() => api.playlist(id), [id]);
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const play = usePlayTracks();
  const player = usePlayer();
  const library = useLibrary();
  const toast = useToast();
  const router = useRouter();

  useEffect(() => setPlaylist(data), [data]);

  if (error) return <ErrorScreen message={error} />;
  if (loading || !playlist) return <Loading />;

  const tracks = playlist.entries.map((e) => e.track);
  const playingThis = player.playing && player.contextLabel === playlist.name;

  /** Apply a change, then refresh the library's playlist list too. */
  const apply = async (change: Promise<PlaylistDetail>) => {
    try {
      setPlaylist(await change);
      void library.refreshPlaylists();
    } catch (e) {
      toast(errorMessage(e, "Couldn't update the playlist."));
    }
  };

  const move = (from: number, to: number) => {
    const ids = playlist.entries.map((e) => e.entryId);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    void apply(api.reorderPlaylist(playlist.id, ids));
  };

  const remove = async () => {
    if (!(await confirm(`Delete "${playlist.name}"?`, "This can't be undone.", "Delete"))) return;
    try {
      await api.deletePlaylist(playlist.id);
      await library.refreshPlaylists();
      toast("Playlist deleted");
      router.back();
    } catch (e) {
      toast(errorMessage(e, "Couldn't delete the playlist."));
    }
  };

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: playlist.name }} />
      <View style={styles.hero}>
        <PlaylistCover urls={playlist.artworkUrls} title={playlist.name} size={220} />
        <Text style={styles.title}>{playlist.name}</Text>
        {playlist.description ? <Muted style={{ textAlign: "center" }}>{playlist.description}</Muted> : null}
        <Muted small>
          {playlist.isPublic ? "Public" : "Private"} playlist · {playlist.owner.displayName} ·{" "}
          {plural(playlist.trackCount, "track")}, {duration(playlist.durationMs)}
        </Muted>
      </View>
      <View style={styles.actions}>
        {playlist.isOwner ? <Button title="Delete" variant="ghost" onPress={() => void remove()} /> : null}
        <View style={{ flex: 1 }} />
        {tracks.length ? (
          <PlayButton
            playing={playingThis}
            label={`Play ${playlist.name}`}
            onPress={() => (playingThis ? player.toggle() : play(tracks, 0, playlist.name))}
          />
        ) : null}
      </View>
      <TrackList
        tracks={tracks}
        keys={playlist.entries.map((e) => e.entryId)}
        label={playlist.name}
        empty={
          playlist.isOwner
            ? "This playlist is empty. Use the ⋯ button on any track to add it here."
            : "This playlist is empty."
        }
        extraActions={
          playlist.isOwner
            ? (_track, i) => [
                ...(i > 0 ? [{ label: "Move up", onSelect: () => move(i, i - 1) }] : []),
                ...(i < tracks.length - 1 ? [{ label: "Move down", onSelect: () => move(i, i + 1) }] : []),
                {
                  label: "Remove from this playlist",
                  onSelect: () => void apply(api.removeFromPlaylist(playlist.id, playlist.entries[i]!.entryId)),
                },
              ]
            : undefined
        }
      />
    </Screen>
  );
}

export function LikedScreen() {
  const { me, loading: authLoading } = useAuth();
  if (authLoading) return <Loading />;
  if (!me) {
    return (
      <Screen>
        <SignInPrompt message="Your liked songs live in your account." />
      </Screen>
    );
  }
  return <Liked />;
}

function Liked() {
  const library = useLibrary();
  const { data, error, loading, reload } = useAsync(() => api.likes(), []);
  const play = usePlayTracks();
  const player = usePlayer();

  if (error) return <ErrorScreen message={error} />;
  if (loading || !data) return <Loading />;
  // Hide tracks unliked on this screen without loading again.
  const tracks = data.map((l) => l.track).filter((t) => library.isLiked(t.id));
  const playingThis = player.playing && player.contextLabel === "Liked songs";

  return (
    <Screen onRefresh={reload}>
      <View style={styles.hero}>
        <LikedCover size={220} />
        <Text style={styles.title}>Liked songs</Text>
        <Muted small>{plural(tracks.length, "track")}</Muted>
      </View>
      <View style={styles.actions}>
        <View style={{ flex: 1 }} />
        {tracks.length ? (
          <PlayButton
            playing={playingThis}
            label="Play liked songs"
            onPress={() => (playingThis ? player.toggle() : play(tracks, 0, "Liked songs"))}
          />
        ) : null}
      </View>
      <TrackList tracks={tracks} label="Liked songs" empty="Tap the heart on any track to save it here." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: 4, marginBottom: space.lg },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", textAlign: "center", marginTop: space.md },
  actions: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.md },
});
