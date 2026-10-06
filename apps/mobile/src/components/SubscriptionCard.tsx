import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { SITE_URL, SUBSCRIBE_URL } from "../lib/config";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { colors, space } from "../theme";
import { Button, Card, Muted } from "./ui";

/**
 * Whether the listener is subscribed. Subscriptions are sold on the website, not
 * in the app: app-store purchases need paid developer accounts and Apple and
 * Google take a cut.
 */
export function SubscriptionCard() {
  const { subscribed, refresh } = useAuth();
  const toast = useToast();
  const [checking, setChecking] = useState(false);

  const openSite = () =>
    void Linking.openURL(SUBSCRIBE_URL).catch(() => toast(`Couldn't open ${SITE_URL}. Visit it in your browser.`));

  const check = async () => {
    setChecking(true);
    await refresh();
    setChecking(false);
  };

  return (
    <Card style={styles.card}>
      <View style={styles.status}>
        <View style={[styles.dot, { backgroundColor: subscribed ? colors.primary : colors.assisted }]} />
        <Text style={styles.title}>{subscribed ? "You're subscribed" : "You're not subscribed"}</Text>
      </View>
      {subscribed ? (
        <Muted>
          Full tracks, and your money goes to the artists you play. Manage your subscription on the website.
        </Muted>
      ) : (
        <Muted>
          You can hear previews of every track. Subscribe on the Trusic website to hear full tracks and pay the artists
          you listen to. There are no ads.
        </Muted>
      )}
      <View style={styles.buttons}>
        <Button
          title={subscribed ? "Open the website" : "Subscribe on the website"}
          icon="external"
          variant={subscribed ? "ghost" : "primary"}
          onPress={openSite}
        />
        {!subscribed ? (
          <Button
            title={checking ? "Checking…" : "I've subscribed"}
            variant="ghost"
            disabled={checking}
            onPress={() => void check()}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  status: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { color: colors.text, fontSize: 18, fontWeight: "800" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
