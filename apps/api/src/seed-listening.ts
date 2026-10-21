/**
 * Demo listening history for the seed: listeners with tastes, months of plays with sources, and the likes and
 * follows that go with them. Recommendations need people who listen to overlapping music, and artist stats need
 * a few months of it to draw. Everything is generated from a fixed seed, so every run makes the same data.
 */
import type { PlaySource } from "@trusic/client";
import { periodBounds } from "./payout-service";

/** Repeatable "random" numbers (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoListener {
  id: string;
  /** Plays per month of each track, by track key. */
  taste: Record<string, number>;
  /** Index into the list of months (oldest first) of the first month they listened. */
  firstMonth: number;
}

export interface DemoPlay {
  userId: string;
  trackId: string;
  aiScore: number;
  msPlayed: number;
  playedAt: Date;
  source: PlaySource;
}

/** How people mostly start playing music. Each listener leans on a few of these. */
const SOURCE_WEIGHTS: [PlaySource, number][] = [
  ["release", 30],
  ["playlist", 24],
  ["liked", 12],
  ["artist", 10],
  ["search", 8],
  ["recommendations", 8],
  ["radio", 5],
  ["queue", 3],
];

function pick<T>(weighted: [T, number][], random: () => number): T {
  const total = weighted.reduce((a, [, w]) => a + w, 0);
  let r = random() * total;
  for (const [value, w] of weighted) if ((r -= w) < 0) return value;
  return weighted.at(-1)![0];
}

/** A moment in [start, end), more often in the evening and at weekends, like real listening. */
function listeningTime(start: number, end: number, random: () => number): Date {
  for (;;) {
    const at = new Date(start + random() * (end - start));
    const hour = at.getUTCHours();
    const weekend = at.getUTCDay() === 0 || at.getUTCDay() === 6;
    const weight = (weekend ? 1 : 0.7) * (hour >= 17 && hour <= 23 ? 1 : hour >= 7 ? 0.6 : 0.15);
    if (random() < weight) return at;
  }
}

/**
 * Plays for each listener, month by month from the month they joined. The current month only gets the share
 * that has happened so far. About one play in nine is skipped before 30 seconds and doesn't count.
 */
export function simulateListening(options: {
  listeners: DemoListener[];
  months: string[];
  trackIds: Record<string, string>;
  scores: Record<string, number>;
  now: Date;
  random: () => number;
}): DemoPlay[] {
  const { listeners, months, trackIds, scores, now, random } = options;
  const plays: DemoPlay[] = [];
  for (const listener of listeners) {
    // Each listener has their own habits for where they press play.
    const habits = SOURCE_WEIGHTS.map(([s, w]): [PlaySource, number] => [s, w * (0.3 + random() * 1.4)]);
    months.forEach((period, m) => {
      if (m < listener.firstMonth) return;
      const [start, end] = periodBounds(period);
      const until = Math.min(end.getTime(), now.getTime());
      if (until <= start.getTime()) return;
      const share = (until - start.getTime()) / (end.getTime() - start.getTime());
      for (const [key, perMonth] of Object.entries(listener.taste)) {
        // Some months more, some less; newer listeners are keener.
        const count = Math.round(perMonth * share * (0.6 + random() * 0.8) * (m === listener.firstMonth ? 0.6 : 1));
        for (let n = 0; n < count; n++) {
          plays.push({
            userId: listener.id,
            trackId: trackIds[key]!,
            aiScore: scores[trackIds[key]!]!,
            msPlayed: random() < 1 / 9 ? 5_000 + Math.floor(random() * 20_000) : 45_000,
            playedAt: listeningTime(start.getTime(), until, random),
            source: pick(habits, random),
          });
        }
      }
    });
  }
  return plays.sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
}

/** Groups of tracks people tend to like together, by track key. */
export const TASTE_GROUPS: Record<string, string[]> = {
  folk: ["pines1", "pines2", "pines3", "morrow1", "morrow2", "mara1"],
  songwriters: ["mara1", "mara2", "morrow2", "ada1", "pines3"],
  electronic: ["harbour1", "harbour2", "kiln1", "kiln2"],
  soul: ["velvet1", "ada1", "ada2", "mara2"],
  aiPop: ["neon1", "neon2", "neon3", "neon4"],
};

/** First names for the extra demo listeners. Their emails are <name>@trusic.local. */
export const EXTRA_LISTENERS = [
  "amira",
  "ben",
  "callum",
  "daisy",
  "ellis",
  "fatima",
  "george",
  "hana",
  "isla",
  "jamal",
  "keira",
  "liam",
  "maya",
  "noah",
  "olivia",
  "priyanka",
  "quinn",
  "rosie",
  "sami",
  "theo",
  "uma",
  "vikram",
  "willow",
  "xander",
  "yasmin",
  "zac",
  "aled",
  "bethan",
  "cerys",
  "dylan",
];

/**
 * A taste for the n-th extra listener: mostly one group, sometimes a second, and now and then an AI track (most
 * people on a new platform try a bit of everything).
 */
export function extraTaste(n: number, random: () => number): Record<string, number> {
  const groups = Object.keys(TASTE_GROUPS);
  // AI pop is a small corner of Trusic: about one listener in eight.
  const main = n % 8 === 7 ? "aiPop" : groups.filter((g) => g !== "aiPop")[n % 4]!;
  const taste: Record<string, number> = {};
  const add = (group: string, scale: number) => {
    for (const key of TASTE_GROUPS[group]!) {
      if (random() < 0.75) taste[key] = Math.max(taste[key] ?? 0, Math.round((2 + random() * 9) * scale));
    }
  };
  add(main, 1);
  if (random() < 0.45) add(groups[Math.floor(random() * groups.length)]!, 0.4);
  if (main !== "aiPop" && random() < 0.2) taste[`neon${1 + Math.floor(random() * 3)}`] = 2;
  return taste;
}
