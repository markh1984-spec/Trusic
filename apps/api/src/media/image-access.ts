import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { artists, releases, reports, users } from "../db/schema";

export interface ImageAccess {
  /** Shown on something anyone can see. */
  public: boolean;
  /** Who else may see it: the accounts whose release or profile it belongs to. Admins always may. */
  ownerUserIds: string[];
}

/** Hidden after a report, or its owner deleted their account. */
const hidden = (takenDownAt: typeof releases.takenDownAt | typeof artists.takenDownAt) =>
  sql<boolean>`(${takenDownAt} is not null or ${artists.takenDownAt} is not null or ${users.deletedAt} is not null)`;

/**
 * Who can see an uploaded image ("images/<uuid>.png"). Artwork and photos are public while a release or artist
 * profile that anyone can see shows them. Otherwise (taken down after a report, on its own or with its release or
 * artist, a deleted account's, or no longer used) only their owner and admins can, so an old address stops working.
 * A track has no picture of its own: it shows its release's, which stays public while the release does.
 */
export async function imageAccess(db: Db, key: string): Promise<ImageAccess> {
  const [onReleases, onArtists] = await Promise.all([
    db
      .select({ ownerUserId: artists.ownerUserId, hidden: hidden(releases.takenDownAt) })
      .from(releases)
      .innerJoin(artists, eq(artists.id, releases.artistId))
      .innerJoin(users, eq(users.id, artists.ownerUserId))
      .where(eq(releases.artworkKey, key)),
    db
      .select({ ownerUserId: artists.ownerUserId, hidden: hidden(artists.takenDownAt) })
      .from(artists)
      .innerJoin(users, eq(users.id, artists.ownerUserId))
      .where(eq(artists.imageKey, key)),
  ]);
  const uses = [...onReleases, ...onArtists];
  if (uses.some((u) => !u.hidden)) return { public: true, ownerUserIds: [] };

  // Artwork taken down on its own is on no release or profile any more; its takedown remembers whose it was.
  const name = key.replace(/^images\//, "");
  const takenDown = await db
    .select({ ownerUserId: reports.ownerUserId })
    .from(reports)
    .where(
      and(
        eq(reports.targetType, "artwork"),
        eq(reports.targetId, name),
        isNotNull(reports.takedown),
        or(eq(reports.status, "taken_down"), eq(reports.status, "counter_notice")),
      ),
    );
  const owners = [...uses.map((u) => u.ownerUserId), ...takenDown.flatMap((r) => r.ownerUserId ?? [])];
  return { public: false, ownerUserIds: [...new Set(owners)] };
}
