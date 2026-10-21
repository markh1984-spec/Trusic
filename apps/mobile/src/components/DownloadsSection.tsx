import type { OfflineCollection } from "@trusic/client";
import { storageSize } from "@trusic/player";
import { Alert, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { plural } from "../lib/format";
import { routes, useGo } from "../lib/navigation";
import { useAuth } from "../state/auth";
import { useOffline } from "../state/offline";
import { useToast } from "../state/toast";
import { colors, radius, space } from "../theme";
import { Artwork } from "./Artwork";
import { Icon } from "./Icon";
import { LikedCover } from "./Tiles";
import { Button, Card, Muted, Note } from "./ui";

const KINDS: Record<OfflineCollection["type"], string> = {
  release: "Release",
  playlist: "Playlist",
  liked: "Playlist",
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

function confirmRemoveAll(): Promise<boolean> {
  const message = "They'll be deleted from this phone. You can download them again later.";
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`Remove all downloads?\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert("Remove all downloads?", message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Remove", style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

/** Library › Downloads: what's on the phone, the space it takes, and the Wi-Fi setting. */
export function DownloadsSection() {
  const { subscribed } = useAuth();
  const offline = useOffline();
  const go = useGo();
  const toast = useToast();
  const { state } = offline;
  const count = Object.keys(state.tracks).length;
  const expired = count > 0 && (!state.validUntil || Date.now() >= Date.parse(state.validUntil));

  if (!subscribed && count === 0) {
    return (
      <View style={{ gap: space.md }}>
        {state.notice ? <Note tone="warn">{state.notice}</Note> : null}
        <Muted>
          Subscribers can download albums, playlists and liked songs to listen without signal. Subscribe from the
          Account tab.
        </Muted>
      </View>
    );
  }

  const status = state.progress
    ? `Downloading ${state.progress.done} of ${state.progress.total}…`
    : state.waiting?.reason === "wifi"
      ? `${plural(state.waiting.tracks, "track")} waiting for Wi-Fi`
      : state.waiting?.reason === "offline" || (offline.isOffline && state.waiting)
        ? `${plural(state.waiting!.tracks, "track")} waiting for a connection`
        : state.validUntil && !expired
          ? `Plays offline until ${day(state.validUntil)}`
          : null;

  const removeAll = async () => {
    if (!(await confirmRemoveAll())) return;
    await offline.removeAll();
    toast("Downloads removed");
  };

  return (
    <View style={{ gap: space.md }}>
      <Card style={styles.summary}>
        <View style={{ flex: 1 }}>
          <Text style={styles.big}>{storageSize(state.bytes)}</Text>
          <Muted small>
            {plural(count, "track")} downloaded{status ? ` · ${status}` : ""}
          </Muted>
        </View>
        <Icon name="download" size={28} color={colors.primary} />
      </Card>

      {state.notice ? <Note tone="warn">{state.notice}</Note> : null}
      {expired ? (
        <Note tone="warn">
          Connect to the internet to keep playing your downloads. Trusic checks them at least every 30 days.
        </Note>
      ) : null}

      <View style={styles.setting}>
        <View style={{ flex: 1 }}>
          <Text style={styles.settingTitle}>Download using Wi-Fi only</Text>
          <Muted small>Saves your mobile data. Downloads wait until you're on Wi-Fi.</Muted>
        </View>
        <Switch
          value={offline.wifiOnly}
          onValueChange={offline.setWifiOnly}
          accessibilityLabel="Download using Wi-Fi only"
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={colors.text}
        />
      </View>

      {state.collections.length === 0 ? (
        <Muted>
          Nothing downloaded yet. Turn on Download on an album, a playlist or your liked songs, and it'll play without
          signal.
        </Muted>
      ) : (
        <View>
          {state.collections.map((c) => {
            const done = c.trackIds.filter((id) => state.tracks[id]).length;
            const href =
              c.type === "liked" ? routes.liked : c.type === "release" ? routes.release(c.id!) : routes.playlist(c.id!);
            return (
              <Pressable
                key={`${c.type}:${c.id}`}
                onPress={() => go(href)}
                accessibilityRole="link"
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.cardPressed }]}
              >
                {c.type === "liked" ? (
                  <LikedCover size={56} />
                ) : (
                  <Artwork url={c.artworkUrl} title={c.title} size={56} />
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {c.title}
                  </Text>
                  <Muted small>
                    {[
                      KINDS[c.type],
                      c.subtitle,
                      done >= c.trackIds.length ? plural(done, "track") : `${done} of ${c.trackIds.length} tracks`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Muted>
                </View>
                <Icon name="chevronRight" size={18} color={colors.muted} />
              </Pressable>
            );
          })}
        </View>
      )}

      {count > 0 || state.collections.length > 0 ? (
        <Button title="Remove all downloads" variant="ghost" onPress={() => void removeAll()} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", gap: space.md },
  big: { color: colors.text, fontSize: 26, fontWeight: "800" },
  setting: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
  },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
});
