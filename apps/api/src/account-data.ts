/**
 * "Your data" under UK GDPR: download everything we hold about an account, or delete the account.
 *
 * Deleting can't simply remove every row. Plays, payout runs and ledger entries are what other people's statements and
 * Trusic's accounts are built from, so they stay, attached to an anonymised account with no name, email or password.
 * Everything that's only about the person (profile, likes, follows, playlists, sessions) goes, and their uploads come
 * down for good. See "Deleting an account" in docs/PRODUCT.md.
 */
import type { DataExport } from "@trusic/client";
import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import type Stripe from "stripe";
import type { Config } from "./config";
import type { Db } from "./db/client";
import {
  appeals,
  artists,
  copyrightStrikes,
  emailTokens,
  follows,
  ledgerEntries,
  likes,
  payoutListenerStatements,
  payoutPayeeLines,
  payoutRuns,
  playlistEntries,
  playlists,
  plays,
  releases,
  reportMessages,
  reports,
  revenueEntries,
  sessions,
  strikes,
  trackLyrics,
  trackSplits,
  tracks,
  users,
} from "./db/schema";
import { compose, emails } from "./emails";
import { HttpError } from "./errors";
import { recordFollowChanges } from "./follow-history";
import { sendLater, type Mailer } from "./mailer";
import { deleteOfflineAccountData, offlineAccountData } from "./offline-data";
import { removeMediaFiles } from "./media/processor";
import type { MediaStorage } from "./storage";

/** Everything Trusic holds about one account, as a JSON document. */
export async function exportAccountData(db: Db, userId: string): Promise<DataExport> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new HttpError(404, "Account not found.");

  const ownedArtists = await db.select().from(artists).where(eq(artists.ownerUserId, userId));
  const artistIds = ownedArtists.map((a) => a.id);
  const [ownedReleases, ownedTracks] = artistIds.length
    ? await Promise.all([
        db.select().from(releases).where(inArray(releases.artistId, artistIds)),
        db.select().from(tracks).where(inArray(tracks.artistId, artistIds)),
      ])
    : [[], []];

  const [
    splitRows,
    playRows,
    likeRows,
    followRows,
    playlistRows,
    revenueRows,
    statementRows,
    earningRows,
    ledgerRows,
    aiStrikes,
    copyright,
    appealRows,
    reportsMade,
    reportsAboutYou,
    sessionRows,
  ] = await Promise.all([
    db
      .select({ trackId: trackSplits.trackId, trackTitle: tracks.title, shareBps: trackSplits.shareBps })
      .from(trackSplits)
      .innerJoin(tracks, eq(tracks.id, trackSplits.trackId))
      .where(eq(trackSplits.userId, userId)),
    db
      .select({
        trackId: plays.trackId,
        trackTitle: tracks.title,
        msPlayed: plays.msPlayed,
        aiScore: plays.aiScore,
        playedAt: plays.playedAt,
        source: plays.source,
      })
      .from(plays)
      .innerJoin(tracks, eq(tracks.id, plays.trackId))
      .where(eq(plays.userId, userId))
      .orderBy(asc(plays.playedAt)),
    db
      .select({ trackId: likes.trackId, trackTitle: tracks.title, likedAt: likes.createdAt })
      .from(likes)
      .innerJoin(tracks, eq(tracks.id, likes.trackId))
      .where(eq(likes.userId, userId)),
    db
      .select({ artistId: follows.artistId, artistName: artists.name, followedAt: follows.createdAt })
      .from(follows)
      .innerJoin(artists, eq(artists.id, follows.artistId))
      .where(eq(follows.userId, userId)),
    db.select().from(playlists).where(eq(playlists.ownerUserId, userId)),
    db
      .select({
        period: revenueEntries.period,
        source: revenueEntries.source,
        amount: revenueEntries.amount,
        createdAt: revenueEntries.createdAt,
      })
      .from(revenueEntries)
      .where(eq(revenueEntries.userId, userId)),
    db
      .select({ period: payoutRuns.period, currency: payoutRuns.currency, statement: payoutListenerStatements })
      .from(payoutListenerStatements)
      .innerJoin(payoutRuns, eq(payoutRuns.id, payoutListenerStatements.runId))
      .where(eq(payoutListenerStatements.userId, userId)),
    db
      .select({
        period: payoutRuns.period,
        currency: payoutRuns.currency,
        amount: payoutPayeeLines.amount,
        tracks: payoutPayeeLines.tracks,
      })
      .from(payoutPayeeLines)
      .innerJoin(payoutRuns, eq(payoutRuns.id, payoutPayeeLines.runId))
      .where(eq(payoutPayeeLines.userId, userId)),
    db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId)).orderBy(asc(ledgerEntries.createdAt)),
    db.select().from(strikes).where(eq(strikes.userId, userId)),
    db.select().from(copyrightStrikes).where(eq(copyrightStrikes.userId, userId)),
    db.select().from(appeals).where(eq(appeals.openedByUserId, userId)),
    db.select().from(reports).where(eq(reports.reporterUserId, userId)),
    db.select().from(reports).where(eq(reports.ownerUserId, userId)),
    db
      .select({ createdAt: sessions.createdAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.userId, userId)),
  ]);

  const playlistIds = playlistRows.map((p) => p.id);
  const entries = playlistIds.length
    ? await db
        .select({
          playlistId: playlistEntries.playlistId,
          trackId: playlistEntries.trackId,
          trackTitle: tracks.title,
          position: playlistEntries.position,
          addedAt: playlistEntries.addedAt,
        })
        .from(playlistEntries)
        .innerJoin(tracks, eq(tracks.id, playlistEntries.trackId))
        .where(inArray(playlistEntries.playlistId, playlistIds))
        .orderBy(asc(playlistEntries.position))
    : [];
  const reportIds = reportsMade.map((r) => r.id);
  const messages = reportIds.length
    ? await db
        .select()
        .from(reportMessages)
        .where(inArray(reportMessages.reportId, reportIds))
        .orderBy(asc(reportMessages.createdAt))
    : [];

  return {
    exportedAt: new Date().toISOString(),
    about:
      "Everything Trusic holds about your account. Amounts are in pence. AI scores run from 0 (made by people) to 100 (generated by AI).",
    profile: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      plan: user.plan,
      isAdmin: user.isAdmin,
      emailVerifiedAt: user.emailVerifiedAt,
      suspendedAt: user.suspendedAt,
      humanMadeOnly: user.humanOnly,
      createdAt: user.createdAt,
      billing: {
        stripeCustomerId: user.stripeCustomerId,
        stripeSubscriptionId: user.stripeSubscriptionId,
        stripePayoutAccountId: user.stripeAccountId,
      },
    },
    signedInSessions: sessionRows,
    artists: ownedArtists.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      bio: a.bio,
      hasPhoto: Boolean(a.imageKey),
      takenDownAt: a.takenDownAt,
      createdAt: a.createdAt,
    })),
    releases: ownedReleases.map((r) => ({
      id: r.id,
      artistId: r.artistId,
      title: r.title,
      type: r.type,
      releaseDate: r.releaseDate,
      hasArtwork: Boolean(r.artworkKey),
      takenDownAt: r.takenDownAt,
      createdAt: r.createdAt,
    })),
    tracks: ownedTracks.map((t) => ({
      id: t.id,
      artistId: t.artistId,
      releaseId: t.releaseId,
      trackNumber: t.trackNumber,
      title: t.title,
      genre: t.genre,
      durationMs: t.durationMs,
      status: t.status,
      aiDeclaration: t.declaration,
      declaredScore: t.declaredScore,
      detection: t.detection,
      reviewScore: t.reviewScore,
      aiScore: t.aiScore,
      scoreSource: t.scoreSource,
      credits: t.credits,
      createdAt: t.createdAt,
    })),
    bandSplits: splitRows,
    // Lyrics on their own tracks, and any they last edited on tracks they're in the band split for.
    lyrics: await db
      .select()
      .from(trackLyrics)
      .where(
        ownedTracks.length
          ? or(
              inArray(
                trackLyrics.trackId,
                ownedTracks.map((t) => t.id),
              ),
              eq(trackLyrics.updatedByUserId, userId),
            )
          : eq(trackLyrics.updatedByUserId, userId),
      ),
    plays: playRows,
    likes: likeRows,
    follows: followRows,
    playlists: playlistRows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isPublic: p.isPublic,
      createdAt: p.createdAt,
      tracks: entries.filter((e) => e.playlistId === p.id).map(({ playlistId: _, ...e }) => e),
    })),
    subscriptionPayments: revenueRows,
    listenerStatements: statementRows.map(({ period, currency, statement: s }) => ({
      period,
      currency,
      paid: s.revenue,
      toTrusic: s.platform,
      toArtists: s.artistShare,
      allocations: s.allocations,
      toHumanPot: s.toHumanPot,
    })),
    artistEarnings: earningRows,
    ledger: ledgerRows.map((e) => ({ type: e.type, amount: e.amount, note: e.note, createdAt: e.createdAt })),
    strikes: {
      falseAiDeclarations: aiStrikes.map((s) => ({
        trackId: s.trackId,
        reason: s.reason,
        declaredScore: s.declaredScore,
        correctedScore: s.correctedScore,
        clawbackTotal: s.clawbackTotal,
        createdAt: s.createdAt,
      })),
      copyright: copyright.map((s) => ({
        reportId: s.reportId,
        what: s.targetTitle,
        reason: s.reason,
        withdrawnAt: s.withdrawnAt,
        createdAt: s.createdAt,
      })),
    },
    appeals: appealRows.map((a) => ({
      trackId: a.trackId,
      message: a.message,
      status: a.status,
      resolvedScore: a.resolvedScore,
      resolutionNote: a.resolutionNote,
      createdAt: a.createdAt,
      resolvedAt: a.resolvedAt,
    })),
    reportsYouMade: reportsMade.map((r) => ({
      id: r.id,
      what: r.targetTitle,
      reason: r.reason,
      details: r.details,
      yourName: r.reporterName,
      yourEmail: r.reporterEmail,
      copyrightNotice: r.copyright,
      status: r.status,
      createdAt: r.createdAt,
      messages: messages
        .filter((m) => m.reportId === r.id)
        .map((m) => ({ kind: m.kind, body: m.body, createdAt: m.createdAt })),
    })),
    // The reporter's contact details belong to them, so they're left out.
    reportsAboutYourContent: reportsAboutYou.map((r) => ({
      id: r.id,
      what: r.targetTitle,
      reason: r.reason,
      status: r.status,
      counterNotice: r.counterNotice,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
    })),
    // Subscription history and the devices keeping downloads (offline listening).
    ...(await offlineAccountData(db, userId)),
  };
}

export interface DeletionDeps {
  db: Db;
  storage: MediaStorage;
  stripe: Stripe | null;
  mailer: Mailer;
  config: Pick<Config, "publicUrl">;
}

/**
 * Delete an account:
 * - its subscription is cancelled (with Stripe, before anything else, so a failure deletes nothing);
 * - its tracks come down for good and their audio, artwork and photos are deleted; its artist profiles are renamed
 *   "Deleted artist" and its releases deleted;
 * - its share of other people's tracks goes to each track's owner;
 * - its likes, follows, playlists, sessions and email links are deleted;
 * - plays, payments, statements, payout runs, ledger entries and strikes stay, attached to the anonymised account,
 *   because other people's statements and Trusic's accounts depend on them;
 * - the email address is freed, so the person can sign up again.
 */
export async function deleteAccount(deps: DeletionDeps, userId: string): Promise<void> {
  const { db, storage, stripe, mailer } = deps;
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!user) throw new HttpError(404, "Account not found.");

  if (stripe && user.stripeSubscriptionId) {
    try {
      await stripe.subscriptions.cancel(user.stripeSubscriptionId);
    } catch (error) {
      if ((error as { code?: string }).code !== "resource_missing") {
        throw new HttpError(
          502,
          "We couldn't cancel your subscription with Stripe, so nothing has been deleted. Please try again in a few minutes.",
        );
      }
    }
  }

  const files: string[] = [];
  await db.transaction(async (tx) => {
    const owned = await tx.select().from(artists).where(eq(artists.ownerUserId, userId));
    const artistIds = owned.map((a) => a.id);
    if (artistIds.length) {
      const ownedTracks = await tx
        .select({
          audioKey: tracks.audioKey,
          originalAudioKey: tracks.originalAudioKey,
          previewAudioKey: tracks.previewAudioKey,
        })
        .from(tracks)
        .where(inArray(tracks.artistId, artistIds));
      // The streamed file, the upload it was made from, and the preview.
      files.push(
        ...ownedTracks.flatMap((t) => [t.audioKey, t.originalAudioKey, t.previewAudioKey].filter((k) => k !== null)),
      );
      // Lyrics go with the rest of their content.
      await tx
        .delete(trackLyrics)
        .where(
          inArray(
            trackLyrics.trackId,
            tx.select({ id: tracks.id }).from(tracks).where(inArray(tracks.artistId, artistIds)),
          ),
        );
      // The rows stay, because statements and payouts name them. Taken-down tracks keep that status.
      await tx.update(tracks).set({ credits: null }).where(inArray(tracks.artistId, artistIds));
      await tx
        .update(tracks)
        .set({ status: "removed" })
        .where(and(inArray(tracks.artistId, artistIds), ne(tracks.status, "taken_down")));

      const gone = await tx
        .delete(releases)
        .where(inArray(releases.artistId, artistIds))
        .returning({ artworkKey: releases.artworkKey });
      files.push(...gone.flatMap((r) => (r.artworkKey ? [r.artworkKey] : [])));
      for (const a of owned) {
        if (a.imageKey) files.push(a.imageKey);
        await tx
          .update(artists)
          .set({ name: "Deleted artist", bio: "", imageKey: null, slug: `deleted-${a.id}` })
          .where(eq(artists.id, a.id));
      }
      await tx.delete(follows).where(inArray(follows.artistId, artistIds));
    }
    // Artwork held aside by a takedown isn't on any release or profile any more, but it's still theirs.
    const takedowns = await tx
      .select({ takedown: reports.takedown })
      .from(reports)
      .where(and(eq(reports.ownerUserId, userId), isNotNull(reports.takedown)));
    files.push(...takedowns.flatMap((r) => r.takedown?.images.map((i) => i.key) ?? []));

    // Their share of other people's tracks goes to whoever owns each track.
    const shares = await tx
      .select({ trackId: trackSplits.trackId, shareBps: trackSplits.shareBps, ownerUserId: artists.ownerUserId })
      .from(trackSplits)
      .innerJoin(tracks, eq(tracks.id, trackSplits.trackId))
      .innerJoin(artists, eq(artists.id, tracks.artistId))
      .where(and(eq(trackSplits.userId, userId), ne(artists.ownerUserId, userId)));
    for (const s of shares) {
      await tx.delete(trackSplits).where(and(eq(trackSplits.trackId, s.trackId), eq(trackSplits.userId, userId)));
      const [existing] = await tx
        .select({ shareBps: trackSplits.shareBps })
        .from(trackSplits)
        .where(and(eq(trackSplits.trackId, s.trackId), eq(trackSplits.userId, s.ownerUserId)));
      if (existing) {
        await tx
          .update(trackSplits)
          .set({ shareBps: existing.shareBps + s.shareBps })
          .where(and(eq(trackSplits.trackId, s.trackId), eq(trackSplits.userId, s.ownerUserId)));
      } else {
        await tx.insert(trackSplits).values({ trackId: s.trackId, userId: s.ownerUserId, shareBps: s.shareBps });
      }
    }

    await tx.delete(likes).where(eq(likes.userId, userId));
    // The artists they followed lose a follower, as if they'd unfollowed.
    const unfollowed = await tx
      .delete(follows)
      .where(eq(follows.userId, userId))
      .returning({ artistId: follows.artistId });
    await recordFollowChanges(
      tx,
      "unfollow",
      unfollowed.map((f) => f.artistId),
    );
    await tx.delete(playlists).where(eq(playlists.ownerUserId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(emailTokens).where(eq(emailTokens.userId, userId));
    await deleteOfflineAccountData(tx, userId);
    // Copyright notices they sent are kept whole as a legal record. Other reports forget who sent them.
    await tx
      .update(reports)
      .set({ reporterName: null, reporterEmail: null, replyTokenHash: null })
      .where(and(eq(reports.reporterUserId, userId), or(ne(reports.reason, "copyright"), isNull(reports.copyright))));
    await tx
      .update(users)
      .set({
        email: `deleted-${userId}@deleted.invalid`,
        displayName: "Deleted account",
        passwordHash: "deleted",
        isAdmin: false,
        plan: "free",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripeAccountId: null,
        emailVerifiedAt: null,
        deletedAt: new Date(),
      })
      .where(eq(users.id, userId));
  });

  // With any resized copies of the images.
  await removeMediaFiles(db, storage, files);
  sendLater(mailer, compose(user.email, emails.accountDeleted({ name: user.displayName })));
}
