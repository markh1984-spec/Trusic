import type { ListenerStatementView } from "@trusic/client";
import { aiLabel } from "@trusic/core";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AiBadge } from "../components/AiBadge";
import { Card, ErrorNote, Heading, Loading, Muted, Note, Screen, SignInPrompt } from "../components/ui";
import { SubscriptionCard } from "../components/SubscriptionCard";
import { api } from "../lib/api";
import { money, periodName } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { routes, useGo } from "../lib/navigation";
import { useAuth } from "../state/auth";
import { colors, labelColors, space } from "../theme";

export function MoneyScreen() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) {
    return (
      <Screen>
        <SignInPrompt message="See exactly which artists your subscription paid, month by month." />
      </Screen>
    );
  }
  return <Money />;
}

function Money() {
  const { data, error, loading, reload } = useAsync(() => api.statements(), []);
  return (
    <Screen onRefresh={reload}>
      <Muted style={{ marginBottom: space.lg }}>
        80% of your subscription goes to artists, split only between the tracks you played and weighted towards
        human-made music.
      </Muted>
      <SubscriptionCard />
      <Heading style={{ marginTop: space.xl }}>Where your money went</Heading>
      {error ? <ErrorNote message={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data?.length === 0 ? <Muted>Statements appear after each monthly payout.</Muted> : null}
      {data?.map((s) => (
        <Statement key={s.period} statement={s} />
      ))}
    </Screen>
  );
}

function Statement({ statement: s }: { statement: ListenerStatementView }) {
  const go = useGo();
  const max = Math.max(1, ...s.allocations.map((a) => Math.max(a.amount, a.baseAmount)));
  return (
    <Card style={styles.statement}>
      <Text style={styles.period}>{periodName(s.period)}</Text>
      <View style={styles.flow}>
        <Flow label="You paid" amount={money(s.revenue, s.currency)} />
        <Text style={styles.arrow}>→</Text>
        <Flow label="Trusic" amount={money(s.platform, s.currency)} />
        <Text style={styles.arrow}>+</Text>
        <Flow label="Artists" amount={money(s.artistShare, s.currency)} />
      </View>

      {s.toHumanPot ? (
        <Note>
          {s.toHumanPot.reason === "no_streams"
            ? "You didn't play anything this month, so"
            : "Everything you played was fully AI-generated, so"}{" "}
          your {money(s.toHumanPot.amount, s.currency)} went to the shared pot for human-made music, split by listening
          across Trusic.
        </Note>
      ) : null}

      <View style={{ gap: space.md }}>
        {s.allocations.map((a) => (
          <Pressable
            key={a.track.id}
            onPress={() => go(routes.track(a.track.id))}
            accessibilityRole="button"
            style={styles.allocation}
          >
            <View style={styles.allocationHead}>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={styles.track} numberOfLines={1}>
                  {a.track.title}
                  <Text style={styles.artist}> · {a.track.artist.name}</Text>
                </Text>
                <AiBadge score={a.track.aiScore} />
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.amount}>{money(a.amount, s.currency)}</Text>
                <Muted small>{a.streams} streams</Muted>
              </View>
            </View>
            <View style={styles.bar}>
              <View style={[styles.base, { width: `${(a.baseAmount / max) * 100}%` }]} />
              <View
                style={[
                  styles.fill,
                  { width: `${(a.amount / max) * 100}%`, backgroundColor: labelColors[aiLabel(a.track.aiScore)] },
                ]}
              />
            </View>
          </Pressable>
        ))}
      </View>
      <Muted small>The faint bar shows what each track would have got if AI scores didn't count.</Muted>
    </Card>
  );
}

function Flow({ label, amount }: { label: string; amount: string }) {
  return (
    <View>
      <Muted small>{label}</Muted>
      <Text style={styles.flowAmount}>{amount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statement: { gap: space.md, marginBottom: space.lg },
  period: { color: colors.text, fontSize: 18, fontWeight: "800" },
  flow: { flexDirection: "row", alignItems: "flex-end", gap: space.sm, flexWrap: "wrap" },
  flowAmount: { color: colors.text, fontSize: 16, fontWeight: "800" },
  arrow: { color: colors.muted, fontSize: 16, paddingBottom: 1 },
  allocation: { gap: 6 },
  allocationHead: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  track: { color: colors.text, fontSize: 15, fontWeight: "600" },
  artist: { color: colors.muted, fontWeight: "400" },
  amount: { color: colors.text, fontSize: 15, fontWeight: "800" },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.raised, overflow: "hidden" },
  base: { position: "absolute", top: 0, bottom: 0, left: 0, backgroundColor: "#2b313c" },
  fill: { position: "absolute", top: 0, bottom: 0, left: 0, borderRadius: 4 },
});
