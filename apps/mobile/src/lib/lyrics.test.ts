import { activeLyricIndex, parseLyrics, type TrackLyrics } from "@trusic/client";
import { describe, expect, it } from "vitest";
import { canSeekTo, COVER_LYRICS_NOTE, followOffset, lyricsView } from "./lyrics";

const synced = parseLyrics(
  "synced",
  "[00:05.00]First line\n[00:12.50]Second line\n\n[00:40.00]After the preview",
).lines;
const plain = parseLyrics("plain", "Just words\nAnd more").lines;

const lyrics = (over: Partial<TrackLyrics>): TrackLyrics => ({
  trackId: "t",
  format: null,
  lines: [],
  source: null,
  hidden: null,
  canEdit: false,
  updatedAt: null,
  ...over,
});

describe("lyrics on the phone", () => {
  it("never shows lyrics for a cover to listeners", () => {
    const cover = lyrics({ hidden: "cover" });
    expect(lyricsView(cover, "track")).toEqual({ kind: "message", text: COVER_LYRICS_NOTE });
    expect(lyricsView(cover, "nowPlaying")).toEqual({ kind: "message", text: COVER_LYRICS_NOTE });
  });

  it("shows a cover's lyrics to its band only, saying nobody else sees them", () => {
    const view = lyricsView(lyrics({ format: "plain", lines: plain, hidden: "cover", canEdit: true }), "track");
    expect(view).toMatchObject({ kind: "lines", synced: false });
    expect(view.kind === "lines" && view.note).toContain("Only you and your band");
  });

  it("follows the music with synced lyrics, and says when lyrics aren't synced", () => {
    expect(lyricsView(lyrics({ format: "synced", lines: synced }), "nowPlaying")).toEqual({
      kind: "lines",
      lines: synced,
      synced: true,
      note: null,
    });
    expect(lyricsView(lyrics({ format: "plain", lines: plain }), "nowPlaying")).toMatchObject({
      synced: false,
      note: "These lyrics aren't synced to the music.",
    });
    expect(lyricsView(lyrics({ format: "plain", lines: plain }), "track")).toMatchObject({ note: null });
  });

  it("says nothing on a track's screen when it has no lyrics, unless you can add them", () => {
    expect(lyricsView(lyrics({}), "track")).toEqual({ kind: "none" });
    expect(lyricsView(lyrics({}), "nowPlaying")).toEqual({ kind: "message", text: "No lyrics for this track yet." });
    expect(lyricsView(lyrics({ canEdit: true }), "track")).toMatchObject({ kind: "message" });
  });

  it("lets you tap a line to jump to it, but not past a preview's end or onto a gap", () => {
    expect(canSeekTo(synced[1]!, 30_000)).toBe(true);
    expect(canSeekTo(synced.at(-1)!, 30_000)).toBe(false);
    expect(canSeekTo({ timeMs: 20_000, text: "" }, 30_000)).toBe(false);
    expect(canSeekTo(plain[0]!, Infinity)).toBe(false);
  });

  it("keeps the line being sung a third of the way down", () => {
    expect(activeLyricIndex(synced, 13_000)).toBe(1);
    expect(followOffset(900, 600)).toBe(700);
    expect(followOffset(100, 600)).toBe(0);
  });
});
