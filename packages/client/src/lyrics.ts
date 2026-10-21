import type { LyricLine, LyricsFormat } from "./types";

/**
 * Lyrics come as plain text, or as LRC: the common format for time-synced lyrics, where each line starts with the
 * time it's sung, like "[01:23.45]And the tide comes in". Shared by the server (which checks lyrics before saving
 * them) and the apps (which follow the music with them).
 */

export const MAX_LYRICS_CHARS = 20_000;
export const MAX_LYRICS_LINES = 1_000;
const MAX_LINE_CHARS = 500;

/** One or more times at the start of a line: "[01:23.45]", "[1:23]", "[01:23.4][02:40.1]". */
const LEADING_TIMES = /^((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+)(.*)$/;
const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
/** Information tags such as [ar:The Hollow Pines] or [offset:+200]. */
const INFO_TAG = /^\[([a-z#]+):(.*)\]$/i;
/** Word-by-word timings ("enhanced LRC"). We highlight whole lines, so these are dropped. */
const WORD_TIME = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

export interface ParsedLyrics {
  lines: LyricLine[];
  /** A plain-English description of the first problem found, or null if the lyrics are fine. */
  error: string | null;
}

export function parseLyrics(format: LyricsFormat, text: string): ParsedLyrics {
  if (text.length > MAX_LYRICS_CHARS) {
    return fail(`Lyrics can be up to ${MAX_LYRICS_CHARS.toLocaleString("en-GB")} characters long.`);
  }
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  if (raw.length > MAX_LYRICS_LINES) return fail(`Lyrics can have up to ${MAX_LYRICS_LINES} lines.`);
  const long = raw.findIndex((l) => l.length > MAX_LINE_CHARS);
  if (long >= 0) return fail(`Line ${long + 1} is too long. Lines can be up to ${MAX_LINE_CHARS} characters.`);
  return format === "synced" ? parseSynced(raw) : parsePlain(raw);
}

function parsePlain(raw: string[]): ParsedLyrics {
  const lines: LyricLine[] = [];
  for (const line of raw.map((l) => l.trim())) {
    // Keep one empty line between verses, however many were typed.
    if (!line && (lines.length === 0 || lines[lines.length - 1]!.text === "")) continue;
    lines.push({ timeMs: null, text: line });
  }
  while (lines.length && lines[lines.length - 1]!.text === "") lines.pop();
  if (lines.length === 0) return fail("Type or paste the lyrics first.");
  return { lines, error: null };
}

function parseSynced(raw: string[]): ParsedLyrics {
  let offsetMs = 0;
  const lines: LyricLine[] = [];
  for (const [i, original] of raw.entries()) {
    const line = original.trim();
    if (!line) continue;
    const times = LEADING_TIMES.exec(line);
    if (!times) {
      const info = INFO_TAG.exec(line);
      if (info) {
        // A positive offset makes every line appear sooner.
        if (info[1]!.toLowerCase() === "offset") offsetMs = Number.parseInt(info[2]!.trim(), 10) || 0;
        continue;
      }
      return fail(
        `Line ${i + 1} has no time. In synced lyrics every line starts with the time it's sung, like [01:23.45].`,
      );
    }
    const words = times[2]!.replace(WORD_TIME, "").trim();
    for (const [, minutes, seconds, fraction] of times[1]!.matchAll(TIME)) {
      if (Number(seconds) >= 60) return fail(`Line ${i + 1} has a time that can't be right: "${line.slice(0, 30)}".`);
      const ms = (Number(minutes) * 60 + Number(seconds)) * 1000 + Number((fraction ?? "").padEnd(3, "0"));
      lines.push({ timeMs: Math.max(0, ms - offsetMs), text: words });
    }
  }
  if (lines.length === 0) return fail("Synced lyrics need at least one line with a time, like [00:12.00].");
  // Lines can be listed out of order (a chorus with several times), so sort them. The sort is stable.
  lines.sort((a, b) => a.timeMs! - b.timeMs!);
  return { lines, error: null };
}

const fail = (error: string): ParsedLyrics => ({ lines: [], error });

/** Does this text look like LRC? Used to suggest the synced format when lyrics are pasted. */
export function looksSynced(text: string): boolean {
  return text.split(/\r?\n/).some((line) => LEADING_TIMES.test(line.trim()));
}

/** The line being sung at `positionMs`: the last one that has started. -1 before the first line. */
export function activeLyricIndex(lines: LyricLine[], positionMs: number): number {
  let active = -1;
  for (const [i, line] of lines.entries()) {
    if (line.timeMs === null || line.timeMs > positionMs) break;
    active = i;
  }
  return active;
}

/** "01:23.45" */
export function formatLrcTime(ms: number): string {
  const hundredths = Math.max(0, Math.round(ms / 10));
  const minutes = Math.floor(hundredths / 6000);
  const seconds = Math.floor((hundredths % 6000) / 100);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}.${pad(hundredths % 100)}`;
}

/** Turn timed lines back into LRC text. */
export function toLrc(lines: LyricLine[]): string {
  return lines.map((l) => `[${formatLrcTime(l.timeMs ?? 0)}]${l.text}`).join("\n");
}
