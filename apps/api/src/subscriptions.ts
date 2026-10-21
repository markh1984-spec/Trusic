import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db, Tx } from "./db/client";
import { subscriptionPeriods, users } from "./db/schema";

/**
 * When each listener was subscribed. `users.plan` says whether someone is
 * subscribed now; this remembers since when, so plays that reach us late (from
 * offline listening) can be checked against the time they were played.
 *
 * Call `recordPlanChange` whenever a plan changes.
 */
export async function recordPlanChange(
  db: Db | Tx,
  userId: string,
  plan: "free" | "premium",
  at = new Date(),
): Promise<void> {
  const [open] = await db
    .select({ id: subscriptionPeriods.id })
    .from(subscriptionPeriods)
    .where(and(eq(subscriptionPeriods.userId, userId), isNull(subscriptionPeriods.endedAt)))
    .limit(1);
  if (plan === "premium" && !open) {
    await db.insert(subscriptionPeriods).values({ userId, startedAt: at });
  } else if (plan !== "premium" && open) {
    await db
      .update(subscriptionPeriods)
      .set({ endedAt: at })
      .where(and(eq(subscriptionPeriods.userId, userId), isNull(subscriptionPeriods.endedAt)));
  }
}

/** Was the listener subscribed at this moment? */
export type SubscribedAt = (time: Date) => boolean;

/**
 * A listener's subscription history. It's brought in line with their current
 * plan first, for plans set some other way (the demo seed, or accounts from
 * before history was kept): a subscriber with no history at all counts as
 * subscribed since their account was created.
 */
export async function subscriptionHistory(db: Db, user: { id: string; plan: string }): Promise<SubscribedAt> {
  const periods = await db
    .select({ startedAt: subscriptionPeriods.startedAt, endedAt: subscriptionPeriods.endedAt })
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.userId, user.id))
    .orderBy(asc(subscriptionPeriods.startedAt));
  const open = periods.find((p) => p.endedAt === null);
  const now = new Date();

  if (user.plan === "premium" && !open) {
    let startedAt = now;
    if (periods.length === 0) {
      const [row] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, user.id)).limit(1);
      startedAt = row?.createdAt ?? now;
    }
    await recordPlanChange(db, user.id, "premium", startedAt);
    periods.push({ startedAt, endedAt: null });
  } else if (user.plan !== "premium" && open) {
    await recordPlanChange(db, user.id, "free", now);
    open.endedAt = now;
  }

  return (time) => periods.some((p) => p.startedAt <= time && (p.endedAt === null || time < p.endedAt));
}
