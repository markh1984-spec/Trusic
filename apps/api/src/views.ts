import { aiLabel, payoutRatePercent, scoreDeclaration } from "@trusic/core";
import type { Appeal, Artist, TrackDetail, TrackSummary, User } from "@trusic/client";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import { appeals, artists, tracks, users } from "./db/schema";

const trackSummaryColumns = {
  id: tracks.id,
  title: tracks.title,
  genre: tracks.genre,
  durationMs: tracks.durationMs,
  aiScore: tracks.aiScore,
  scoreSource: tracks.scoreSource,
  flagged: tracks.flagged,
  createdAt: tracks.createdAt,
  artistId: artists.id,
  artistName: artists.name,
  artistSlug: artists.slug,
};

/** Tracks joined to their artist, ready for `toTrackSummary`. Add your own where/order. */
export function selectTrackSummaries(db: Db) {
  return db.select(trackSummaryColumns).from(tracks).innerJoin(artists, eq(artists.id, tracks.artistId));
}

interface TrackSummaryRow {
  id: string;
  title: string;
  genre: string | null;
  durationMs: number;
  aiScore: number;
  scoreSource: TrackSummary["scoreSource"];
  flagged: boolean;
  createdAt: Date;
  artistId: string;
  artistName: string;
  artistSlug: string;
}

export function toTrackSummary(row: TrackSummaryRow): TrackSummary {
  return {
    id: row.id,
    title: row.title,
    genre: row.genre,
    durationMs: row.durationMs,
    artist: { id: row.artistId, name: row.artistName, slug: row.artistSlug },
    aiScore: row.aiScore,
    aiLabel: aiLabel(row.aiScore),
    payoutRatePercent: payoutRatePercent(row.aiScore),
    scoreSource: row.scoreSource,
    flagged: row.flagged,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Summaries for the given track ids, including removed tracks (statements still name them). */
export async function loadTrackSummaries(db: Db, ids: string[]): Promise<Map<string, TrackSummary>> {
  if (ids.length === 0) return new Map();
  const rows = await selectTrackSummaries(db).where(inArray(tracks.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, toTrackSummary(r)]));
}

export async function loadTrackDetail(
  db: Db,
  trackId: string,
  viewer: { id: string; isAdmin: boolean } | null,
): Promise<TrackDetail | null> {
  const [row] = await db
    .select({ ...trackSummaryColumns, track: tracks, ownerUserId: artists.ownerUserId })
    .from(tracks)
    .innerJoin(artists, eq(artists.id, tracks.artistId))
    .where(eq(tracks.id, trackId))
    .limit(1);
  if (!row) return null;

  const isOwner = viewer?.id === row.ownerUserId;
  if (row.track.status === "removed" && !isOwner && !viewer?.isAdmin) return null;

  let appeal: Appeal | null = null;
  if (isOwner || viewer?.isAdmin) {
    const [latest] = await db
      .select()
      .from(appeals)
      .where(eq(appeals.trackId, trackId))
      .orderBy(desc(appeals.createdAt))
      .limit(1);
    appeal = latest ? toAppeal(latest) : null;
  }

  const t = row.track;
  return {
    ...toTrackSummary(row),
    declaration: t.declaration,
    declaredScore: t.declaredScore,
    breakdown: scoreDeclaration(t.declaration),
    detection: t.detection
      ? {
          detector: t.detection.detector,
          verdict: t.detection.verdict,
          confidence: t.detection.confidence,
          evidence: t.detection.evidence,
        }
      : null,
    reviewScore: t.reviewScore,
    appeal,
    isOwner,
  };
}

export function toAppeal(a: typeof appeals.$inferSelect): Appeal {
  return {
    id: a.id,
    trackId: a.trackId,
    message: a.message,
    status: a.status,
    resolvedScore: a.resolvedScore,
    resolutionNote: a.resolutionNote,
    createdAt: a.createdAt.toISOString(),
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
  };
}

export function toArtist(a: typeof artists.$inferSelect): Artist {
  return { id: a.id, name: a.name, slug: a.slug, bio: a.bio, createdAt: a.createdAt.toISOString() };
}

export function toUser(u: Pick<typeof users.$inferSelect, "id" | "email" | "displayName" | "isAdmin" | "plan">): User {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    isAdmin: u.isAdmin,
    plan: u.plan === "premium" ? "premium" : "free",
  };
}

export async function isArtistOwner(db: Db, artistId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: artists.id })
    .from(artists)
    .where(and(eq(artists.id, artistId), eq(artists.ownerUserId, userId)))
    .limit(1);
  return Boolean(row);
}
