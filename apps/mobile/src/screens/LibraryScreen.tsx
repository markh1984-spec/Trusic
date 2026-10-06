import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Icon } from "../components/Icon";
import { ArtistTile, CollectionRow, LikedCover, PlaylistRow } from "../components/Tiles";
import { TrackList } from "../components/TrackList";
import { Chip, Chips, ErrorNote, Loading, Muted, Screen, SignInPrompt } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { routes, useGo } from "../lib/navigation";
import { useAuth } from "../state/auth";
import { useLibrary } from "../state/library";
import { useToast } from "../state/toast";
import { colors, radius, space } from "../theme";

const TABS = [
  { id: "playlists", label: "Playlists" },
  { id: "artists", label: "Artists" },
  { id: "history", label: "Recently played" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function LibraryScreen() {
  const { me, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("playlists");
  const [version, setVersion] = useState(0);
  const library = useLibrary();

  if (loading) return <Loading />;
  if (!me) {
    return (
      <Screen>
        <SignInPrompt message="Your playlists, liked songs, followed artists and listening history live here." />
      </Screen>
    );
  }

  return (
    <Screen
      onRefresh={() => {
        setVersion((v) => v + 1);
        void library.refreshPlaylists().catch(() => undefined);
      }}
    >
      <Chips>
        {TABS.map((t) => (
          <Chip key={t.id} label={t.label} active={tab === t.id} onPress={() => setTab(t.id)} />
        ))}
      </Chips>
      <View style={{ marginTop: space.md }}>
        {tab === "playlists" ? (
          <Playlists />
        ) : tab === "artists" ? (
          <Artists key={version} />
        ) : (
          <History key={version} />
        )}
      </View>
    </Screen>
  );
}

function Playlists() {
  const library = useLibrary();
  const toast = useToast();
  const go = useGo();
  const [name, setName] = useState("");

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const id = await library.createPlaylist(trimmed);
      setName("");
      go(routes.playlist(id));
    } catch (e) {
      toast(errorMessage(e, "Couldn't create the playlist."));
    }
  };

  return (
    <View>
      <CollectionRow
        title="Liked songs"
        subtitle="Your favourites"
        cover={<LikedCover size={56} />}
        href={routes.liked}
      />
      {library.playlists.map((p) => (
        <PlaylistRow key={p.id} playlist={p} />
      ))}
      <View style={styles.newRow}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="New playlist name"
          placeholderTextColor={colors.muted}
          maxLength={100}
          style={styles.input}
          returnKeyType="done"
          onSubmitEditing={() => void create()}
          accessibilityLabel="New playlist name"
        />
        <Pressable
          onPress={() => void create()}
          disabled={!name.trim()}
          style={[styles.create, !name.trim() && { opacity: 0.4 }]}
          accessibilityRole="button"
          accessibilityLabel="Create playlist"
        >
          <Icon name="plus" size={20} color={colors.primaryInk} />
        </Pressable>
      </View>
    </View>
  );
}

function Artists() {
  const { data, error, loading } = useAsync(() => api.follows(), []);
  if (error) return <ErrorNote message={error} />;
  if (loading || !data) return <Loading />;
  if (data.length === 0) return <Muted>Follow artists from their pages and they'll show up here.</Muted>;
  return (
    <View style={styles.grid}>
      {data.map((a) => (
        <ArtistTile key={a.id} artist={a} />
      ))}
    </View>
  );
}

function History() {
  const { data, error, loading } = useAsync(() => api.history(), []);
  if (error) return <ErrorNote message={error} />;
  if (loading || !data) return <Loading />;
  return (
    <TrackList
      tracks={data.map((h) => h.track)}
      keys={data.map((h, i) => `${h.track.id}-${h.playedAt}-${i}`)}
      label="Recently played"
      empty="Nothing yet. Tracks you play will show up here."
    />
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.lg, justifyContent: "space-between" },
  newRow: { flexDirection: "row", gap: space.sm, marginTop: space.lg },
  input: {
    flex: 1,
    backgroundColor: colors.raised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: 15,
  },
  create: {
    width: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
