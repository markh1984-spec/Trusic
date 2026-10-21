import type {
  DownloadAuthorization,
  OfflineCollection,
  OfflineCollectionRef,
  OfflineSync,
  PlayBatchResult,
  PlayReportResult,
  TrackSummary,
} from "@trusic/client";
import { DAY_MS, DEFAULT_PAYOUT_CONFIG, MAX_PLAY_AGE_DAYS, OFFLINE_RECHECK_DAYS } from "@trusic/core";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireUser, type AuthUser } from "../auth";
import type { Db } from "../db/client";
import { likes, offlineDevices, plays, tracks } from "../db/schema";
import { HttpError } from "../errors";
import { subscriptionHistory } from "../subscriptions";
import { selectTrackSummaries, toTrackSummary } from "../views";
import { signStream } from "./listening";
import { loadPlaylistDetail } from "./playlists";
import { loadReleaseDetail } from "./releases";

/** Up to this many phones and computers can keep downloads for one account, as on Spotify. */
export const MAX_OFFLINE_DEVICES = 5;
/** A sanity bound on one device's downloads, well above any real library. (There's no product limit yet.) */
const MAX_DOWNLOADED_TRACKS = 50_000;
/** Download links last long enough to finish a big download on a slow connection. */
const DOWNLOAD_URL_TTL_SECONDS = 24 * 60 * 60;
/** A play can't be longer than its track (a little slack for clock jitter). */
const PLAY_SLACK_MS = 2_000;

const PlayBatch = z.object({
  plays: z
    .array(
      z.object({
        id: z.uuid(),
        trackId: z.uuid(),
        playedAt: z.iso.datetime({ offset: true }),
        msPlayed: z.number().int().min(0).max(DAY_MS),
      }),
    )
    .min(1)
    .max(200),
});

const DeviceId = z.string().trim().min(8).max(100);

const SyncBody = z.object({
  device: z.object({
    id: DeviceId,
    name: z.string().trim().min(1).max(100),
    platform: z.enum(["ios", "android", "web", "desktop"]),
  }),
  collections: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.enum(["release", "playlist"]), id: z.uuid() }),
        z.object({ type: z.literal("liked") }),
      ]),
    )
    .max(500),
  trackIds: z.array(z.uuid()).max(MAX_DOWNLOADED_TRACKS),
});

const DownloadBody = z.object({ deviceId: DeviceId, trackIds: z.array(z.uuid()).min(1).max(100) });

const chunk = <T>(items: T[], size = 1000): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/**
 * Listening without signal, in the phone and desktop apps.
 *
 * - The apps queue every listen with an id they make up and send them in
 *   batches when they're online. Sending a play again never counts it twice.
 * - Subscribers keep releases, playlists and liked songs downloaded on up to
 *   five devices. Each device checks in at least every 30 days to keep playing
 *   them, and learns which tracks have been taken down.
 */
export const offlineRoutes =
  ({ db, config }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    /**
     * A batch of plays from an app's play queue. A play counts if the listener was
     * subscribed when they played it, it was played in the last 30 days and the
     * track is still up. The same id sent again (a retry, or a listen reported
     * early and then again when it ended) updates the one play: it never adds one.
     */
    app.post("/plays/batch", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) => {
      const user = await requireUser(db, request);
      const body = PlayBatch.parse(request.body);
      const now = new Date();
      const oldest = new Date(now.getTime() - MAX_PLAY_AGE_DAYS * DAY_MS);

      // The same play twice in one batch: keep the longest report.
      const reports = new Map<string, (typeof body.plays)[number]>();
      for (const p of body.plays) {
        const seen = reports.get(p.id);
        if (!seen || p.msPlayed > seen.msPlayed) reports.set(p.id, p);
      }
      const ids = [...reports.keys()];

      const [known, trackRows, subscribedAt] = await Promise.all([
        db
          .select({ clientPlayId: plays.clientPlayId, trackId: plays.trackId, msPlayed: plays.msPlayed })
          .from(plays)
          .where(and(eq(plays.userId, user.id), inArray(plays.clientPlayId, ids))),
        db
          .select({ id: tracks.id, durationMs: tracks.durationMs, aiScore: tracks.aiScore, status: tracks.status })
          .from(tracks)
          .where(inArray(tracks.id, [...new Set(body.plays.map((p) => p.trackId))])),
        subscriptionHistory(db, user),
      ]);
      const knownById = new Map(known.map((k) => [k.clientPlayId!, k]));
      const trackById = new Map(trackRows.map((t) => [t.id, t]));
      const capped = (report: { trackId: string; msPlayed: number }) =>
        Math.min(report.msPlayed, (trackById.get(report.trackId)?.durationMs ?? 0) + PLAY_SLACK_MS);

      const results = new Map<string, PlayReportResult>();
      const kept = (id: string, msPlayed: number): PlayReportResult => ({
        id,
        status: msPlayed >= DEFAULT_PAYOUT_CONFIG.minStreamMs ? "counted" : "recorded",
      });
      const rejected = (id: string, reason: "too_old" | "not_subscribed" | "unavailable"): PlayReportResult => ({
        id,
        status: "rejected",
        reason,
      });

      const fresh: (typeof plays.$inferInsert)[] = [];
      const again: { id: string; msPlayed: number }[] = [];
      for (const report of reports.values()) {
        const before = knownById.get(report.id);
        if (before) {
          // An id is one listen of one track; anything else sent with it is ignored.
          again.push({ id: report.id, msPlayed: before.trackId === report.trackId ? capped(report) : 0 });
          continue;
        }
        // A phone with its clock set ahead: count the play as happening now.
        const playedAt = new Date(Math.min(Date.parse(report.playedAt), now.getTime()));
        const track = trackById.get(report.trackId);
        if (playedAt < oldest) results.set(report.id, rejected(report.id, "too_old"));
        else if (!subscribedAt(playedAt)) results.set(report.id, rejected(report.id, "not_subscribed"));
        else if (!track || track.status !== "live") results.set(report.id, rejected(report.id, "unavailable"));
        else {
          fresh.push({
            userId: user.id,
            trackId: track.id,
            clientPlayId: report.id,
            msPlayed: capped(report),
            aiScore: track.aiScore,
            playedAt,
          });
        }
      }

      if (fresh.length) {
        const inserted = await db
          .insert(plays)
          .values(fresh)
          .onConflictDoNothing()
          .returning({ clientPlayId: plays.clientPlayId, msPlayed: plays.msPlayed });
        for (const row of inserted) results.set(row.clientPlayId!, kept(row.clientPlayId!, row.msPlayed));
        // Sent by another request at the same moment: treat them as repeats.
        for (const row of fresh) {
          if (!results.has(row.clientPlayId!)) again.push({ id: row.clientPlayId!, msPlayed: row.msPlayed });
        }
      }

      // Plays we already have: keep the longest listen reported, so a retry changes nothing.
      for (const { id, msPlayed } of again) {
        const [row] = await db
          .update(plays)
          .set({ msPlayed: sql`greatest(${plays.msPlayed}, ${msPlayed})` })
          .where(and(eq(plays.userId, user.id), eq(plays.clientPlayId, id)))
          .returning({ msPlayed: plays.msPlayed });
        results.set(id, kept(id, row?.msPlayed ?? msPlayed));
      }

      return { results: ids.map((id) => results.get(id)!) } satisfies PlayBatchResult;
    });

    /**
     * A device checks its downloads. It says what it keeps downloaded (releases,
     * playlists, liked songs) and which tracks it has; it hears back what it may
     * keep, the tracks to delete, and until when it can play them offline.
     */
    app.post("/offline/sync", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
      const user = await requireUser(db, request);
      const body = SyncBody.parse(request.body);
      const checkedAt = new Date();
      const stored = [...new Set(body.trackIds)];
      const nothing = (status: OfflineSync["status"]): OfflineSync => ({
        status,
        checkedAt: checkedAt.toISOString(),
        validUntil: null,
        collections: [],
        unavailable: [],
        tracks: [],
        removedTrackIds: stored,
      });

      const [device] = await db
        .select()
        .from(offlineDevices)
        .where(and(eq(offlineDevices.userId, user.id), eq(offlineDevices.deviceKey, body.device.id)))
        .limit(1);
      const forget = async () => {
        if (device) await db.delete(offlineDevices).where(eq(offlineDevices.id, device.id));
      };

      if (user.plan !== "premium") {
        await forget();
        return nothing("not_subscribed");
      }
      if (device?.removedAt) {
        // Told once; downloading again later registers it afresh.
        await forget();
        return nothing("device_removed");
      }
      if (body.collections.length === 0 && stored.length === 0) {
        // Nothing kept here any more, so the device gives up its place.
        await forget();
        return { ...nothing("ok"), removedTrackIds: [] };
      }
      await registerDevice(db, user.id, body.device, device?.id ?? null);

      const collections: OfflineCollection[] = [];
      const unavailable: OfflineCollectionRef[] = [];
      for (const ref of body.collections) {
        const found = await loadCollection(db, user, ref);
        if (found) collections.push(found);
        else unavailable.push(ref);
      }

      const wanted = [...new Set([...collections.flatMap((c) => c.trackIds), ...stored])];
      const live = new Map<string, TrackSummary>();
      for (const ids of chunk(wanted)) {
        const rows = await selectTrackSummaries(db).where(and(inArray(tracks.id, ids), eq(tracks.status, "live")));
        for (const row of rows) live.set(row.id, toTrackSummary(row));
      }

      return {
        status: "ok",
        checkedAt: checkedAt.toISOString(),
        validUntil: new Date(checkedAt.getTime() + OFFLINE_RECHECK_DAYS * DAY_MS).toISOString(),
        collections,
        unavailable,
        tracks: wanted.filter((id) => live.has(id)).map((id) => live.get(id)!),
        removedTrackIds: stored.filter((id) => !live.has(id)),
      } satisfies OfflineSync;
    });

    /** Signed links to download tracks to a device. Subscribers only, from a device that has checked in. */
    app.post("/offline/downloads", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request) => {
      const user = await requireUser(db, request);
      if (user.plan !== "premium") throw new HttpError(403, "Downloads are for subscribers.");
      const body = DownloadBody.parse(request.body);
      const [device] = await db
        .select({ removedAt: offlineDevices.removedAt })
        .from(offlineDevices)
        .where(and(eq(offlineDevices.userId, user.id), eq(offlineDevices.deviceKey, body.deviceId)))
        .limit(1);
      if (!device || device.removedAt) throw new HttpError(409, "This device needs to check its downloads first.");

      const trackIds = [...new Set(body.trackIds)];
      const rows = await db
        .select({ id: tracks.id, bytes: tracks.audioBytes, mimeType: tracks.audioMimeType })
        .from(tracks)
        .where(and(inArray(tracks.id, trackIds), eq(tracks.status, "live")));
      const expires = Math.floor(Date.now() / 1000) + DOWNLOAD_URL_TTL_SECONDS;
      const found = new Set(rows.map((r) => r.id));
      return {
        downloads: rows.map((r) => ({
          trackId: r.id,
          url: `/api/stream/${r.id}?expires=${expires}&sig=${signStream(config.streamSigningSecret, r.id, expires, false)}`,
          expiresAt: new Date(expires * 1000).toISOString(),
          bytes: r.bytes,
          mimeType: r.mimeType,
        })),
        refusedTrackIds: trackIds.filter((id) => !found.has(id)),
      } satisfies DownloadAuthorization;
    });
  };

/**
 * Note that a device keeps downloads. A new device beyond the limit pushes out
 * the one used least recently, which deletes its downloads at its next check.
 */
async function registerDevice(
  db: Db,
  userId: string,
  device: z.infer<typeof SyncBody>["device"],
  existingId: string | null,
) {
  const now = new Date();
  if (existingId) {
    await db
      .update(offlineDevices)
      .set({ name: device.name, platform: device.platform, lastSyncAt: now })
      .where(eq(offlineDevices.id, existingId));
    return;
  }
  const active = await db
    .select({ id: offlineDevices.id })
    .from(offlineDevices)
    .where(and(eq(offlineDevices.userId, userId), isNull(offlineDevices.removedAt)))
    .orderBy(asc(offlineDevices.lastSyncAt));
  const surplus = active.slice(0, Math.max(0, active.length - MAX_OFFLINE_DEVICES + 1));
  if (surplus.length) {
    await db
      .update(offlineDevices)
      .set({ removedAt: now })
      .where(
        inArray(
          offlineDevices.id,
          surplus.map((d) => d.id),
        ),
      );
  }
  await db
    .insert(offlineDevices)
    .values({ userId, deviceKey: device.id, name: device.name, platform: device.platform, lastSyncAt: now })
    .onConflictDoUpdate({
      target: [offlineDevices.userId, offlineDevices.deviceKey],
      set: { name: device.name, platform: device.platform, lastSyncAt: now, removedAt: null },
    });
}

/** A release, playlist or the listener's liked songs, as the listener can see it now. Null if it's gone. */
async function loadCollection(db: Db, user: AuthUser, ref: OfflineCollectionRef): Promise<OfflineCollection | null> {
  if (ref.type === "release") {
    const release = await loadReleaseDetail(db, ref.id, user);
    if (!release) return null;
    return {
      type: "release",
      id: release.id,
      title: release.title,
      subtitle: release.artist.name,
      artworkUrl: release.artworkUrl,
      trackIds: release.tracks.map((t) => t.id),
    };
  }
  if (ref.type === "playlist") {
    const playlist = await loadPlaylistDetail(db, ref.id, user);
    if (!playlist) return null;
    return {
      type: "playlist",
      id: playlist.id,
      title: playlist.name,
      subtitle: playlist.owner.displayName,
      artworkUrl: playlist.artworkUrls[0] ?? null,
      trackIds: [...new Set(playlist.entries.map((e) => e.track.id))],
    };
  }
  const liked = await db
    .select({ id: likes.trackId })
    .from(likes)
    .innerJoin(tracks, eq(tracks.id, likes.trackId))
    .where(and(eq(likes.userId, user.id), eq(tracks.status, "live")))
    .orderBy(desc(likes.createdAt));
  return {
    type: "liked",
    id: null,
    title: "Liked songs",
    subtitle: null,
    artworkUrl: null,
    trackIds: liked.map((l) => l.id),
  };
}
