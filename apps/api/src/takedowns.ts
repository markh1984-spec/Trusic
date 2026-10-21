import type { CopyrightStrike, ReportTarget, ReportTargetType } from "@trusic/client";
import { and, count, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import type { Db, Tx } from "./db/client";
import {
  artists,
  copyrightStrikes,
  playlists,
  releases,
  reports,
  tracks,
  users,
  type TakedownRecord,
  type TrackStatus,
} from "./db/schema";
import { HttpError } from "./errors";
import { openPeriods, runPayouts } from "./payout-service";
import { STRIKES_TO_SUSPEND, suspendAccount } from "./strikes";
import { imageUrl } from "./uploads";

/** Upheld copyright takedowns (not withdrawn) before an account is suspended: the same three as for AI strikes. */
export const COPYRIGHT_STRIKES_TO_SUSPEND = STRIKES_TO_SUSPEND;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_NAME = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;

export interface ResolvedTarget extends ReportTarget {
  ownerUserId: string | null;
  /** "gone" covers anything removed by its owner, suspended, or deleted. */
  state: "live" | "taken_down" | "gone";
  /** Private playlists can only be seen, and so reported, by their owner. */
  visibleTo: "everyone" | "owner";
}

const imageName = (key: string | null) => (key ? key.replace(/^images\//, "") : null);
const artworkOf = (key: string | null) => {
  const name = imageName(key);
  return name ? { name, url: imageUrl(key)! } : null;
};

const RELEASE_TYPES = { album: "Album", ep: "EP", single: "Single" } as const;

/**
 * Find what a report points at, whatever state it's in. Artists can be given by id or slug; artwork by its image's
 * file name, wherever it's used.
 */
export async function resolveTarget(db: Db | Tx, type: ReportTargetType, id: string): Promise<ResolvedTarget | null> {
  switch (type) {
    case "track": {
      if (!UUID.test(id)) return null;
      const [row] = await db
        .select({
          track: tracks,
          artistName: artists.name,
          ownerUserId: artists.ownerUserId,
          artworkKey: releases.artworkKey,
        })
        .from(tracks)
        .innerJoin(artists, eq(artists.id, tracks.artistId))
        .leftJoin(releases, eq(releases.id, tracks.releaseId))
        .where(eq(tracks.id, id))
        .limit(1);
      if (!row) return null;
      const status = row.track.status;
      return {
        type,
        id,
        title: `${row.track.title} by ${row.artistName}`,
        description: `Track by ${row.artistName}`,
        path: `/track/${id}`,
        artwork: artworkOf(row.artworkKey),
        ownerUserId: row.ownerUserId,
        state: status === "live" ? "live" : status === "taken_down" ? "taken_down" : "gone",
        visibleTo: "everyone",
      };
    }
    case "release": {
      if (!UUID.test(id)) return null;
      const [row] = await db
        .select({ release: releases, artistName: artists.name, ownerUserId: artists.ownerUserId })
        .from(releases)
        .innerJoin(artists, eq(artists.id, releases.artistId))
        .where(eq(releases.id, id))
        .limit(1);
      if (!row) return null;
      const typeName = RELEASE_TYPES[row.release.type];
      return {
        type,
        id,
        title: `${row.release.title} (${typeName.toLowerCase()}) by ${row.artistName}`,
        description: `${typeName} by ${row.artistName}`,
        path: `/release/${id}`,
        artwork: artworkOf(row.release.artworkKey),
        ownerUserId: row.ownerUserId,
        state: row.release.takenDownAt ? "taken_down" : "live",
        visibleTo: "everyone",
      };
    }
    case "artist": {
      const [row] = await db
        .select({ artist: artists, ownerDeletedAt: users.deletedAt })
        .from(artists)
        .innerJoin(users, eq(users.id, artists.ownerUserId))
        .where(UUID.test(id) ? eq(artists.id, id) : eq(artists.slug, id))
        .limit(1);
      if (!row) return null;
      return {
        type,
        id: row.artist.id,
        title: row.artist.name,
        description: "Artist",
        path: `/artist/${row.artist.slug}`,
        artwork: artworkOf(row.artist.imageKey),
        ownerUserId: row.artist.ownerUserId,
        state: row.ownerDeletedAt ? "gone" : row.artist.takenDownAt ? "taken_down" : "live",
        visibleTo: "everyone",
      };
    }
    case "playlist": {
      if (!UUID.test(id)) return null;
      const [row] = await db
        .select({ playlist: playlists, ownerName: users.displayName })
        .from(playlists)
        .innerJoin(users, eq(users.id, playlists.ownerUserId))
        .where(eq(playlists.id, id))
        .limit(1);
      if (!row) return null;
      return {
        type,
        id,
        title: `${row.playlist.name} (playlist by ${row.ownerName})`,
        description: `Playlist by ${row.ownerName}`,
        path: `/playlist/${id}`,
        artwork: null,
        ownerUserId: row.playlist.ownerUserId,
        state: row.playlist.takenDownAt ? "taken_down" : "live",
        visibleTo: row.playlist.isPublic ? "everyone" : "owner",
      };
    }
    case "artwork": {
      if (!IMAGE_NAME.test(id)) return null;
      const key = `images/${id}`;
      const artwork = { name: id, url: imageUrl(key)! };
      const [onRelease] = await db
        .select({ release: releases, artistName: artists.name, ownerUserId: artists.ownerUserId })
        .from(releases)
        .innerJoin(artists, eq(artists.id, releases.artistId))
        .where(eq(releases.artworkKey, key))
        .limit(1);
      if (onRelease) {
        return {
          type,
          id,
          title: `Artwork for ${onRelease.release.title} by ${onRelease.artistName}`,
          description: `Artwork for ${onRelease.release.title}`,
          path: `/release/${onRelease.release.id}`,
          artwork,
          ownerUserId: onRelease.ownerUserId,
          state: onRelease.release.takenDownAt ? "taken_down" : "live",
          visibleTo: "everyone",
        };
      }
      const [onArtist] = await db.select().from(artists).where(eq(artists.imageKey, key)).limit(1);
      if (onArtist) {
        return {
          type,
          id,
          title: `Photo of ${onArtist.name}`,
          description: `Photo of ${onArtist.name}`,
          path: `/artist/${onArtist.slug}`,
          artwork,
          ownerUserId: onArtist.ownerUserId,
          state: onArtist.takenDownAt ? "taken_down" : "live",
          visibleTo: "everyone",
        };
      }
      // Not shown anywhere: either taken down (the takedown record knows where it was) or replaced.
      const [down] = await db
        .select({ ownerUserId: reports.ownerUserId, title: reports.targetTitle })
        .from(reports)
        .where(and(eq(reports.targetType, "artwork"), eq(reports.targetId, id), eq(reports.status, "taken_down")))
        .limit(1);
      return {
        type,
        id,
        title: down?.title ?? "Artwork no longer in use",
        description: "Artwork",
        path: null,
        artwork,
        ownerUserId: down?.ownerUserId ?? null,
        state: down ? "taken_down" : "gone",
        visibleTo: "everyone",
      };
    }
  }
}

const emptyRecord = (): TakedownRecord => ({ tracks: [], releaseIds: [], artistIds: [], playlistIds: [], images: [] });

const alreadyDown = () => new HttpError(409, "That's already taken down, or no longer on Trusic.");

/**
 * Take something down, recording exactly what changed so it can be put back. A release or artist takes its tracks
 * down with it; artwork is taken off every release or profile that shows it.
 */
export async function takeDown(tx: Tx, type: ReportTargetType, id: string): Promise<TakedownRecord> {
  const record = emptyRecord();
  const now = new Date();

  const downTracks = async (where: SQL) => {
    const rows = await tx
      .select({ id: tracks.id, status: tracks.status })
      .from(tracks)
      .where(and(where, ne(tracks.status, "taken_down")));
    if (!rows.length) return;
    await tx
      .update(tracks)
      .set({ status: "taken_down" })
      .where(
        inArray(
          tracks.id,
          rows.map((r) => r.id),
        ),
      );
    record.tracks.push(...rows.map((r) => ({ id: r.id, previousStatus: r.status })));
  };

  switch (type) {
    case "track":
      await downTracks(eq(tracks.id, id));
      if (!record.tracks.length) throw alreadyDown();
      break;
    case "release": {
      const done = await tx
        .update(releases)
        .set({ takenDownAt: now })
        .where(and(eq(releases.id, id), isNull(releases.takenDownAt)))
        .returning({ id: releases.id });
      if (!done.length) throw alreadyDown();
      record.releaseIds.push(id);
      await downTracks(eq(tracks.releaseId, id));
      break;
    }
    case "artist": {
      const done = await tx
        .update(artists)
        .set({ takenDownAt: now })
        .where(and(eq(artists.id, id), isNull(artists.takenDownAt)))
        .returning({ id: artists.id });
      if (!done.length) throw alreadyDown();
      record.artistIds.push(id);
      const rels = await tx
        .update(releases)
        .set({ takenDownAt: now })
        .where(and(eq(releases.artistId, id), isNull(releases.takenDownAt)))
        .returning({ id: releases.id });
      record.releaseIds.push(...rels.map((r) => r.id));
      await downTracks(eq(tracks.artistId, id));
      break;
    }
    case "playlist": {
      const done = await tx
        .update(playlists)
        .set({ takenDownAt: now })
        .where(and(eq(playlists.id, id), isNull(playlists.takenDownAt)))
        .returning({ id: playlists.id });
      if (!done.length) throw alreadyDown();
      record.playlistIds.push(id);
      break;
    }
    case "artwork": {
      const key = `images/${id}`;
      const rels = await tx
        .update(releases)
        .set({ artworkKey: null })
        .where(eq(releases.artworkKey, key))
        .returning({ id: releases.id });
      const arts = await tx
        .update(artists)
        .set({ imageKey: null })
        .where(eq(artists.imageKey, key))
        .returning({ id: artists.id });
      record.images.push(
        ...rels.map((r) => ({ on: "release" as const, id: r.id, key })),
        ...arts.map((a) => ({ on: "artist" as const, id: a.id, key })),
      );
      if (!record.images.length) throw alreadyDown();
      break;
    }
  }
  return record;
}

/**
 * Put back what a takedown changed. Tracks return to how they were, except that a suspended owner's tracks stay
 * hidden until they're reinstated, and a deleted owner's stay removed. Artwork the owner has replaced since stays
 * replaced.
 */
export async function restore(tx: Tx, record: TakedownRecord, ownerUserId: string | null): Promise<void> {
  const [owner] = ownerUserId
    ? await tx
        .select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, ownerUserId))
        .limit(1)
    : [];
  const statusFor = (previous: TrackStatus): TrackStatus => {
    if (owner?.deletedAt || previous === "removed") return "removed";
    return owner?.suspendedAt ? "suspended" : "live";
  };
  for (const t of record.tracks) {
    await tx
      .update(tracks)
      .set({ status: statusFor(t.previousStatus) })
      .where(and(eq(tracks.id, t.id), eq(tracks.status, "taken_down")));
  }
  if (record.releaseIds.length) {
    await tx.update(releases).set({ takenDownAt: null }).where(inArray(releases.id, record.releaseIds));
  }
  if (record.artistIds.length) {
    await tx.update(artists).set({ takenDownAt: null }).where(inArray(artists.id, record.artistIds));
  }
  if (record.playlistIds.length) {
    await tx.update(playlists).set({ takenDownAt: null }).where(inArray(playlists.id, record.playlistIds));
  }
  for (const image of record.images) {
    if (image.on === "release") {
      await tx
        .update(releases)
        .set({ artworkKey: image.key })
        .where(and(eq(releases.id, image.id), isNull(releases.artworkKey)));
    } else {
      await tx
        .update(artists)
        .set({ imageKey: image.key })
        .where(and(eq(artists.id, image.id), isNull(artists.imageKey)));
    }
  }
}

/** Copyright strikes that still count. */
export async function activeCopyrightStrikes(db: Db | Tx, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(copyrightStrikes)
    .where(and(eq(copyrightStrikes.userId, userId), isNull(copyrightStrikes.withdrawnAt)));
  return row?.n ?? 0;
}

/** Record an upheld copyright takedown against the uploader, suspending them at the third. */
export async function issueCopyrightStrike(
  tx: Tx,
  input: { userId: string; reportId: string; targetTitle: string; reason: string; issuedByUserId: string },
): Promise<{ count: number; suspended: boolean }> {
  await tx.insert(copyrightStrikes).values(input);
  const n = await activeCopyrightStrikes(tx, input.userId);
  const [user] = await tx.select({ suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, input.userId));
  let suspended = Boolean(user?.suspendedAt);
  if (n >= COPYRIGHT_STRIKES_TO_SUSPEND && !suspended) {
    await suspendAccount(tx, input.userId);
    suspended = true;
  }
  return { count: n, suspended };
}

/** Withdraw the strike a takedown gave, when the content is put back. The account stays suspended until reinstated. */
export async function withdrawCopyrightStrike(tx: Tx, reportId: string): Promise<void> {
  await tx
    .update(copyrightStrikes)
    .set({ withdrawnAt: new Date() })
    .where(and(eq(copyrightStrikes.reportId, reportId), isNull(copyrightStrikes.withdrawnAt)));
}

export function toCopyrightStrike(s: typeof copyrightStrikes.$inferSelect): CopyrightStrike {
  return {
    id: s.id,
    reportId: s.reportId,
    targetTitle: s.targetTitle,
    reason: s.reason,
    withdrawn: s.withdrawnAt !== null,
    createdAt: s.createdAt.toISOString(),
  };
}

/** Recalculate months not yet finalised, after a takedown or restore changes which tracks can earn. */
export async function recalculateOpenMonths(db: Db, currency: string): Promise<void> {
  for (const period of await openPeriods(db)) await runPayouts(db, period, currency);
}
