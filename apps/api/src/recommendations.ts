/**
 * Recommendations and radio, built in-house from listening on Trusic and nothing else.
 *
 * The rules (also in docs/PRODUCT.md):
 * - Ranking uses only what listeners do on Trusic: streams (plays of 30 seconds or more) and likes. Nobody can pay
 *   to be recommended, and no AI label is ever boosted. The only other input is the listener's "Human-made only"
 *   switch, which leaves tracks that aren't Human-made out altogether.
 * - Every recommendation says why, in plain English.
 *
 * "Similar" means streamed and liked by the same people. For some seed tracks we take their most recent
 * listeners (the audience), look at what else those people stream and like, and rank each track by how many of
 * them do, discounted a little for tracks that everyone plays anyway. When there isn't enough listening (a new
 * track, a small catalogue) we fall back to the same artist, then the same genre, then what's popular.
 *
 * Every query is bounded (so many listeners per seed, so many plays per listener) and goes through an index, so
 * the cost doesn't grow with the size of the plays table.
 */
import type {
  Artist,
  HomeFeed,
  HomeShelf,
  RadioBatch,
  RadioSeed,
  RecommendedArtist,
  RecommendedTrack,
  TrackSummary,
} from "@trusic/client";
import { aiLabel, DEFAULT_PAYOUT_CONFIG } from "@trusic/core";
import { and, asc, countDistinct, desc, eq, gte, inArray, max, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { artists, follows, likes, playlistEntries, playlists, plays, tracks } from "./db/schema";
import { HttpError } from "./errors";
import { humanMadeOnly } from "./human-only";
import { loadReleaseSummaries, selectTrackSummaries, toArtist, toTrackSummary } from "./views";

const MIN_STREAM_MS = DEFAULT_PAYOUT_CONFIG.minStreamMs;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Listening older than this doesn't shape recommendations. */
const HISTORY_DAYS = 365;
/** "Popular" means played by the most people in this many days. */
const POPULAR_DAYS = 28;
/** At most this many recent streams make up "popular", so it stays quick however busy Trusic gets. */
const POPULAR_SAMPLE = 50_000;
/** The most recent listeners of the seed tracks we learn from. */
const AUDIENCE_SIZE = 300;
const PLAYS_PER_SEED = 500;
/** The most recent streams and likes of each of those listeners. */
const PLAYS_PER_LISTENER = 300;
const LIKES_PER_LISTENER = 200;
/** Softens the discount for popular tracks, so a couple of shared listeners still count for a little-known one. */
const POPULARITY_SMOOTHING = 5;

const SHELF_SIZE = 12;

/** Said on every shelf, so the rules are never hidden. */
const FAIR =
  "Ranked only by what people play and like on Trusic: nobody can pay to be here, and no AI label gets a boost.";
const HUMAN_ONLY_NOTE = "Human-made only is on, so tracks labelled Partly AI and AI Slop are left out.";

const sinceDays = (days: number) => new Date(Date.now() - days * DAY_MS);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const quoted = (title: string) => `“${title}”`;
const uuidList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

export interface RecommendOptions {
  humanOnly: boolean;
  /** Track ids not to recommend (already playing, already known…). */
  exclude?: Set<string>;
  /** Leave this listener out of the audience, so their own listening doesn't explain itself. */
  viewerId?: string;
  limit?: number;
}

/** Live tracks by id, in the order given, leaving out any that aren't Human-made when the switch is on. */
async function liveSummaries(db: Db, ids: string[], humanOnly: boolean): Promise<Map<string, TrackSummary>> {
  if (ids.length === 0) return new Map();
  const rows = await selectTrackSummaries(db).where(
    and(inArray(tracks.id, [...new Set(ids)]), eq(tracks.status, "live"), humanOnly ? humanMadeOnly() : undefined),
  );
  const byId = new Map(rows.map((r) => [r.id, toTrackSummary(r)]));
  return new Map(ids.filter((id) => byId.has(id)).map((id) => [id, byId.get(id)!]));
}

/** How many different people streamed each track recently, from the newest streams. */
export async function recentPopularity(db: Db): Promise<Map<string, number>> {
  const recent = db
    .select({ trackId: plays.trackId, userId: plays.userId })
    .from(plays)
    .where(and(gte(plays.msPlayed, MIN_STREAM_MS), gte(plays.playedAt, sinceDays(POPULAR_DAYS))))
    .orderBy(desc(plays.playedAt))
    .limit(POPULAR_SAMPLE)
    .as("recent");
  const rows = await db
    .select({ trackId: recent.trackId, listeners: countDistinct(recent.userId) })
    .from(recent)
    .groupBy(recent.trackId);
  return new Map(rows.map((r) => [r.trackId, r.listeners]));
}

const byPopularity = (popularity: Map<string, number>) => (a: TrackSummary, b: TrackSummary) =>
  (popularity.get(b.id) ?? 0) - (popularity.get(a.id) ?? 0) ||
  b.createdAt.localeCompare(a.createdAt) ||
  (a.id < b.id ? -1 : 1);

// ---------------------------------------------------------------------------
// Co-listening: who streams and likes the seeds, and what else they stream and like.

interface CoListening {
  /** Each audience member, and which seeds they streamed or liked. */
  audience: Map<string, Set<string>>;
  /** What the audience streams and likes: track → listener → weight (1 for streaming, 2 for liking). */
  tracks: Map<string, Map<string, number>>;
}

async function coListening(db: Db, seedIds: string[], viewerId?: string): Promise<CoListening> {
  const result: CoListening = { audience: new Map(), tracks: new Map() };
  if (seedIds.length === 0) return result;
  const since = sinceDays(HISTORY_DAYS).toISOString();
  const notViewer = viewerId ? sql`and a.user_id <> ${viewerId}::uuid` : sql``;

  const audience = await db.execute<{ userId: string; seeds: string }>(sql`
    select a.user_id::text as "userId", string_agg(distinct a.seed::text, ',') as seeds
    from (
      select p.user_id, s.id as seed, p.played_at as at
      from unnest(array[${uuidList(seedIds)}]) as s(id)
      cross join lateral (
        select user_id, played_at from plays
        where track_id = s.id and ms_played >= ${MIN_STREAM_MS} and played_at >= ${since}
        order by played_at desc limit ${PLAYS_PER_SEED}
      ) p
      union all
      select l.user_id, s.id, l.created_at
      from unnest(array[${uuidList(seedIds)}]) as s(id)
      cross join lateral (
        select user_id, created_at from likes where track_id = s.id order by created_at desc limit ${PLAYS_PER_SEED}
      ) l
    ) a
    where true ${notViewer}
    group by a.user_id
    order by max(a.at) desc
    limit ${AUDIENCE_SIZE}`);
  for (const row of audience.rows) result.audience.set(row.userId, new Set(row.seeds.split(",")));
  if (result.audience.size === 0) return result;

  const users = [...result.audience.keys()];
  const listened = await db.execute<{ trackId: string; userId: string; liked: boolean }>(sql`
    select x.track_id::text as "trackId", x.user_id::text as "userId", bool_or(x.liked) as liked
    from (
      select p.track_id, u.id as user_id, false as liked
      from unnest(array[${uuidList(users)}]) as u(id)
      cross join lateral (
        select track_id from plays
        where user_id = u.id and ms_played >= ${MIN_STREAM_MS} and played_at >= ${since}
        order by played_at desc limit ${PLAYS_PER_LISTENER}
      ) p
      union all
      select l.track_id, u.id, true
      from unnest(array[${uuidList(users)}]) as u(id)
      cross join lateral (
        select track_id from likes where user_id = u.id order by created_at desc limit ${LIKES_PER_LISTENER}
      ) l
    ) x
    group by 1, 2`);
  for (const row of listened.rows) {
    const listeners = result.tracks.get(row.trackId) ?? new Map<string, number>();
    listeners.set(row.userId, row.liked ? 2 : 1);
    result.tracks.set(row.trackId, listeners);
  }
  return result;
}

/** The seed most of these listeners have in common, and how many of them share it. */
function sharedSeed(listeners: Iterable<string>, audience: Map<string, Set<string>>): [string, number] | null {
  const counts = new Map<string, number>();
  for (const user of listeners)
    for (const seed of audience.get(user) ?? []) counts.set(seed, (counts.get(seed) ?? 0) + 1);
  let best: [string, number] | null = null;
  for (const entry of counts)
    if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0])) best = entry;
  return best;
}

// ---------------------------------------------------------------------------
// Similar tracks.

/**
 * Tracks similar to the seeds, best first, each with its reason: co-listening first, then the seeds' artists,
 * then their genres, then (unless `fallback` is "related") what's popular.
 */
export async function similarTracks(
  db: Db,
  seeds: TrackSummary[],
  options: RecommendOptions & { popularity?: Map<string, number>; fallback?: "all" | "related" },
): Promise<RecommendedTrack[]> {
  const limit = options.limit ?? SHELF_SIZE;
  const exclude = new Set([...(options.exclude ?? []), ...seeds.map((s) => s.id)]);
  const seedTitles = new Map(seeds.map((s) => [s.id, s.title]));
  const popularity = options.popularity ?? (await recentPopularity(db));

  const co = await coListening(
    db,
    seeds.map((s) => s.id),
    options.viewerId,
  );
  const scored = [...co.tracks]
    .filter(([id]) => !exclude.has(id))
    .map(([id, listeners]) => {
      const weight = [...listeners.values()].reduce((a, b) => a + b, 0);
      return { id, listeners, score: weight / Math.sqrt(POPULARITY_SMOOTHING + (popularity.get(id) ?? 0)) };
    })
    .sort((a, b) => b.score - a.score || b.listeners.size - a.listeners.size || (a.id < b.id ? -1 : 1));
  const summaries = await liveSummaries(
    db,
    scored.slice(0, limit * 3).map((s) => s.id),
    options.humanOnly,
  );

  const picked: RecommendedTrack[] = [];
  const add = (track: TrackSummary, reason: string) => {
    if (picked.length >= limit || exclude.has(track.id)) return;
    exclude.add(track.id);
    picked.push({ track, reason });
  };
  for (const s of scored) {
    const track = summaries.get(s.id);
    const shared = sharedSeed(s.listeners.keys(), co.audience);
    if (!track || !shared) continue;
    const [seed, n] = shared;
    add(track, `${plural(n, "listener")} of ${quoted(seedTitles.get(seed)!)} also ${n === 1 ? "plays" : "play"} this`);
  }
  if (picked.length >= limit) return picked;

  // Not enough listening yet: the same artists, then the same genres, then what's popular.
  const artistIds = [...new Set(seeds.map((s) => s.artist.id))];
  const genres = [...new Set(seeds.map((s) => s.genre).filter((g): g is string => Boolean(g)))];
  const candidates = await selectTrackSummaries(db)
    .where(
      and(
        eq(tracks.status, "live"),
        options.humanOnly ? humanMadeOnly() : undefined,
        exclude.size ? notInArray(tracks.id, [...exclude]) : undefined,
        or(
          inArray(tracks.artistId, artistIds),
          genres.length
            ? inArray(
                sql`lower(${tracks.genre})`,
                genres.map((g) => g.toLowerCase()),
              )
            : undefined,
        ),
      ),
    )
    .limit(200);
  const fallback = candidates.map(toTrackSummary).sort(byPopularity(popularity));
  for (const track of fallback) {
    if (artistIds.includes(track.artist.id)) add(track, `More from ${track.artist.name}`);
  }
  for (const track of fallback) {
    const seed = seeds.find((s) => s.genre && s.genre.toLowerCase() === track.genre?.toLowerCase());
    if (seed) add(track, `${track.genre}, like ${quoted(seed.title)}`);
  }
  if (picked.length < limit && options.fallback !== "related") {
    for (const r of await popularTracks(db, popularity, { ...options, exclude, limit: limit - picked.length })) {
      add(r.track, r.reason);
    }
  }
  return picked;
}

/** The tracks the most people played in the last four weeks. */
export async function popularTracks(
  db: Db,
  popularity: Map<string, number>,
  options: RecommendOptions & { genre?: string },
): Promise<RecommendedTrack[]> {
  const limit = options.limit ?? SHELF_SIZE;
  const ranked = [...popularity].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
  const summaries = await liveSummaries(
    db,
    ranked.filter((id) => !options.exclude?.has(id)).slice(0, limit * 4),
    options.humanOnly,
  );
  return [...summaries.values()]
    .filter((t) => !options.genre || t.genre?.toLowerCase() === options.genre.toLowerCase())
    .slice(0, limit)
    .map((track) => ({
      track,
      reason: options.genre
        ? `Popular in ${options.genre} in the last four weeks`
        : "Popular on Trusic in the last four weeks",
    }));
}

// ---------------------------------------------------------------------------
// Similar artists ("Fans also like").

async function artistSummaries(db: Db, artistIds: string[], humanOnly: boolean) {
  if (artistIds.length === 0) return new Map<string, { artist: Artist; tracks: number; humanMadeTracks: number }>();
  const rows = await db
    .select({ artist: artists, aiScore: tracks.aiScore })
    .from(artists)
    .innerJoin(tracks, and(eq(tracks.artistId, artists.id), eq(tracks.status, "live")))
    .where(inArray(artists.id, artistIds));
  const byId = new Map<string, { artist: Artist; tracks: number; humanMadeTracks: number }>();
  for (const row of rows) {
    const entry = byId.get(row.artist.id) ?? { artist: toArtist(row.artist), tracks: 0, humanMadeTracks: 0 };
    entry.tracks += 1;
    if (aiLabel(row.aiScore) === "human") entry.humanMadeTracks += 1;
    byId.set(row.artist.id, entry);
  }
  // With Human-made only on, artists with nothing Human-made are left out.
  if (humanOnly) for (const [id, a] of byId) if (a.humanMadeTracks === 0) byId.delete(id);
  return byId;
}

/** An artist's live tracks, most played recently first. */
async function artistTracks(db: Db, artistId: string, popularity: Map<string, number>, humanOnly: boolean) {
  const rows = await selectTrackSummaries(db).where(
    and(eq(tracks.artistId, artistId), eq(tracks.status, "live"), humanOnly ? humanMadeOnly() : undefined),
  );
  return rows.map(toTrackSummary).sort(byPopularity(popularity));
}

export async function similarArtists(
  db: Db,
  artistId: string,
  options: RecommendOptions,
): Promise<RecommendedArtist[]> {
  const limit = options.limit ?? 8;
  const [artist] = await db.select().from(artists).where(eq(artists.id, artistId)).limit(1);
  if (!artist) throw new HttpError(404, "Artist not found.");
  const popularity = await recentPopularity(db);
  const own = await artistTracks(db, artistId, popularity, false);
  const co = await coListening(
    db,
    own.slice(0, 10).map((t) => t.id),
    options.viewerId,
  );

  // Group what the audience plays by artist: how many of them play each one.
  const candidateIds = [...co.tracks.keys()];
  const owners = candidateIds.length
    ? await db
        .select({ id: tracks.id, artistId: tracks.artistId })
        .from(tracks)
        .where(and(inArray(tracks.id, candidateIds), eq(tracks.status, "live")))
    : [];
  const listenersByArtist = new Map<string, Set<string>>();
  const artistPopularity = new Map<string, number>();
  for (const { id, artistId: owner } of owners) {
    if (owner === artistId) continue;
    const set = listenersByArtist.get(owner) ?? new Set<string>();
    for (const user of co.tracks.get(id)!.keys()) set.add(user);
    listenersByArtist.set(owner, set);
    artistPopularity.set(owner, (artistPopularity.get(owner) ?? 0) + (popularity.get(id) ?? 0));
  }
  const ranked = [...listenersByArtist]
    .map(([id, users]) => ({
      id,
      users: users.size,
      score: users.size / Math.sqrt(POPULARITY_SMOOTHING + (artistPopularity.get(id) ?? 0)),
    }))
    .sort((a, b) => b.score - a.score || b.users - a.users || (a.id < b.id ? -1 : 1));

  const picked: RecommendedArtist[] = [];
  const seen = new Set([artistId]);
  const details = await artistSummaries(
    db,
    ranked.map((r) => r.id),
    options.humanOnly,
  );
  for (const r of ranked) {
    const d = details.get(r.id);
    if (!d || picked.length >= limit) continue;
    seen.add(r.id);
    picked.push({
      ...d,
      reason: `${plural(r.users, "listener")} in common with ${artist.name}`,
    });
  }
  if (picked.length >= limit) return picked;

  // Not enough listening yet: artists in the same genres, most played first.
  const genres = [...new Set(own.map((t) => t.genre?.toLowerCase()).filter((g): g is string => Boolean(g)))];
  if (genres.length) {
    const sameGenre = await db
      .selectDistinct({ artistId: tracks.artistId, genre: tracks.genre })
      .from(tracks)
      .where(and(eq(tracks.status, "live"), inArray(sql`lower(${tracks.genre})`, genres)));
    const more = await artistSummaries(
      db,
      [...new Set(sameGenre.map((g) => g.artistId))].filter((id) => !seen.has(id)),
      options.humanOnly,
    );
    const ordered = [...more.values()].sort((a, b) => a.artist.name.localeCompare(b.artist.name));
    for (const d of ordered) {
      if (picked.length >= limit) break;
      const genre = sameGenre.find((g) => g.artistId === d.artist.id)?.genre;
      picked.push({ ...d, reason: `Also ${genre}, like ${artist.name}` });
    }
  }
  return picked;
}

/** Artists whose tracks the most people played in the last four weeks. */
async function popularArtists(
  db: Db,
  popularity: Map<string, number>,
  options: RecommendOptions & { excludeArtists?: Set<string> },
): Promise<RecommendedArtist[]> {
  const ids = [...popularity.keys()];
  if (ids.length === 0) return [];
  const owners = await db
    .select({ id: tracks.id, artistId: tracks.artistId })
    .from(tracks)
    .where(and(inArray(tracks.id, ids), eq(tracks.status, "live")));
  const score = new Map<string, number>();
  for (const o of owners) score.set(o.artistId, (score.get(o.artistId) ?? 0) + (popularity.get(o.id) ?? 0));
  const ranked = [...score]
    .filter(([id]) => !options.excludeArtists?.has(id))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);
  const details = await artistSummaries(db, ranked, options.humanOnly);
  return ranked
    .filter((id) => details.has(id))
    .slice(0, options.limit ?? 10)
    .map((id) => ({ ...details.get(id)!, reason: "Popular on Trusic in the last four weeks" }));
}

// ---------------------------------------------------------------------------
// The home page.

function playedWhen(at: Date, now = new Date()): string {
  const days = Math.floor(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - at.getTime()) / DAY_MS,
  );
  if (at.getTime() >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    return "You played this today";
  if (days < 1) return "You played this yesterday";
  return `You played this on ${at.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}`;
}

const why = (text: string, humanOnly: boolean) => [text, FAIR, humanOnly ? HUMAN_ONLY_NOTE : ""].join(" ").trim();

/**
 * The home page's shelves. Signed-in listeners with some listening get theirs first; everyone gets the same
 * popular, new and human-made shelves, so a visitor or a brand-new account still has plenty to play.
 */
export async function homeFeed(db: Db, viewerId: string | null, humanOnly: boolean): Promise<HomeFeed> {
  const popularity = await recentPopularity(db);
  const shelves: HomeShelf[] = [];
  let personalised = false;
  const followedArtists = new Set<string>();

  if (viewerId) {
    const lastPlayed = max(plays.playedAt);
    const [recent, top, liked, followed] = await Promise.all([
      db
        .select({ trackId: plays.trackId, at: lastPlayed })
        .from(plays)
        .where(eq(plays.userId, viewerId))
        .groupBy(plays.trackId)
        .orderBy(desc(lastPlayed))
        .limit(SHELF_SIZE * 2),
      db
        .select({ trackId: plays.trackId, streams: sql<number>`count(*)`.mapWith(Number) })
        .from(plays)
        .where(and(eq(plays.userId, viewerId), gte(plays.msPlayed, MIN_STREAM_MS), gte(plays.playedAt, sinceDays(90))))
        .groupBy(plays.trackId)
        .orderBy(desc(sql`count(*)`), desc(max(plays.playedAt)))
        .limit(200),
      db
        .select({ trackId: likes.trackId })
        .from(likes)
        .where(eq(likes.userId, viewerId))
        .orderBy(desc(likes.createdAt))
        .limit(50),
      db.select({ artistId: follows.artistId }).from(follows).where(eq(follows.userId, viewerId)),
    ]);
    for (const f of followed) followedArtists.add(f.artistId);
    personalised = recent.length > 0 || liked.length > 0 || followed.length > 0;
    const known = new Set([...top.map((t) => t.trackId), ...liked.map((l) => l.trackId)]);

    // Jump back in: what you played last.
    const recentSummaries = await liveSummaries(
      db,
      recent.map((r) => r.trackId),
      humanOnly,
    );
    const jumpBackIn = recent
      .filter((r) => recentSummaries.has(r.trackId) && r.at)
      .slice(0, SHELF_SIZE)
      .map((r) => ({ track: recentSummaries.get(r.trackId)!, reason: playedWhen(new Date(r.at!)) }));
    if (jumpBackIn.length) {
      shelves.push({
        kind: "tracks",
        id: "jump-back-in",
        title: "Jump back in",
        why: why("Tracks you've played recently, most recent first.", humanOnly),
        tracks: jumpBackIn,
      });
    }

    // Made for you: like what you play most, but new to you.
    const seedIds = [...top.slice(0, 8).map((t) => t.trackId), ...liked.slice(0, 4).map((l) => l.trackId)];
    const seeds = [...(await liveSummaries(db, seedIds, false)).values()];
    if (seeds.length) {
      const madeForYou = await similarTracks(db, seeds, {
        humanOnly,
        exclude: known,
        viewerId,
        popularity,
      });
      if (madeForYou.length >= 3) {
        shelves.push({
          kind: "tracks",
          id: "made-for-you",
          title: "Made for you",
          why: why(
            "Tracks streamed and liked by people who play the same music as you, that you haven't played yet. When there isn't enough listening to go on, we add more from the same artists and genres.",
            humanOnly,
          ),
          tracks: madeForYou,
        });
      }
    }

    // New from artists you follow.
    if (followed.length) {
      const fresh = await selectTrackSummaries(db)
        .where(
          and(
            inArray(
              tracks.artistId,
              followed.map((f) => f.artistId),
            ),
            eq(tracks.status, "live"),
            gte(tracks.createdAt, sinceDays(90)),
            humanOnly ? humanMadeOnly() : undefined,
          ),
        )
        .orderBy(desc(tracks.createdAt))
        .limit(SHELF_SIZE);
      if (fresh.length) {
        shelves.push({
          kind: "tracks",
          id: "new-from-follows",
          title: "New from artists you follow",
          why: why("The newest tracks from artists you follow, from the last three months, newest first.", humanOnly),
          tracks: fresh
            .map(toTrackSummary)
            .map((track) => ({ track, reason: `New from ${track.artist.name}, who you follow` })),
        });
      }
    }

    // Because you liked…: the most recent like that has enough listening around it.
    for (const like of (
      await liveSummaries(
        db,
        liked.slice(0, 3).map((l) => l.trackId),
        false,
      )
    ).values()) {
      const because = await similarTracks(db, [like], {
        humanOnly,
        exclude: new Set([like.id]),
        viewerId,
        popularity,
        limit: 10,
      });
      if (because.length >= 3) {
        shelves.push({
          kind: "tracks",
          id: `because-you-liked-${like.id}`,
          title: `Because you liked ${quoted(like.title)}`,
          why: why(
            `Tracks streamed and liked by people who also like ${quoted(like.title)}, then more from the same artist and genre.`,
            humanOnly,
          ),
          tracks: because,
        });
        break;
      }
    }
  }

  // For everyone: what's popular, what's new, and new human-made music.
  const popular = await popularTracks(db, popularity, { humanOnly });
  if (popular.length) {
    shelves.push({
      kind: "tracks",
      id: "popular",
      title: "Popular on Trusic",
      why: why(
        "The tracks the most people have played in the last four weeks. Everyone sees the same list.",
        humanOnly,
      ),
      tracks: popular,
    });
  }
  const recentReleases = await loadReleaseSummaries(db, { withTracks: true, limit: humanOnly ? 60 : SHELF_SIZE });
  const releaseShelf = (
    humanOnly ? recentReleases.filter((r) => r.aiLabels.human === r.trackCount) : recentReleases
  ).slice(0, SHELF_SIZE);
  if (releaseShelf.length) {
    shelves.push({
      kind: "releases",
      id: "new-releases",
      title: "New releases",
      why: why(
        humanOnly
          ? "The latest albums, EPs and singles where every track is Human-made, newest first."
          : "The latest albums, EPs and singles, newest first. Each carries its AI label.",
        humanOnly,
      ),
      releases: releaseShelf,
    });
  }
  const humanMade = await selectTrackSummaries(db)
    .where(and(eq(tracks.status, "live"), humanMadeOnly()))
    .orderBy(desc(tracks.createdAt), asc(tracks.id))
    .limit(SHELF_SIZE);
  if (humanMade.length) {
    shelves.push({
      kind: "tracks",
      id: "fresh-human-made",
      title: "Fresh human-made music",
      why: why(
        "The newest tracks labelled Human-made, newest first. This shelf is about the label, not a boost: it's in plain sight and the order is simply by date.",
        humanOnly,
      ),
      tracks: humanMade
        .map(toTrackSummary)
        .map((track) => ({ track, reason: `New on Trusic · ${track.genre ?? "Human-made"}` })),
    });
  }
  const discover = await popularArtists(db, popularity, { humanOnly, excludeArtists: followedArtists });
  if (discover.length) {
    shelves.push({
      kind: "artists",
      id: "artists-to-discover",
      title: viewerId && personalised ? "Artists you don't follow yet" : "Artists to discover",
      why: why("Artists whose music the most people have played in the last four weeks.", humanOnly),
      artists: discover,
    });
  }

  // A new listener has nothing to go on yet, so show the most played genres too.
  if (!personalised) {
    const genreCounts = new Map<string, { name: string; listeners: number }>();
    for (const r of popular) {
      if (!r.track.genre) continue;
      const key = r.track.genre.toLowerCase();
      const g = genreCounts.get(key) ?? { name: r.track.genre, listeners: 0 };
      g.listeners += popularity.get(r.track.id) ?? 0;
      genreCounts.set(key, g);
    }
    const topGenres = [...genreCounts.values()].sort((a, b) => b.listeners - a.listeners).slice(0, 2);
    for (const genre of topGenres) {
      const inGenre = await popularTracks(db, popularity, { humanOnly, genre: genre.name });
      if (inGenre.length >= 2) {
        shelves.push({
          kind: "tracks",
          id: `genre-${genre.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          title: genre.name,
          why: why(`The most played ${genre.name} on Trusic in the last four weeks.`, humanOnly),
          tracks: inGenre,
        });
      }
    }
  }

  return { personalised, humanOnly, shelves };
}

// ---------------------------------------------------------------------------
// Radio.

const RADIO_BATCH = 10;
/** Never repeat one of the last few tracks, even when a small catalogue has run out of new ones. */
const RADIO_NO_REPEAT = 10;
/** A station with fewer related tracks than this is topped up with popular ones, so it isn't the same few on repeat. */
const RADIO_MIN_STATION = 8;

interface Station {
  name: string;
  why: string;
  seeds: TrackSummary[];
  /** The artist's or playlist's own tracks, mixed in every third track. */
  own: TrackSummary[];
  /** A track radio starts with its own track. */
  first: TrackSummary | null;
}

async function station(
  db: Db,
  seed: RadioSeed,
  viewerId: string | null,
  popularity: Map<string, number>,
  humanOnly: boolean,
): Promise<Station> {
  const fairness = "Nobody can pay to be on it, and no AI label gets a boost.";
  if (seed.type === "track") {
    const [track] = [...(await liveSummaries(db, [seed.id], false)).values()];
    if (!track) throw new HttpError(404, "Track not found.");
    return {
      name: `${track.title} radio`,
      why: `Starts with ${quoted(track.title)}, then plays tracks streamed and liked by the same people, then more from the same artist and genre. ${fairness}`,
      seeds: [track],
      own: [],
      first: track,
    };
  }
  if (seed.type === "artist") {
    const [artist] = await db.select().from(artists).where(eq(artists.id, seed.id)).limit(1);
    if (!artist) throw new HttpError(404, "Artist not found.");
    const all = await artistTracks(db, artist.id, popularity, false);
    return {
      name: `${artist.name} radio`,
      why: `Mixes ${artist.name} with tracks streamed and liked by the same people, then music in the same genres. ${fairness}`,
      seeds: all.slice(0, 10),
      own: humanOnly ? all.filter((t) => t.aiLabel === "human") : all,
      first: null,
    };
  }
  const [playlist] = await db.select().from(playlists).where(eq(playlists.id, seed.id)).limit(1);
  if (!playlist || (!playlist.isPublic && playlist.ownerUserId !== viewerId)) {
    throw new HttpError(404, "Playlist not found.");
  }
  const entries = await db
    .select({ trackId: playlistEntries.trackId })
    .from(playlistEntries)
    .where(eq(playlistEntries.playlistId, playlist.id))
    .orderBy(asc(playlistEntries.position));
  const inPlaylist = [
    ...(await liveSummaries(db, [...new Set(entries.map((e) => e.trackId))].slice(0, 50), false)).values(),
  ];
  return {
    name: `${playlist.name} radio`,
    why: `Mixes tracks from ${quoted(playlist.name)} with tracks streamed and liked by the same people. ${fairness}`,
    seeds: inPlaylist,
    own: humanOnly ? inPlaylist.filter((t) => t.aiLabel === "human") : inPlaylist,
    first: null,
  };
}

/**
 * The next tracks for a radio station. `exclude` is what it has already played or lined up, oldest first, so
 * each batch brings new tracks. A small catalogue eventually runs out of new ones; then the station starts
 * again from the tracks it played longest ago, so it never ends.
 */
export async function radioBatch(
  db: Db,
  seed: RadioSeed,
  options: { exclude: string[]; limit?: number; humanOnly: boolean; viewerId: string | null },
): Promise<RadioBatch> {
  const limit = options.limit ?? RADIO_BATCH;
  const popularity = await recentPopularity(db);
  const s = await station(db, seed, options.viewerId, popularity, options.humanOnly);
  const ownIds = new Set(s.own.map((t) => t.id));
  // Radio stays with related music, going round again rather than drifting into whatever is popular. Only a
  // station with almost nothing related (a brand-new artist, say) is topped up with popular tracks.
  const similar = await similarTracks(db, s.seeds, {
    humanOnly: options.humanOnly,
    exclude: ownIds,
    viewerId: options.viewerId ?? undefined,
    popularity,
    limit: 60,
    fallback: "related",
  });
  if (similar.length + s.own.length < RADIO_MIN_STATION) {
    const exclude = new Set([...ownIds, ...s.seeds.map((t) => t.id), ...similar.map((r) => r.track.id)]);
    similar.push(...(await popularTracks(db, popularity, { humanOnly: options.humanOnly, exclude, limit: 20 })));
  }

  // The station's running order: its own track first (track radio), then every third track from the artist or
  // playlist, the rest similar tracks.
  const order: RecommendedTrack[] = [];
  if (s.first) order.push({ track: s.first, reason: "The track this radio started from" });
  const ownReason = seed.type === "artist" ? "From the artist this radio is based on" : "From the playlist";
  const own = s.own.map((track) => ({ track, reason: ownReason }));
  for (let o = 0, m = 0; o < own.length || m < similar.length;) {
    const ownTurn = (order.length % 3 === 0 && o < own.length) || m >= similar.length;
    order.push(ownTurn ? own[o++]! : similar[m++]!);
  }

  const played = options.exclude;
  const noRepeat = Math.min(RADIO_NO_REPEAT, Math.floor(played.length / 2));
  const recent = new Set(noRepeat ? played.slice(-noRepeat) : []);
  const already = new Set(played);
  const seen = new Set<string>();
  const unique = order.filter((r) => !seen.has(r.track.id) && Boolean(seen.add(r.track.id)));
  const fresh = unique.filter((r) => !already.has(r.track.id));
  if (fresh.length < limit) {
    // Out of new tracks: go round again, starting with what was played longest ago.
    const position = new Map(played.map((id, i) => [id, i]));
    const again = unique
      .filter((r) => already.has(r.track.id) && !recent.has(r.track.id))
      .sort((a, b) => position.get(a.track.id)! - position.get(b.track.id)!);
    fresh.push(...again);
  }

  return {
    seed,
    name: s.name,
    why: options.humanOnly ? `${s.why} ${HUMAN_ONLY_NOTE}` : s.why,
    humanOnly: options.humanOnly,
    tracks: fresh.slice(0, limit),
  };
}
