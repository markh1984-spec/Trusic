import type { Strike } from "@trusic/client";
import { resolveAiScore } from "@trusic/core";
import { and, count, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "./db/client";
import { artists, ledgerEntries, strikes, tracks, users } from "./db/schema";
import { HttpError } from "./errors";
import { computeClawback, openPeriodsForTrack, runPayouts } from "./payout-service";

/** Strikes before an account is suspended. */
export const STRIKES_TO_SUSPEND = 3;

/** Apply a reviewer's score to a track. Review decisions override declaration and detection. */
export async function applyReviewScore(db: Db | Tx, trackId: string, reviewScore: number) {
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId)).limit(1);
  if (!track) throw new HttpError(404, "Track not found.");
  const resolution = resolveAiScore({ declaredScore: track.declaredScore, detection: track.detection, reviewScore });
  await db
    .update(tracks)
    .set({ reviewScore, aiScore: resolution.score, scoreSource: resolution.source, flagged: resolution.flagged })
    .where(eq(tracks.id, trackId));
}

export interface StrikeOutcome {
  strike: typeof strikes.$inferSelect;
  strikeCount: number;
  suspended: boolean;
}

/**
 * Record a proven false declaration: correct the track's score, claw back what
 * it over-earned in finalised months (owed from its payees' future earnings, and
 * paid to human music in the next payout run), recalculate open months, and
 * suspend the artist's account at the third strike.
 */
export async function issueStrike(
  db: Db,
  input: { trackId: string; correctedScore: number; reason: string; issuedByUserId: string; currency: string },
): Promise<StrikeOutcome> {
  const [track] = await db
    .select({ track: tracks, ownerUserId: artists.ownerUserId })
    .from(tracks)
    .innerJoin(artists, eq(artists.id, tracks.artistId))
    .where(eq(tracks.id, input.trackId))
    .limit(1);
  if (!track) throw new HttpError(404, "Track not found.");
  if (input.correctedScore <= track.track.declaredScore) {
    throw new HttpError(400, "A strike needs a corrected score higher than the artist declared.");
  }

  const clawback = await computeClawback(db, input.trackId, input.correctedScore);
  const months = clawback.months.map((m) => m.period).join(", ");
  const openPeriods = await openPeriodsForTrack(db, input.trackId);

  const outcome = await db.transaction(async (tx) => {
    await applyReviewScore(tx, input.trackId, input.correctedScore);
    const [strike] = await tx
      .insert(strikes)
      .values({
        userId: track.ownerUserId,
        trackId: input.trackId,
        reason: input.reason,
        declaredScore: track.track.declaredScore,
        correctedScore: input.correctedScore,
        clawbackTotal: clawback.total,
        issuedByUserId: input.issuedByUserId,
      })
      .returning();

    if (clawback.byPayee.size) {
      await tx.insert(ledgerEntries).values(
        [...clawback.byPayee].map(([userId, amount]) => ({
          userId,
          type: "clawback" as const,
          amount: -amount,
          strikeId: strike!.id,
          note: `"${track.track.title}" declared AI ${track.track.declaredScore}, corrected to ${input.correctedScore}${months ? ` (${months})` : ""}`,
        })),
      );
    }

    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(strikes)
      .where(eq(strikes.userId, track.ownerUserId));
    let suspended = false;
    if (n >= STRIKES_TO_SUSPEND) {
      suspended = true;
      await tx.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, track.ownerUserId));
      const owned = await tx.select({ id: artists.id }).from(artists).where(eq(artists.ownerUserId, track.ownerUserId));
      if (owned.length) {
        await tx
          .update(tracks)
          .set({ status: "suspended" })
          .where(
            and(
              inArray(
                tracks.artistId,
                owned.map((a) => a.id),
              ),
              eq(tracks.status, "live"),
            ),
          );
      }
    }
    return { strike: strike!, strikeCount: n, suspended };
  });

  // Months not yet finalised are simply recalculated with the corrected score.
  for (const period of openPeriods) await runPayouts(db, period, input.currency);
  return outcome;
}

/** Lift a suspension and put the artist's tracks back. Their strikes stay on record. */
export async function reinstate(db: Db, userId: string): Promise<void> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new HttpError(404, "Account not found.");
  await db.transaction(async (tx) => {
    await tx.update(users).set({ suspendedAt: null }).where(eq(users.id, userId));
    const owned = await tx.select({ id: artists.id }).from(artists).where(eq(artists.ownerUserId, userId));
    if (owned.length) {
      await tx
        .update(tracks)
        .set({ status: "live" })
        .where(
          and(
            inArray(
              tracks.artistId,
              owned.map((a) => a.id),
            ),
            eq(tracks.status, "suspended"),
          ),
        );
    }
  });
}

export async function loadStrikes(db: Db, where: { userId?: string } = {}) {
  const rows = await db
    .select({
      strike: strikes,
      trackTitle: tracks.title,
      artistId: artists.id,
      artistName: artists.name,
      artistSlug: artists.slug,
      email: users.email,
      displayName: users.displayName,
    })
    .from(strikes)
    .innerJoin(tracks, eq(tracks.id, strikes.trackId))
    .innerJoin(artists, eq(artists.id, tracks.artistId))
    .innerJoin(users, eq(users.id, strikes.userId))
    .where(where.userId ? eq(strikes.userId, where.userId) : undefined)
    .orderBy(strikes.createdAt);
  return rows.map((r) => ({
    strike: toStrike(r.strike, r.trackTitle),
    artist: { id: r.artistId, name: r.artistName, slug: r.artistSlug },
    user: { id: r.strike.userId, email: r.email, displayName: r.displayName },
  }));
}

export function toStrike(s: typeof strikes.$inferSelect, trackTitle: string): Strike {
  return {
    id: s.id,
    trackId: s.trackId,
    trackTitle,
    reason: s.reason,
    declaredScore: s.declaredScore,
    correctedScore: s.correctedScore,
    clawbackTotal: s.clawbackTotal,
    appliedInPeriod: s.appliedInPeriod,
    createdAt: s.createdAt.toISOString(),
  };
}
