import type { AiLabel } from "@trusic/core";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { HumanOnlySwitch } from "../components/HumanOnly";
import { HomeShelfView } from "../components/Shelves";
import { TrackList } from "../components/TrackList";
import { Chip, Chips, ErrorNote, Heading, Loading, Muted, Note, Screen } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { LABEL_ORDER, labelName } from "../lib/labels";
import { useAuth } from "../state/auth";
import { useHumanOnly } from "../state/human-only";
import { colors, space } from "../theme";

function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/**
 * Home: shelves picked from listening on Trusic, each saying why (personal ones for listeners, the same for
 * everyone else), then every new track. The "Human-made only" switch sits at the top.
 */
export function HomeScreen() {
  const { me } = useAuth();
  const { humanOnly } = useHumanOnly();
  const userId = me?.user.id;
  const [label, setLabel] = useState<AiLabel | "">("");
  const feed = useAsync(() => api.home({ humanOnly }), [humanOnly, userId]);
  const tracks = useAsync(
    () => api.tracks({ label: humanOnly ? "" : label, limit: 50, humanOnly }),
    [label, humanOnly],
  );

  const refresh = () => {
    feed.reload();
    tracks.reload();
  };

  return (
    <Screen onRefresh={refresh} refreshing={feed.loading && feed.data !== null}>
      {me ? (
        <Text style={styles.greeting} role="heading" aria-level={1}>
          {greeting()}, {me.user.displayName.split(" ")[0]}
        </Text>
      ) : (
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Music made by people, paid like it.</Text>
          <Muted>
            Every track shows how much AI went into it. Artists get 80% of every pound, and your money only goes to the
            music you play.
          </Muted>
        </View>
      )}

      <HumanOnlySwitch />

      {me && feed.data && !feed.data.personalised ? (
        <Note>
          Play a few tracks, like the ones you love or follow an artist, and this page will fill up with music picked
          for you. Until then, here's what people are playing on Trusic.
        </Note>
      ) : null}

      {feed.error ? <ErrorNote message={feed.error} /> : null}
      {feed.loading && !feed.data ? <Loading /> : null}
      {feed.data?.shelves.map((shelf) => (
        <HomeShelfView key={shelf.id} shelf={shelf} />
      ))}

      <View style={styles.section}>
        <Heading>Browse new tracks</Heading>
        {humanOnly ? null : (
          <Chips>
            <Chip label="Everything" active={label === ""} onPress={() => setLabel("")} />
            {LABEL_ORDER.map((l) => (
              <Chip key={l} label={labelName(l)} active={label === l} onPress={() => setLabel(l)} />
            ))}
          </Chips>
        )}
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
  greeting: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5, marginBottom: space.md },
  hero: { gap: space.sm, marginBottom: space.lg },
  heroTitle: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5, lineHeight: 31 },
  section: { marginTop: space.xl },
});
