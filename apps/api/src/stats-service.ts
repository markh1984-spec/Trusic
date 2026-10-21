/**
 * "Trusic for Artists": listening stats and money for an artist's tracks.
 *
 * Streams here are exactly what the payout engine counts: plays of 30 seconds or more (minStreamMs), from
 * subscribers (the only plays recorded), on UTC days, so a calendar month of daily streams adds up to the month's
 * payout run. Late plays (offline listening reported days afterwards) show up on the day they were played as soon
 * as they arrive.
 *
 * Stats are read straight from plays through the covering index plays_track_idx, so they only ever read the
 * artist's own plays, from the index alone, however big the table grows. Measured with 2 million plays in the
 * embedded database: about 10 ms for a typical artist, and under a second for the last 365 days of an artist with
 * 180,000 plays a year. A daily rollup table would be quicker for very big artists, but it would have to be
 * redone whenever late plays arrive; it's worth adding once a single artist has millions of plays a year.
 */
import type {
  ArtistMoney,
  ListeningStats,
  PlaySource,
  StatsPoint,
  StatsRange,
  StatsRole,
  StatsTotals,
  StudioArtist,
  TrackSummary,
} from "@trusic/client";
import { DEFAULT_PAYOUT_CONFIG } from "@trusic/core";
import { and, count, desc, eq, gte, inArray, lt, ne, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  artists,
  followEvents,
  follows,
  ledgerEntries,
  likes,
  payoutPayeeLines,
  payoutRuns,
  payoutTrackLines,
  plays,
  strikes,
  trackSplits,
  tracks,
} from "./db/schema";
import { toArtist } from "./views";

const MIN_STREAM_MS = DEFAULT_PAYOUT_CONFIG.minStreamMs;
const DAY_MS = 24 * 60 * 60 * 1000;

export const RANGE_DAYS: Record<StatsRange, number> = { "7d": 7, "28d": 28, "365d": 365 };

/** The days a range covers: the last N UTC days, today included. */
export interface StatsWindow {
  range: StatsRange;
  bucket: "day" | "week";
  from: Date;
  /** Exclusive: midnight tonight. */
  to: Date;
  /** The same length of time just before `from`. */
  previousFrom: Date;
  /** First day of each point on the chart, "2026-10-14". Weeks start on Mondays; the first may start later. */
  buckets: string[];
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function statsWindow(range: StatsRange, now = new Date()): StatsWindow {
  const days = RANGE_DAYS[range];
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(to.getTime() - days * DAY_MS);
  const bucket = range === "365d" ? "week" : "day";
  const buckets: string[] = [];
  if (bucket === "day") {
    for (let t = from.getTime(); t < to.getTime(); t += DAY_MS) buckets.push(isoDay(new Date(t)));
  } else {
    buckets.push(isoDay(from));
    // Then every Monday after the first day.
    const daysToMonday = (8 - from.getUTCDay()) % 7 || 7;
    for (let t = from.getTime() + daysToMonday * DAY_MS; t < to.getTime(); t += 7 * DAY_MS) {
      buckets.push(isoDay(new Date(t)));
    }
  }
  return { range, bucket, from, to, previousFrom: new Date(from.getTime() - days * DAY_MS), buckets };
}

/** The chart point a timestamp falls in, as "YYYY-MM-DD" (UTC). */
function bucketOf(column: AnyColumn, bucket: "day" | "week"): SQL<string> {
  return bucket === "day"
    ? sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`
    : sql<string>`to_char(date_trunc('week', ${column} at time zone 'UTC'), 'YYYY-MM-DD')`;
}

/** Weeks that started before the range belong to its first point. */
const clampBucket = (key: string, window: StatsWindow) => (key < window.buckets[0]! ? window.buckets[0]! : key);

const isStream = sql`${plays.msPlayed} >= ${MIN_STREAM_MS}`;
const streamCount = sql<number>`count(*) filter (where ${isStream})`.mapWith(Number);
const listenerCount = sql<number>`count(distinct ${plays.userId}) filter (where ${isStream})`.mapWith(Number);
const shortPlayCount = sql<number>`count(*) filter (where not (${isStream}))`.mapWith(Number);

const zeroTotals = (): StatsTotals => ({ streams: 0, listeners: 0, shortPlays: 0, likes: 0 });

/** GROUPING() of (bucket, source, track) for each grouping set below: a bit is set for each column not grouped. */
const BY_BUCKET = 0b011;
const BY_SOURCE = 0b101;
const BY_TRACK = 0b110;
const OVERALL = 0b111;

/**
 * Listening stats for a set of tracks (one track, or all of an artist's). The chart, the sources, each track's
 * figures and the totals come from one pass over the window's plays, which the covering index plays_track_idx
 * answers without touching the table itself.
 */
export async function listeningStats(
  db: Db,
  trackIds: string[],
  window: StatsWindow,
  role: StatsRole,
  options: { artistId?: string } = {},
): Promise<
  ListeningStats & {
    followers: number;
    followersGained: number;
    followersLost: number;
    byTrack: Map<string, { streams: number; listeners: number }>;
  }
> {
  const series = new Map<string, StatsPoint>(
    window.buckets.map((start) => [
      start,
      { start, ...zeroTotals(), followers: 0, followersGained: 0, followersLost: 0 },
    ]),
  );
  const totals = zeroTotals();
  const previous = zeroTotals();
  const byTrack = new Map<string, { streams: number; listeners: number }>();
  const sources: ListeningStats["sources"] = [];
  let followers = 0;
  let followersGained = 0;
  let followersLost = 0;

  if (trackIds.length) {
    const playBucket = bucketOf(plays.playedAt, window.bucket);
    const from = window.from.toISOString();
    // Likes before the window are last period's; the rest go on the chart.
    const likeBucket = sql<string>`case when ${likes.createdAt} < ${from} then 'previous' else ${bucketOf(likes.createdAt, window.bucket)} end`;
    const [grouped, [before], likeRows] = await Promise.all([
      db
        .select({
          set: sql<number>`grouping(${playBucket}, ${plays.source}, ${plays.trackId})`.mapWith(Number),
          bucket: playBucket,
          source: plays.source,
          trackId: plays.trackId,
          streams: streamCount,
          listeners: listenerCount,
          shortPlays: shortPlayCount,
        })
        .from(plays)
        .where(and(inArray(plays.trackId, trackIds), gte(plays.playedAt, window.from), lt(plays.playedAt, window.to)))
        .groupBy(sql`grouping sets ((${playBucket}), (${plays.source}), (${plays.trackId}), ())`),
      db
        .select({ streams: streamCount, listeners: listenerCount, shortPlays: shortPlayCount })
        .from(plays)
        .where(
          and(
            inArray(plays.trackId, trackIds),
            gte(plays.playedAt, window.previousFrom),
            lt(plays.playedAt, window.from),
          ),
        ),
      db
        .select({ bucket: likeBucket, n: count() })
        .from(likes)
        .where(
          and(
            inArray(likes.trackId, trackIds),
            gte(likes.createdAt, window.previousFrom),
            lt(likes.createdAt, window.to),
          ),
        )
        .groupBy(sql`1`),
    ]);

    for (const row of grouped) {
      const figures = { streams: row.streams, listeners: row.listeners, shortPlays: row.shortPlays };
      if (row.set === OVERALL) Object.assign(totals, figures);
      else if (row.set === BY_TRACK) byTrack.set(row.trackId, { streams: row.streams, listeners: row.listeners });
      else if (row.set === BY_SOURCE && row.streams > 0) {
        sources.push({ source: (row.source ?? null) as PlaySource | null, streams: row.streams });
      } else if (row.set === BY_BUCKET) {
        // Each point gets exactly one row (only the week the range starts in is moved), so listeners never double up.
        const point = series.get(clampBucket(row.bucket, window));
        if (point) Object.assign(point, figures);
      }
    }
    // Most streams first; plays from apps that don't say where they started go last among equals.
    sources.sort(
      (a, b) =>
        b.streams - a.streams ||
        Number(a.source === null) - Number(b.source === null) ||
        (a.source ?? "").localeCompare(b.source ?? ""),
    );
    Object.assign(previous, before);
    for (const row of likeRows) {
      if (row.bucket === "previous") previous.likes += row.n;
      else {
        totals.likes += row.n;
        const point = series.get(clampBucket(row.bucket, window));
        if (point) point.likes += row.n;
      }
    }
  }

  if (options.artistId) {
    // Follows and unfollows in the window, from follow_events. The chart counts back from the followers the artist
    // has now, so it always ends at the real number.
    const [[now], changes] = await Promise.all([
      db.select({ n: count() }).from(follows).where(eq(follows.artistId, options.artistId)),
      db
        .select({ bucket: bucketOf(followEvents.createdAt, window.bucket), kind: followEvents.kind, n: count() })
        .from(followEvents)
        .where(
          and(
            eq(followEvents.artistId, options.artistId),
            gte(followEvents.createdAt, window.from),
            lt(followEvents.createdAt, window.to),
          ),
        )
        .groupBy(sql`1`, followEvents.kind),
    ]);
    followers = now?.n ?? 0;
    for (const row of changes) {
      const point = series.get(clampBucket(row.bucket, window));
      if (row.kind === "follow") {
        followersGained += row.n;
        if (point) point.followersGained += row.n;
      } else {
        followersLost += row.n;
        if (point) point.followersLost += row.n;
      }
    }
    let running = followers - followersGained + followersLost;
    for (const point of series.values()) {
      running += point.followersGained - point.followersLost;
      point.followers = Math.max(0, running);
    }
  }

  return {
    range: window.range,
    bucket: window.bucket,
    from: isoDay(window.from),
    to: isoDay(new Date(window.to.getTime() - DAY_MS)),
    totals,
    previous,
    series: [...series.values()],
    sources,
    role,
    followers,
    followersGained,
    followersLost,
    byTrack,
  };
}

/** The most streamed tracks, from `listeningStats`' per-track figures. */
export function topTracks(
  byTrack: Map<string, { streams: number; listeners: number }>,
  summaries: Map<string, TrackSummary>,
  limit = 10,
) {
  return [...byTrack]
    .filter(([id, t]) => summaries.has(id) && t.streams > 0)
    .sort(([a, x], [b, y]) => y.streams - x.streams || y.listeners - x.listeners || (a < b ? -1 : 1))
    .slice(0, limit)
    .map(([id, t]) => ({ track: summaries.get(id)!, ...t }));
}

// ---------------------------------------------------------------------------
// Who can see what.

/**
 * How the user is connected to the artist: the account that owns it, a band member in a track's split, or an
 * admin. Null if they can't see its stats.
 */
export async function statsRole(
  db: Db,
  artistId: string,
  user: { id: string; isAdmin: boolean },
): Promise<StatsRole | null> {
  const [artist] = await db
    .select({ ownerUserId: artists.ownerUserId })
    .from(artists)
    .where(eq(artists.id, artistId))
    .limit(1);
  if (!artist) return null;
  if (artist.ownerUserId === user.id) return "owner";
  const [member] = await db
    .select({ trackId: trackSplits.trackId })
    .from(trackSplits)
    .innerJoin(tracks, eq(tracks.id, trackSplits.trackId))
    .where(and(eq(tracks.artistId, artistId), eq(trackSplits.userId, user.id)))
    .limit(1);
  if (member) return "member";
  return user.isAdmin ? "admin" : null;
}

/** Artist profiles the user owns, then ones they're a band member of. */
export async function studioArtists(db: Db, userId: string): Promise<StudioArtist[]> {
  const owned = await db.select().from(artists).where(eq(artists.ownerUserId, userId)).orderBy(artists.createdAt);
  const memberOf = await db
    .selectDistinct({ artist: artists })
    .from(trackSplits)
    .innerJoin(tracks, eq(tracks.id, trackSplits.trackId))
    .innerJoin(artists, eq(artists.id, tracks.artistId))
    .where(eq(trackSplits.userId, userId));
  const ownedIds = new Set(owned.map((a) => a.id));
  return [
    ...owned.map((a) => ({ artist: toArtist(a), role: "owner" as const })),
    ...memberOf
      .filter((m) => !ownedIds.has(m.artist.id))
      .sort((a, b) => a.artist.name.localeCompare(b.artist.name))
      .map((m) => ({ artist: toArtist(m.artist), role: "member" as const })),
  ];
}

/**
 * The artist's tracks whose plays count: every track it has ever had, including removed and suspended ones, but not
 * ones that have been taken down, whose plays the payout engine ignores too.
 */
export async function artistTrackIds(db: Db, artistId: string, onlyTrackId?: string): Promise<string[]> {
  const rows = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(
      and(
        eq(tracks.artistId, artistId),
        ne(tracks.status, "taken_down"),
        onlyTrackId ? eq(tracks.id, onlyTrackId) : undefined,
      ),
    );
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Money.

/**
 * The viewer's own money from these tracks, month by month, from payout runs, plus any clawbacks from the
 * ledger. A track shows up in a month when the viewer is one of its payees and it had streams that month, even
 * if it earned nothing (an AI Slop track, say), so artists can see why.
 */
export async function artistMoney(
  db: Db,
  artistId: string,
  userId: string,
  currency: string,
  onlyTrackId?: string,
): Promise<ArtistMoney> {
  const artistTracks = await db
    .select({ id: tracks.id, title: tracks.title, ownerUserId: artists.ownerUserId })
    .from(tracks)
    .innerJoin(artists, eq(artists.id, tracks.artistId))
    .where(and(eq(tracks.artistId, artistId), onlyTrackId ? eq(tracks.id, onlyTrackId) : undefined));
  if (artistTracks.length === 0) return { currency, months: [], clawbacks: [] };
  const ids = artistTracks.map((t) => t.id);
  const titles = new Map(artistTracks.map((t) => [t.id, t.title]));

  // The payout engine pays a track's split if it has one, otherwise its owner.
  const splits = await db.select().from(trackSplits).where(inArray(trackSplits.trackId, ids));
  const splitTracks = new Set(splits.map((s) => s.trackId));
  const mine = new Set([
    ...splits.filter((s) => s.userId === userId).map((s) => s.trackId),
    ...artistTracks.filter((t) => !splitTracks.has(t.id) && t.ownerUserId === userId).map((t) => t.id),
  ]);

  const [trackLines, payeeLines, clawbackRows] = await Promise.all([
    db
      .select({
        runId: payoutTrackLines.runId,
        trackId: payoutTrackLines.trackId,
        streams: payoutTrackLines.streams,
        period: payoutRuns.period,
        finalizedAt: payoutRuns.finalizedAt,
      })
      .from(payoutTrackLines)
      .innerJoin(payoutRuns, eq(payoutRuns.id, payoutTrackLines.runId))
      .where(inArray(payoutTrackLines.trackId, ids)),
    db
      .select({ runId: payoutPayeeLines.runId, tracks: payoutPayeeLines.tracks })
      .from(payoutPayeeLines)
      .where(eq(payoutPayeeLines.userId, userId)),
    db
      .select({
        trackId: strikes.trackId,
        amount: ledgerEntries.amount,
        note: ledgerEntries.note,
        createdAt: ledgerEntries.createdAt,
      })
      .from(ledgerEntries)
      .innerJoin(strikes, eq(strikes.id, ledgerEntries.strikeId))
      .where(and(eq(ledgerEntries.userId, userId), eq(ledgerEntries.type, "clawback"), inArray(strikes.trackId, ids)))
      .orderBy(desc(ledgerEntries.createdAt)),
  ]);

  const paid = new Map<string, number>();
  for (const line of payeeLines) {
    for (const t of line.tracks) if (titles.has(t.trackId)) paid.set(`${line.runId}:${t.trackId}`, t.amount);
  }

  const months = new Map<string, ArtistMoney["months"][number]>();
  for (const line of trackLines) {
    const amount = paid.get(`${line.runId}:${line.trackId}`);
    // Tracks the viewer isn't paid for are someone else's money.
    if (amount === undefined && !mine.has(line.trackId)) continue;
    const month = months.get(line.period) ?? {
      period: line.period,
      finalised: line.finalizedAt !== null,
      amount: 0,
      tracks: [],
    };
    month.amount += amount ?? 0;
    month.tracks.push({
      trackId: line.trackId,
      title: titles.get(line.trackId)!,
      amount: amount ?? 0,
      streams: line.streams,
    });
    months.set(line.period, month);
  }

  return {
    currency,
    months: [...months.values()]
      .sort((a, b) => (a.period < b.period ? 1 : -1))
      .map((m) => ({ ...m, tracks: m.tracks.sort((a, b) => b.amount - a.amount || b.streams - a.streams) })),
    clawbacks: clawbackRows.map((c) => ({
      trackId: c.trackId,
      title: titles.get(c.trackId)!,
      amount: c.amount,
      date: c.createdAt.toISOString(),
      note: c.note,
    })),
  };
}
