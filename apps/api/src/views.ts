import { aiLabel, payoutRatePercent, scoreDeclaration } from "@trusic/core";
import type { Appeal, Artist, ReleaseSummary, TrackDetail, TrackSummary, User } from "@trusic/client";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/pg-core";
import type { Db } from "./db/client";
import { appeals, artists, releases, tracks, users } from "./db/schema";
import { publicCredits } from "./credits";
import { imageUrl } from "./uploads";

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
  trackNumber: tracks.trackNumber,
  releaseId: releases.id,
  releaseTitle: releases.title,
  releaseArtworkKey: releases.artworkKey,
};

/** Tracks joined to their artist and release, ready for `toTrackSummary`. Add your own where/order. */
export function selectTrackSummaries(db: Db) {
  return db
    .select(trackSummaryColumns)
    .from(tracks)
    .innerJoin(artists, eq(artists.id, tracks.artistId))
    .leftJoin(releases, eq(releases.id, tracks.releaseId));
}

/** `selectTrackSummaries` plus extra columns, for queries that need more than the summary. */
export function selectTrackSummariesWith<T extends SelectedFields>(db: Db, extra: T) {
  return db
    .select({ ...trackSummaryColumns, ...extra })
    .from(tracks)
    .innerJoin(artists, eq(artists.id, tracks.artistId))
    .leftJoin(releases, eq(releases.id, tracks.releaseId));
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
  trackNumber: number | null;
  releaseId: string | null;
  releaseTitle: string | null;
  releaseArtworkKey: string | null;
}

export function toTrackSummary(row: TrackSummaryRow): TrackSummary {
  return {
    id: row.id,
    title: row.title,
    genre: row.genre,
    durationMs: row.durationMs,
    artist: { id: row.artistId, name: row.artistName, slug: row.artistSlug },
    release: row.releaseId ? { id: row.releaseId, title: row.releaseTitle! } : null,
    trackNumber: row.releaseId ? row.trackNumber : null,
    artworkUrl: imageUrl(row.releaseArtworkKey),
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
  const [row] = await selectTrackSummariesWith(db, { track: tracks, ownerUserId: artists.ownerUserId })
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
    credits: isOwner || viewer?.isAdmin ? t.credits : publicCredits(t.credits),
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
  return {
    id: a.id,
    name: a.name,
    slug: a.slug,
    bio: a.bio,
    imageUrl: imageUrl(a.imageKey),
    createdAt: a.createdAt.toISOString(),
  };
}

/** Release summaries with live-track counts by AI label, newest release first. */
export async function loadReleaseSummaries(
  db: Db,
  where: { artistId?: string; ids?: string[]; withTracks?: boolean; limit?: number },
) {
  const conditions = [
    where.artistId ? eq(releases.artistId, where.artistId) : undefined,
    where.ids ? inArray(releases.id, where.ids) : undefined,
    where.withTracks
      ? sql`exists (select 1 from ${tracks} where ${tracks.releaseId} = ${releases.id} and ${tracks.status} = 'live')`
      : undefined,
  ].filter(Boolean);
  if (where.ids?.length === 0) return [];
  const rows = await db
    .select({ release: releases, artistName: artists.name, artistSlug: artists.slug })
    .from(releases)
    .innerJoin(artists, eq(artists.id, releases.artistId))
    .where(and(...conditions))
    .orderBy(sql`${releases.releaseDate} desc nulls last`, desc(releases.createdAt))
    .limit(where.limit ?? 1000);
  if (rows.length === 0) return [];

  const trackRows = await db
    .select({ releaseId: tracks.releaseId, aiScore: tracks.aiScore })
    .from(tracks)
    .where(
      and(
        inArray(
          tracks.releaseId,
          rows.map((r) => r.release.id),
        ),
        eq(tracks.status, "live"),
      ),
    );
  const labels = new Map<string, ReleaseSummary["aiLabels"]>();
  for (const t of trackRows) {
    const counts = labels.get(t.releaseId!) ?? { human: 0, ai_assisted: 0, ai_generated: 0 };
    counts[aiLabel(t.aiScore)] += 1;
    labels.set(t.releaseId!, counts);
  }

  return rows.map(({ release: r, artistName, artistSlug }): ReleaseSummary => {
    const counts = labels.get(r.id) ?? { human: 0, ai_assisted: 0, ai_generated: 0 };
    return {
      id: r.id,
      title: r.title,
      type: r.type,
      releaseDate: r.releaseDate,
      artworkUrl: imageUrl(r.artworkKey),
      artist: { id: r.artistId, name: artistName, slug: artistSlug },
      trackCount: counts.human + counts.ai_assisted + counts.ai_generated,
      aiLabels: counts,
    };
  });
}

export function toUser(
  u: Pick<typeof users.$inferSelect, "id" | "email" | "displayName" | "isAdmin" | "plan" | "suspendedAt">,
): User {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    isAdmin: u.isAdmin,
    plan: u.plan === "premium" ? "premium" : "free",
    suspended: u.suspendedAt !== null,
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
