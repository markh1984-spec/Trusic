import { StyleSheet, Text, View } from "react-native";
import { useOffline } from "../state/offline";
import { colors, space } from "../theme";

/** Above the tabs while there's no connection, so it's clear why most things can't load. */
export function OfflineBanner() {
  const { isOffline, state } = useOffline();
  if (!isOffline) return null;
  const hasDownloads = Object.keys(state.tracks).length > 0;
  return (
    <View style={styles.banner} role="status">
      <Text style={styles.text}>
        <Text style={styles.strong}>You're offline. </Text>
        {hasDownloads
          ? "Downloaded music still plays. Find it in Library › Downloads."
          : "Download music while you have signal to listen without it."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "rgba(244, 191, 79, 0.14)",
    borderTopWidth: 1,
    borderTopColor: "rgba(244, 191, 79, 0.4)",
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  text: { color: colors.text, fontSize: 13, lineHeight: 18 },
  strong: { fontWeight: "700", color: colors.assisted },
});
