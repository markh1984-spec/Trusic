import type { OfflineCollection } from "@trusic/client";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useAuth } from "../state/auth";
import { useOffline } from "../state/offline";
import { useToast } from "../state/toast";
import { colors, radius, space } from "../theme";
import { Icon } from "./Icon";

/** "Download" switch for a release, playlist or liked songs. Subscribers only. */
export function DownloadToggle({ collection }: { collection: OfflineCollection }) {
  const { me, subscribed } = useAuth();
  const offline = useOffline();
  const toast = useToast();
  if (!me || !subscribed) return null;

  const on = offline.isOn(collection);
  const total = collection.trackIds.length;
  const done = collection.trackIds.filter((id) => offline.state.tracks[id]).length;
  const { waiting, busy } = offline.state;
  const status = !on
    ? "Listen without signal"
    : done >= total
      ? `Downloaded · ${total} ${total === 1 ? "track" : "tracks"}`
      : waiting?.reason === "wifi" && !busy
        ? `Waiting for Wi-Fi · ${done} of ${total}`
        : waiting?.reason === "offline" && !busy
          ? `Waiting for a connection · ${done} of ${total}`
          : `Downloading ${done} of ${total}…`;

  const change = (value: boolean) => {
    if (value && total === 0) return;
    offline.setCollection(collection, value).catch(() => toast("Couldn't change your downloads. Please try again."));
  };

  return (
    <View style={styles.row}>
      <Icon name={on && done >= total ? "check" : "download"} size={20} color={on ? colors.primary : colors.muted} />
      <View style={styles.text}>
        <Text style={styles.label}>Download</Text>
        <Text style={styles.status} numberOfLines={1}>
          {status}
        </Text>
      </View>
      <Switch
        value={on}
        onValueChange={change}
        accessibilityLabel={`Download ${collection.title}`}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor={colors.text}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginBottom: space.md,
  },
  text: { flex: 1, minWidth: 0 },
  label: { color: colors.text, fontSize: 15, fontWeight: "700" },
  status: { color: colors.muted, fontSize: 13 },
});
