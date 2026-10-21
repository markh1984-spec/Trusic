import { activeLyricIndex, type LyricLine, type TrackSummary } from "@trusic/client";
import { memo, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { canSeekTo, followOffset, lyricsView, type LyricsView } from "../lib/lyrics";
import { usePlayer, useProgress } from "../state/player";
import { colors, space } from "../theme";
import { Card, Heading, Loading, Muted, Note } from "./ui";

/** After the listener scrolls the lyrics themselves, wait this long before following the music again. */
const FOLLOW_PAUSE_MS = 4000;

/**
 * Lyric lines. While synced lyrics follow the music, the line being sung is lit and earlier ones are dimmed, and
 * tapping a line jumps the music to it. Only re-renders when the line being sung changes.
 */
const LyricLines = memo(function LyricLines({
  lines,
  active,
  following = false,
  onSeek,
  seekableUntilMs = Infinity,
  large = false,
  onLineLayout,
}: {
  lines: LyricLine[];
  /** The line being sung, or -1. */
  active: number;
  /** Synced lyrics of the track that's playing: lines to come are dimmed and the one being sung stands out. */
  following?: boolean;
  onSeek?(ms: number): void;
  /** Previews stop after 30 seconds, so later lines can't be jumped to. */
  seekableUntilMs?: number;
  large?: boolean;
  onLineLayout?(index: number, y: number): void;
}) {
  return (
    <View>
      {lines.map((line, i) => {
        const style = [
          styles.line,
          large && styles.large,
          following && (i === active ? styles.active : i < active ? styles.past : styles.coming),
        ];
        const seekable = onSeek && canSeekTo(line, seekableUntilMs);
        return (
          <View
            key={i}
            onLayout={onLineLayout ? (e) => onLineLayout(i, e.nativeEvent.layout.y) : undefined}
            style={!line.text && styles.gap}
          >
            {!line.text ? null : seekable ? (
              <Pressable
                onPress={() => onSeek(line.timeMs!)}
                accessibilityRole="button"
                accessibilityHint="Plays from this line"
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Text style={style}>{line.text}</Text>
              </Pressable>
            ) : (
              <Text style={style}>{line.text}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
});

/** Synced lines of the track that's playing, lit as they're sung. */
function FollowingLines({
  lines,
  large,
  onActive,
  onLineLayout,
}: {
  lines: LyricLine[];
  large?: boolean;
  onActive?(index: number): void;
  onLineLayout?(index: number, y: number): void;
}) {
  const player = usePlayer();
  const { positionMs } = useProgress();
  const active = activeLyricIndex(lines, positionMs);
  useEffect(() => onActive?.(active), [active, onActive]);
  return (
    <LyricLines
      lines={lines}
      active={active}
      following
      large={large}
      onSeek={player.seek}
      seekableUntilMs={player.previewMs ?? Infinity}
      onLineLayout={onLineLayout}
    />
  );
}

/** The Lyrics card on a track's screen. Synced lyrics follow along while the track plays. */
export function TrackLyricsCard({ track }: { track: TrackSummary }) {
  const { data } = useAsync(() => api.lyrics(track.id), [track.id]);
  const player = usePlayer();
  if (!data || data.trackId !== track.id) return null;
  const view = lyricsView(data, "track");
  if (view.kind === "none") return null;

  const isCurrent = player.current?.id === track.id;
  return (
    <Card style={styles.card}>
      <Heading style={{ marginBottom: 0 }}>Lyrics</Heading>
      {view.kind === "message" ? (
        <Muted small>{view.text}</Muted>
      ) : (
        <>
          {view.note ? <Note tone="warn">{view.note}</Note> : null}
          {view.synced && !isCurrent ? (
            <Muted small>These lyrics follow the music. Press play and each line lights up as it's sung.</Muted>
          ) : null}
          {view.synced && isCurrent ? (
            <FollowingLines lines={view.lines} />
          ) : (
            <LyricLines lines={view.lines} active={-1} />
          )}
        </>
      )}
    </Card>
  );
}

/** Now Playing's lyrics, following whatever is playing. Synced lyrics keep the line being sung in view. */
export function NowPlayingLyrics({ track }: { track: TrackSummary }) {
  const { data, error } = useAsync(() => api.lyrics(track.id), [track.id]);
  const lyrics = data?.trackId === track.id ? data : null;

  if (error && !lyrics) {
    return (
      <View style={styles.center}>
        <Muted style={styles.message}>
          Couldn't load the lyrics. They need an internet connection, even for downloaded tracks.
        </Muted>
      </View>
    );
  }
  if (!lyrics) return <Loading />;
  const view = lyricsView(lyrics, "nowPlaying");
  if (view.kind !== "lines") {
    return (
      <View style={styles.center}>
        <Muted style={styles.message}>{view.kind === "message" ? view.text : "No lyrics for this track yet."}</Muted>
      </View>
    );
  }
  return <ScrollingLyrics key={track.id} view={view} />;
}

function ScrollingLyrics({ view }: { view: Extract<LyricsView, { kind: "lines" }> }) {
  const scroller = useRef<ScrollView>(null);
  const lineY = useRef<number[]>([]);
  const height = useRef(0);
  const linesTop = useRef(0);
  const touchedAt = useRef(0);
  const active = useRef(-1);
  const [follow] = useState(() => (index: number) => {
    const y = lineY.current[index];
    if (index < 0 || y === undefined || Date.now() - touchedAt.current < FOLLOW_PAUSE_MS) return;
    scroller.current?.scrollTo({ y: followOffset(linesTop.current + y, height.current), animated: true });
  });
  const [onActive] = useState(() => (index: number) => {
    active.current = index;
    follow(index);
  });
  // Opened mid-song, the line being sung may be laid out after it became the one being sung.
  const [onLineLayout] = useState(() => (index: number, y: number) => {
    lineY.current[index] = y;
    if (index === active.current) follow(index);
  });

  return (
    <ScrollView
      ref={scroller}
      style={styles.scroller}
      contentContainerStyle={styles.scrollContent}
      onLayout={(e) => (height.current = e.nativeEvent.layout.height)}
      onScrollBeginDrag={() => (touchedAt.current = Date.now())}
      accessibilityLabel="Lyrics"
    >
      {view.note ? (
        <Muted small style={{ marginBottom: space.md }}>
          {view.note}
        </Muted>
      ) : null}
      <View onLayout={(e) => (linesTop.current = e.nativeEvent.layout.y)}>
        {view.synced ? (
          <FollowingLines lines={view.lines} large onActive={onActive} onLineLayout={onLineLayout} />
        ) : (
          <LyricLines lines={view.lines} active={-1} large />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space.lg, gap: space.md },
  line: { color: colors.text, fontSize: 17, lineHeight: 25, fontWeight: "600", paddingVertical: 3 },
  large: { fontSize: 23, lineHeight: 31, fontWeight: "800", paddingVertical: 6 },
  // As on the website: the line being sung in green, lines already sung light, lines to come dimmed.
  active: { color: colors.primary },
  past: { color: "#c4c9d2" },
  coming: { color: colors.muted },
  gap: { height: space.md },
  scroller: { flex: 1 },
  scrollContent: { paddingVertical: space.lg, paddingBottom: 160 },
  center: { flex: 1, justifyContent: "center", paddingHorizontal: space.md },
  message: { textAlign: "center" },
});
