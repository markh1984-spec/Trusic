import type { TrackSummary } from "@trusic/client";
import { useRouter } from "expo-router";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorMessage } from "../lib/api";
import { routes, useGo } from "../lib/navigation";
import { useAuth } from "../state/auth";
import { useLibrary } from "../state/library";
import { usePlayer } from "../state/player";
import { useToast } from "../state/toast";
import { colors, radius, space } from "../theme";
import { AiBadge } from "./AiBadge";
import { Artwork } from "./Artwork";
import { Icon } from "./Icon";

export interface ExtraAction {
  label: string;
  onSelect(): void;
}

type Open = (track: TrackSummary, extra?: ExtraAction[]) => void;

const TrackActionsContext = createContext<Open>(() => undefined);

/** The "⋯" sheet for a track: queue it, add it to a playlist, like it, go to its artist. */
export function TrackActionsProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<{ track: TrackSummary; extra: ExtraAction[] } | null>(null);
  const open = useCallback<Open>((track, extra = []) => setTarget({ track, extra }), []);
  return (
    <TrackActionsContext.Provider value={open}>
      {children}
      <Modal
        visible={target !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setTarget(null)}
        statusBarTranslucent
      >
        {target ? <Sheet track={target.track} extra={target.extra} onClose={() => setTarget(null)} /> : null}
      </Modal>
    </TrackActionsContext.Provider>
  );
}

export const useTrackActions = () => useContext(TrackActionsContext);

function Sheet({ track, extra, onClose }: { track: TrackSummary; extra: ExtraAction[]; onClose(): void }) {
  const { me } = useAuth();
  const player = usePlayer();
  const library = useLibrary();
  const toast = useToast();
  const router = useRouter();
  const go = useGo();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<"main" | "playlists">("main");
  const [newName, setNewName] = useState("");

  /** Run an action that needs an account, sending signed-out visitors to log in. */
  const signedIn = (action: () => void) => () => {
    onClose();
    if (!me) {
      toast("Log in first");
      router.navigate(routes.account);
      return;
    }
    action();
  };

  const navigate = (href: string) => () => {
    onClose();
    go(href);
  };

  const addTo = async (playlistId: string, name: string) => {
    onClose();
    try {
      await library.addToPlaylist(playlistId, [track.id]);
      toast(`Added to ${name}`);
    } catch (e) {
      toast(errorMessage(e, "Couldn't add it."));
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const id = await library.createPlaylist(name);
      await addTo(id, name);
    } catch (e) {
      toast(errorMessage(e, "Couldn't create the playlist."));
    }
  };

  const liked = library.isLiked(track.id);

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.header}>
          <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size={48} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.title} numberOfLines={1}>
              {track.title}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {track.artist.name}
            </Text>
            <AiBadge score={track.aiScore} />
          </View>
        </View>

        {view === "main" ? (
          <ScrollView style={{ maxHeight: 420 }}>
            <Item label="Play next" onPress={signedIn(() => (player.playNext(track), toast("Playing next")))} />
            <Item label="Add to queue" onPress={signedIn(() => (player.addToQueue(track), toast("Added to queue")))} />
            <Item
              label="Add to playlist…"
              onPress={() => {
                if (!me) return signedIn(() => undefined)();
                setView("playlists");
              }}
            />
            <Item
              label={liked ? "Remove from Liked songs" : "Add to Liked songs"}
              onPress={signedIn(() => void library.toggleLike(track.id).catch(() => toast("Couldn't update.")))}
            />
            <View style={styles.rule} />
            <Item label="AI transparency" onPress={navigate(routes.track(track.id))} />
            <Item label="Go to artist" onPress={navigate(routes.artist(track.artist.slug))} />
            {track.release ? (
              <Item label={`Go to ${track.release.title}`} onPress={navigate(routes.release(track.release.id))} />
            ) : null}
            {extra.length ? <View style={styles.rule} /> : null}
            {extra.map((item) => (
              <Item
                key={item.label}
                label={item.label}
                onPress={() => {
                  onClose();
                  item.onSelect();
                }}
              />
            ))}
          </ScrollView>
        ) : (
          <View>
            <Pressable style={styles.back} onPress={() => setView("main")} accessibilityRole="button">
              <Icon name="back" size={18} color={colors.muted} />
              <Text style={styles.backText}>Add to playlist</Text>
            </Pressable>
            <View style={styles.newRow}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="New playlist name"
                placeholderTextColor={colors.muted}
                maxLength={100}
                style={styles.input}
                returnKeyType="done"
                onSubmitEditing={() => void createAndAdd()}
                accessibilityLabel="New playlist name"
              />
              <Pressable
                onPress={() => void createAndAdd()}
                disabled={!newName.trim()}
                style={[styles.create, !newName.trim() && { opacity: 0.4 }]}
                accessibilityRole="button"
                accessibilityLabel="Create playlist"
              >
                <Icon name="plus" size={20} color={colors.primaryInk} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 300 }}>
              {library.playlists.map((p) => (
                <Item key={p.id} label={p.name} onPress={() => void addTo(p.id, p.name)} />
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
}

function Item({ label, onPress }: { label: string; onPress(): void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.cardPressed }]}
    >
      <Text style={styles.itemText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: space.lg,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    gap: space.md,
    alignItems: "center",
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: space.xs,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: 14 },
  item: { paddingHorizontal: space.lg, paddingVertical: 14 },
  itemText: { color: colors.text, fontSize: 16 },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: space.xs },
  back: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.lg, paddingVertical: space.md },
  backText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  newRow: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, marginBottom: space.sm },
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
