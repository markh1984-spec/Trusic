import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { Icon } from "../components/Icon";
import { TrackList } from "../components/TrackList";
import { ErrorNote, Heading, Loading, Screen } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { colors, radius, space } from "../theme";

export function SearchScreen() {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");

  // Search as you type, once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const { data, error, loading, reload } = useAsync(() => api.tracks({ q, limit: 100 }), [q]);

  return (
    <Screen onRefresh={reload}>
      <View style={styles.search}>
        <Icon name="search" size={20} color={colors.muted} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Tracks, artists, genres"
          placeholderTextColor={colors.muted}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => setQ(text.trim())}
          accessibilityLabel="Search"
          clearButtonMode="while-editing"
        />
      </View>
      <Heading>{q ? `Results for “${q}”` : "Browse everything"}</Heading>
      {error ? (
        <ErrorNote message={error} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <TrackList
          tracks={data?.tracks ?? []}
          label={q ? `“${q}”` : "Search"}
          empty={q ? "Nothing matched. Try an artist, title or genre." : undefined}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.text,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    marginBottom: space.lg,
  },
  input: { flex: 1, color: colors.bg, fontSize: 16, paddingVertical: 12 },
});
