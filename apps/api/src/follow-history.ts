import type { Db, Tx } from "./db/client";
import { followEvents } from "./db/schema";

/**
 * Note follows and unfollows as they happen, so artists' stats can show followers lost as well as gained (see
 * stats-service.ts). Only real changes are passed in: following an artist twice is still one follow.
 */
export async function recordFollowChanges(
  db: Db | Tx,
  kind: "follow" | "unfollow",
  artistIds: string[],
  at?: Date,
): Promise<void> {
  if (artistIds.length === 0) return;
  await db
    .insert(followEvents)
    .values(artistIds.map((artistId) => ({ artistId, kind, ...(at ? { createdAt: at } : {}) })));
}
