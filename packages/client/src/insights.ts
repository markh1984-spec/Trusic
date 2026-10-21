/**
 * Shapes for artist stats ("Trusic for Artists"), recommendations, radio and
 * the "Human-made only" listening setting. Kept apart from types.ts so these
 * features can grow without touching the core API types.
 */
import type { Artist, ArtistRef, ReleaseSummary, TrackSummary } from "./types";

/** Where a play started. Apps send one with each play; older apps send none. */
export const PLAY_SOURCES = [
  "release",
  "playlist",
  "artist",
  "search",
  "liked",
  "radio",
  "recommendations",
  "queue",
  "other",
] as const;
export type PlaySource = (typeof PLAY_SOURCES)[number];

/** Plain-English names for play sources, as artists see them in their stats. */
export const PLAY_SOURCE_NAMES: Record<PlaySource, string> = {
  release: "Albums, EPs and singles",
  playlist: "Playlists",
  artist: "Your artist page",
  search: "Search",
  liked: "Listeners' Liked songs",
  radio: "Radio",
  recommendations: "Trusic's recommendations",
  queue: "Listeners' queues",
  other: "Elsewhere on Trusic",
};

// ---------------------------------------------------------------------------
// The "Human-made only" setting.

export interface HumanOnlySetting {
  /** Leave tracks labelled Partly AI and AI Slop out of browsing, search, recommendations and radio. */
  humanOnly: boolean;
}

// ---------------------------------------------------------------------------
// Recommendations and radio.

/** A recommended track and, in plain English, why it was picked. */
export interface RecommendedTrack {
  track: TrackSummary;
  reason: string;
}

export interface RecommendedArtist {
  artist: Artist;
  reason: string;
  /** Live tracks, and how many of them are labelled Human-made. */
  tracks: number;
  humanMadeTracks: number;
}

interface ShelfBase {
  id: string;
  title: string;
  /** What this shelf is and which signals chose it, for "Why am I seeing this?". */
  why: string;
}

export type HomeShelf =
  | (ShelfBase & { kind: "tracks"; tracks: RecommendedTrack[] })
  | (ShelfBase & { kind: "releases"; releases: ReleaseSummary[] })
  | (ShelfBase & { kind: "artists"; artists: RecommendedArtist[] });

export interface HomeFeed {
  /** False for visitors and for accounts with no listening yet: the shelves are the same for everyone. */
  personalised: boolean;
  humanOnly: boolean;
  shelves: HomeShelf[];
}

export interface SimilarTracks {
  why: string;
  humanOnly: boolean;
  tracks: RecommendedTrack[];
}

export interface SimilarArtists {
  why: string;
  humanOnly: boolean;
  artists: RecommendedArtist[];
}

/** What a radio station is based on. */
export interface RadioSeed {
  type: "track" | "artist" | "playlist";
  id: string;
}

export interface RadioBatch {
  seed: RadioSeed;
  /** e.g. "Chalk Paths radio". */
  name: string;
  why: string;
  humanOnly: boolean;
  tracks: RecommendedTrack[];
}

// ---------------------------------------------------------------------------
// Artist stats.

export type StatsRange = "7d" | "28d" | "365d";

/** Who is looking at an artist's stats. Everyone sees all the listening stats; money is always the viewer's own. */
export type StatsRole = "owner" | "member" | "admin";

/** An artist profile the signed-in user can see stats for. */
export interface StudioArtist {
  artist: Artist;
  role: StatsRole;
}

export interface StatsTotals {
  /** Plays of 30 seconds or more: exactly what the payout engine counts. */
  streams: number;
  /** Different subscribers who streamed at least once. */
  listeners: number;
  /** Plays that stopped before 30 seconds, so didn't count as streams. */
  shortPlays: number;
  /** New likes. */
  likes: number;
}

export interface StatsPoint extends StatsTotals {
  /** First day of the day or week, "2026-10-14". */
  start: string;
  /** Followers at the end of this day or week (people who follow now, by when they followed). Artists only. */
  followers: number;
}

export interface ListeningStats {
  range: StatsRange;
  /** Daily points for 7 and 28 days, weekly for 365. */
  bucket: "day" | "week";
  /** First and last day covered, inclusive. The last day is today, so far. */
  from: string;
  to: string;
  totals: StatsTotals;
  /** The same length of time just before, for comparison. */
  previous: StatsTotals;
  series: StatsPoint[];
  /** Streams by where they started. `null` is plays from apps that don't say. */
  sources: { source: PlaySource | null; streams: number }[];
  role: StatsRole;
}

export interface ArtistStats extends ListeningStats {
  artist: ArtistRef;
  /** People following the artist now. */
  followers: number;
  /** Of those, how many followed during this time. */
  followersGained: number;
  topTracks: { track: TrackSummary; streams: number; listeners: number }[];
}

export interface TrackStats extends ListeningStats {
  track: TrackSummary;
  /** Likes the track has now. */
  likesTotal: number;
  /** The viewer's own money from this track. */
  money: ArtistMoney;
}

/** The viewer's own money from an artist's tracks, by month. Band members only ever see their own share. */
export interface ArtistMoney {
  currency: string;
  months: {
    period: string;
    /** Locked for paying out. Until then the month can still be recalculated. */
    finalised: boolean;
    /** Your share across these tracks this month, in pence. */
    amount: number;
    tracks: {
      trackId: string;
      title: string;
      /** Your share of this track's money. */
      amount: number;
      /** Streams the payout engine counted for the whole track that month. */
      streams: number;
    }[];
  }[];
  /** Money taken back after a false AI declaration on one of these tracks. Negative, in pence. */
  clawbacks: { trackId: string; title: string; amount: number; date: string; note: string }[];
}
