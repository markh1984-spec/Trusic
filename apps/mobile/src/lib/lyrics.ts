/**
 * What the phone shows for a track's lyrics, following the website's rules: covers never show lyrics (Trusic has
 * no lyric licence for them), and synced lyrics follow the music. The LRC parser and `activeLyricIndex` are shared,
 * in @trusic/client.
 */
import type { LyricLine, TrackLyrics } from "@trusic/client";

export const COVER_LYRICS_NOTE =
  "Lyrics aren't shown for covers. The words belong to the original songwriters, and showing them needs a licence Trusic doesn't have yet.";

export type LyricsView =
  /** Lines to show. `synced` lines can follow the music; `note` is said above them. */
  | { kind: "lines"; lines: LyricLine[]; synced: boolean; note: string | null }
  /** Something to say instead of lyrics. */
  | { kind: "message"; text: string }
  | { kind: "none" };

/**
 * What to show for `lyrics`. `where` is the track's own screen, which says nothing when a track has no lyrics,
 * or Now Playing, which always says something.
 */
export function lyricsView(lyrics: TrackLyrics, where: "track" | "nowPlaying"): LyricsView {
  if (!lyrics.format) {
    if (lyrics.hidden === "cover") return { kind: "message", text: COVER_LYRICS_NOTE };
    if (lyrics.canEdit) {
      return { kind: "message", text: "No lyrics yet. You can add them in Studio on the Trusic website." };
    }
    return where === "nowPlaying" ? { kind: "message", text: "No lyrics for this track yet." } : { kind: "none" };
  }
  const synced = lyrics.format === "synced";
  // Only the band gets lyrics for a cover (so they can fix or remove them), and they're told nobody else sees them.
  const note =
    lyrics.hidden === "cover"
      ? `Only you and your band can see these. ${COVER_LYRICS_NOTE}`
      : !synced && where === "nowPlaying"
        ? "These lyrics aren't synced to the music."
        : null;
  return { kind: "lines", lines: lyrics.lines, synced, note };
}

/** Tapping a synced line jumps the music to it, unless it's past the end of a 30-second preview. */
export function canSeekTo(line: LyricLine, untilMs: number): boolean {
  return line.text !== "" && line.timeMs !== null && line.timeMs < untilMs;
}

/** Where to scroll so the line being sung sits a third of the way down the view. */
export function followOffset(lineY: number, viewHeight: number): number {
  return Math.max(0, lineY - viewHeight / 3);
}
