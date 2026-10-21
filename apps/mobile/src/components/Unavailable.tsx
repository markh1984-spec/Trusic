import type { TrackDetail } from "@trusic/client";
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { api, errorMessage } from "../lib/api";
import { takenDownNotice, trackStatusNotice, UNAVAILABLE_PAGES, type UnavailableKind } from "../lib/availability";
import { siteAddress } from "../lib/share-sheet";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { colors, radius, space } from "../theme";
import { Icon } from "./Icon";
import { Button, ErrorNote, Muted, Screen } from "./ui";

/** What listeners see instead of something they can't open: no error codes, and somewhere to go next. */
export function UnavailableScreen({ kind }: { kind: UnavailableKind }) {
  const { me } = useAuth();
  const router = useRouter();
  const page = UNAVAILABLE_PAGES[kind];
  return (
    <Screen>
      <View style={styles.page}>
        <Icon name="info" size={32} color={colors.muted} />
        <Text style={styles.title} role="heading" aria-level={1}>
          {page.title}
        </Text>
        <Muted style={styles.center}>{page.why}</Muted>
        {me?.artists.length && kind !== "playlist" ? (
          <Muted small style={styles.center}>
            If it's yours, Studio on the Trusic website says what's happened and what you can do.
          </Muted>
        ) : null}
        <Button title="Back to the music" onPress={() => router.navigate("/")} style={{ marginTop: space.md }} />
      </View>
    </Screen>
  );
}

/** A notice at the top of a screen, like the website's. */
function StatusCard({ tone, title, children }: { tone: "info" | "warn"; title: string; children: ReactNode }) {
  return (
    <View style={[styles.card, tone === "warn" && styles.warn]} role="status">
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

/** On a track's screen, for its uploader (and admins): why it isn't live, and what to do next. */
export function TrackStatusNotice({ track, onChange }: { track: TrackDetail; onChange(): void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!track.unavailable) return null;
  const notice = trackStatusNotice(track.unavailable, track.isOwner ? "uploader" : "admin");
  const action = notice.action;

  const act = async () => {
    if (!action) return;
    if (action.kind === "website") {
      const url = `${await siteAddress()}${action.path}`;
      Linking.openURL(url).catch(() => toast(`Couldn't open the website. Visit ${url} in your browser.`));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.retryUpload(track.id);
      onChange();
    } catch (e) {
      setError(errorMessage(e, "That didn't work. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StatusCard tone={notice.tone} title={notice.title}>
      {notice.paragraphs.map((p) => (
        <Text key={p} style={styles.text}>
          {p}
        </Text>
      ))}
      {error ? <ErrorNote message={error} /> : null}
      {action ? (
        <Button
          small
          variant={action.kind === "retry" ? "primary" : "ghost"}
          icon={action.kind === "website" ? "external" : undefined}
          title={busy ? "Starting…" : action.label}
          disabled={busy}
          onPress={() => void act()}
          style={{ alignSelf: "flex-start" }}
        />
      ) : null}
    </StatusCard>
  );
}

/** On an artist page or playlist taken down after a report, which only its owner (and admins) can open. */
export function TakenDownNotice({ kind, isOwner }: { kind: "artist" | "playlist"; isOwner: boolean }) {
  const notice = takenDownNotice(kind, isOwner);
  return (
    <StatusCard tone="warn" title={notice.title}>
      <Text style={styles.text}>{notice.text}</Text>
    </StatusCard>
  );
}

const styles = StyleSheet.create({
  page: { alignItems: "center", gap: space.md, paddingTop: space.xxl, paddingHorizontal: space.md },
  title: { color: colors.text, fontSize: 22, fontWeight: "800", textAlign: "center" },
  center: { textAlign: "center" },
  card: {
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
    marginBottom: space.lg,
  },
  warn: { borderColor: "rgba(244,191,79,0.45)" },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
