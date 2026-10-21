import { asc, eq } from "drizzle-orm";
import type { Db, Tx } from "./db/client";
import { offlineDevices, subscriptionPeriods } from "./db/schema";

/** For "Your data": when the account was subscribed, and the devices keeping its downloads. */
export async function offlineAccountData(db: Db, userId: string) {
  const [periods, devices] = await Promise.all([
    db
      .select({ startedAt: subscriptionPeriods.startedAt, endedAt: subscriptionPeriods.endedAt })
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.userId, userId))
      .orderBy(asc(subscriptionPeriods.startedAt)),
    db
      .select({
        name: offlineDevices.name,
        platform: offlineDevices.platform,
        lastChecked: offlineDevices.lastSyncAt,
        removedAt: offlineDevices.removedAt,
        createdAt: offlineDevices.createdAt,
      })
      .from(offlineDevices)
      .where(eq(offlineDevices.userId, userId)),
  ]);
  return { subscriptionHistory: periods, downloadDevices: devices };
}

/** Deleting an account: these are only about the person, so they go. */
export async function deleteOfflineAccountData(tx: Tx, userId: string): Promise<void> {
  await tx.delete(offlineDevices).where(eq(offlineDevices.userId, userId));
  await tx.delete(subscriptionPeriods).where(eq(subscriptionPeriods.userId, userId));
}
