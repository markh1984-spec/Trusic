import type { AiLabel } from "@trusic/core";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Shelf, ReleaseTile } from "../components/Tiles";
import { TrackList } from "../components/TrackList";
import { Chip, Chips, ErrorNote, Heading, Loading, Muted, Screen } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { LABEL_ORDER, labelName } from "../lib/labels";
import { colors, space } from "../theme";

export function HomeScreen() {
  const [label, setLabel] = useState<AiLabel | "">("");
  const tracks = useAsync(() => api.tracks({ label, limit: 50 }), [label]);
  const releases = useAsync(() => api.newReleases(), []);

  const refresh = () => {
    tracks.reload();
    releases.reload();
  };

  return (
    <Screen onRefresh={refresh} refreshing={tracks.loading && tracks.data !== null}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Music made by people, paid like it.</Text>
        <Muted>
          Every track shows how much AI went into it. Artists get 80% of every pound, and your money only goes to the
          music you play.
        </Muted>
      </View>

      {releases.error ? <ErrorNote message={releases.error} /> : null}
      {releases.data?.length ? (
        <View style={styles.section}>
          <Heading>New releases</Heading>
          <Shelf>
            {releases.data.map((r) => (
              <ReleaseTile key={r.id} release={r} showArtist />
            ))}
          </Shelf>
        </View>
      ) : null}

      <View style={styles.section}>
        <Heading>New tracks</Heading>
        <Chips>
          <Chip label="Everything" active={label === ""} onPress={() => setLabel("")} />
          {LABEL_ORDER.map((l) => (
            <Chip key={l} label={labelName(l)} active={label === l} onPress={() => setLabel(l)} />
          ))}
        </Chips>
        <View style={{ marginTop: space.sm }}>
          {tracks.error ? (
            <ErrorNote message={tracks.error} />
          ) : tracks.loading && !tracks.data ? (
            <Loading />
          ) : (
            <TrackList tracks={tracks.data?.tracks ?? []} label="New tracks" />
          )}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.sm, marginBottom: space.lg },
  heroTitle: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5, lineHeight: 31 },
  section: { marginTop: space.lg },
});
