import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { routes } from "../lib/navigation";
import { usePlayer, useProgress } from "../state/player";
import { colors, space } from "../theme";
import { AiBadge } from "./AiBadge";
import { Artwork } from "./Artwork";
import { Icon } from "./Icon";

/** The bar above the tabs while something is playing. Tap it for Now Playing. */
export function MiniPlayer() {
  const player = usePlayer();
  const router = useRouter();
  const track = player.current;
  if (!track) return null;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => router.push(routes.nowPlaying)}
        accessibilityRole="button"
        accessibilityLabel={`Now playing: ${track.title} by ${track.artist.name}. Open player.`}
        style={styles.bar}
      >
        <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size={42} />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {track.title}
          </Text>
          <View style={styles.meta}>
            <AiBadge score={track.aiScore} />
            <Text style={styles.sub} numberOfLines={1}>
              {player.previewMs !== null ? "Preview" : track.artist.name}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={player.toggle}
          accessibilityRole="button"
          accessibilityLabel={player.playing ? "Pause" : "Play"}
          hitSlop={10}
          style={styles.toggle}
        >
          <Icon name={player.playing ? "pause" : "play"} size={26} />
        </Pressable>
      </Pressable>
      <ProgressLine />
    </View>
  );
}

function ProgressLine() {
  const { positionMs, durationMs } = useProgress();
  const pct = durationMs ? Math.min(100, (positionMs / durationMs) * 100) : 0;
  return (
    <View style={styles.progress}>
      <View style={[styles.progressFill, { width: `${pct}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: space.sm,
    marginBottom: space.xs,
    backgroundColor: "#22262f",
    borderRadius: 10,
    overflow: "hidden",
  },
  bar: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm, paddingRight: space.md },
  text: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: colors.text, fontSize: 15, fontWeight: "700" },
  meta: { flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 },
  sub: { color: colors.muted, fontSize: 13, flexShrink: 1 },
  toggle: { padding: 4 },
  progress: { height: 2, backgroundColor: "#3a404c", marginHorizontal: space.sm },
  progressFill: { height: "100%", backgroundColor: colors.text },
});
