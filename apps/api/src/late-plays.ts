import { DEFAULT_PAYOUT_CONFIG } from "@trusic/core";
import { and, count, eq, gte, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "./db/client";
import { payoutRuns, plays } from "./db/schema";

/**
 * Which payout month a play counts in.
 *
 * Plays reported straight after listening (no client play id) count in the month
 * they were played, as they always have.
 *
 * Plays from the apps' play queue (with a client play id) can arrive up to 30
 * days late, after listening offline. They're given a month when payouts are
 * calculated, and keep it:
 *
 * - Played in the month being calculated: they count in it.
 * - Played in an earlier month that's already finalised: they count in the
 *   month being calculated, paid from the listener's money for that month.
 *   Finalised months never change.
 * - Played in an earlier month that isn't finalised yet: they wait for it.
 *
 * So a finalised month always contains exactly the plays it was calculated
 * with, even if more of its plays arrive between calculating and finalising:
 * those go to the next month calculated. That keeps clawbacks exact.
 */
export async function assignPlaysToPeriod(db: Db, period: string, [start, end]: [Date, Date]): Promise<void> {
  const playedMonth = sql<string>`to_char(${plays.playedAt} at time zone 'UTC', 'YYYY-MM')`;
  const finalisedMonths = db
    .select({ period: payoutRuns.period })
    .from(payoutRuns)
    .where(isNotNull(payoutRuns.finalizedAt));
  await db
    .update(plays)
    .set({ countedInPeriod: period })
    .where(
      and(
        isNull(plays.countedInPeriod),
        isNotNull(plays.clientPlayId),
        gte(plays.msPlayed, DEFAULT_PAYOUT_CONFIG.minStreamMs),
        lt(plays.playedAt, end),
        or(gte(plays.playedAt, start), inArray(playedMonth, finalisedMonths)),
      ),
    );
}

/** The plays that count in a month's payouts (see `assignPlaysToPeriod`). */
export function playsCountedIn(period: string, [start, end]: [Date, Date]): SQL {
  return or(
    and(isNull(plays.clientPlayId), gte(plays.playedAt, start), lt(plays.playedAt, end)),
    eq(plays.countedInPeriod, period),
  )!;
}

/** For a listener's statements: streams counted in each month that were played in an earlier one. */
export async function lateStreamsByPeriod(db: Db, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ period: plays.countedInPeriod, streams: count() })
    .from(plays)
    .where(
      and(
        eq(plays.userId, userId),
        isNotNull(plays.countedInPeriod),
        gte(plays.msPlayed, DEFAULT_PAYOUT_CONFIG.minStreamMs),
        sql`to_char(${plays.playedAt} at time zone 'UTC', 'YYYY-MM') < ${plays.countedInPeriod}`,
      ),
    )
    .groupBy(plays.countedInPeriod);
  return new Map(rows.map((r) => [r.period!, r.streams]));
}
