import type { TrackSummary } from "@trusic/client";
import { useRouter } from "expo-router";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorMessage } from "../lib/api";
import { routes, useGo } from "../lib/navigation";
import { useShare } from "../lib/share-sheet";
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

/** The "⋯" sheet for a release, artist or playlist page: what it is, and its choices. */
export interface MenuSheet {
  title: string;
  subtitle?: string;
  artwork?: { url: string | null; round?: boolean };
  items: ExtraAction[];
}

type Open = (track: TrackSummary, extra?: ExtraAction[]) => void;

type Target = { kind: "track"; track: TrackSummary; extra: ExtraAction[] } | { kind: "menu"; menu: MenuSheet };

const TrackActionsContext = createContext<{ openTrack: Open; openMenu(menu: MenuSheet): void }>({
  openTrack: () => undefined,
  openMenu: () => undefined,
});

/**
 * The "⋯" sheets. A track's: queue it, add it to a playlist, like it, start its radio, go to its artist, share
 * or report it. A page's (release, artist, playlist): whatever the page passes, such as Share and Report.
 */
export function TrackActionsProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null);
  const value = useMemo(
    () => ({
      openTrack: ((track, extra = []) => setTarget({ kind: "track", track, extra })) as Open,
      openMenu: (menu: MenuSheet) => setTarget({ kind: "menu", menu }),
    }),
    [],
  );

  // An iPhone can't open another sheet (such as the share sheet) while this one is still sliding away, so the
  // chosen action waits for it to go. In case the "gone" signal never comes, it runs after a moment anyway.
  const after = useRef<{ action: () => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const runAfter = useCallback(() => {
    const pending = after.current;
    after.current = null;
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.action();
  }, []);
  const close = useCallback<Close>(
    (then) => {
      setTarget(null);
      if (!then) return;
      if (Platform.OS !== "ios") return then();
      after.current = { action: then, timer: setTimeout(runAfter, 700) };
    },
    [runAfter],
  );

  return (
    <TrackActionsContext.Provider value={value}>
      {children}
      <Modal
        visible={target !== null}
        transparent
        animationType="slide"
        onRequestClose={() => close()}
        onDismiss={runAfter}
        statusBarTranslucent
      >
        {target?.kind === "track" ? <TrackSheet track={target.track} extra={target.extra} close={close} /> : null}
        {target?.kind === "menu" ? <PageSheet menu={target.menu} close={close} /> : null}
      </Modal>
    </TrackActionsContext.Provider>
  );
}

/** Close the sheet, then run `then` (the action chosen) once it's gone. */
type Close = (then?: () => void) => void;

export const useTrackActions = () => useContext(TrackActionsContext).openTrack;

/** Open a page's "⋯" sheet. */
export const useMoreMenu = () => useContext(TrackActionsContext).openMenu;

/** The sheet itself: a dimmed backdrop that closes it, and a panel with a heading. */
function SheetFrame({ header, onClose, children }: { header: ReactNode; onClose(): void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.header}>{header}</View>
        {children}
      </View>
    </View>
  );
}

function PageSheet({ menu, close }: { menu: MenuSheet; close: Close }) {
  return (
    <SheetFrame
      onClose={() => close()}
      header={
        <>
          {menu.artwork ? (
            <Artwork url={menu.artwork.url} title={menu.title} size={48} round={menu.artwork.round} />
          ) : null}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.title} numberOfLines={1}>
              {menu.title}
            </Text>
            {menu.subtitle ? (
              <Text style={styles.sub} numberOfLines={1}>
                {menu.subtitle}
              </Text>
            ) : null}
          </View>
        </>
      }
    >
      <ScrollView style={{ maxHeight: 480 }}>
        {menu.items.map((item) => (
          <Item key={item.label} label={item.label} onPress={() => close(item.onSelect)} />
        ))}
      </ScrollView>
    </SheetFrame>
  );
}

function TrackSheet({ track, extra, close }: { track: TrackSummary; extra: ExtraAction[]; close: Close }) {
  const { me } = useAuth();
  const player = usePlayer();
  const library = useLibrary();
  const toast = useToast();
  const router = useRouter();
  const go = useGo();
  const share = useShare();
  const [view, setView] = useState<"main" | "playlists">("main");
  const [newName, setNewName] = useState("");

  /** Close the sheet and run an action anyone can take (visitors hear previews). */
  const run = (action: () => void) => () => close(action);

  /** Run an action that needs an account, sending signed-out visitors to log in. */
  const signedIn = (action: () => void) => () =>
    close(() => {
      if (me) return action();
      toast("Log in first");
      router.navigate(routes.account);
    });

  const navigate = (href: string) => () => close(() => go(href));

  const addTo = async (playlistId: string, name: string) => {
    close();
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

  const startRadio = () =>
    void player
      .startRadio({ type: "track", id: track.id })
      .then((name) => toast(`Playing ${name}`))
      .catch((e: unknown) => toast(errorMessage(e, "Couldn't start the radio.")));

  const liked = library.isLiked(track.id);

  return (
    <SheetFrame
      onClose={() => close()}
      header={
        <>
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
        </>
      }
    >
      {view === "main" ? (
        <ScrollView style={{ maxHeight: 480 }}>
          <Item label="Play next" onPress={run(() => (player.playNext(track), toast("Playing next")))} />
          <Item label="Add to queue" onPress={run(() => (player.addToQueue(track), toast("Added to queue")))} />
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
          <Item label="Start radio" onPress={run(startRadio)} />
          <View style={styles.rule} />
          <Item label="AI transparency" onPress={navigate(routes.track(track.id))} />
          <Item label="Go to artist" onPress={navigate(routes.artist(track.artist.slug))} />
          {track.release ? (
            <Item label={`Go to ${track.release.title}`} onPress={navigate(routes.release(track.release.id))} />
          ) : null}
          <View style={styles.rule} />
          <Item
            label="Share…"
            onPress={run(
              () => void share({ kind: "track", key: track.id, title: `${track.title} · ${track.artist.name}` }),
            )}
          />
          <Item label="Report…" onPress={navigate(routes.report("track", track.id))} />
          {extra.length ? <View style={styles.rule} /> : null}
          {extra.map((item) => (
            <Item key={item.label} label={item.label} onPress={run(item.onSelect)} />
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
    </SheetFrame>
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
