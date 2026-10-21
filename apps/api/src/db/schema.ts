import type {
  CopyrightNotice,
  CounterNotice,
  ReportMessageKind,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  TrackCredits,
} from "@trusic/client";
import type {
  AiDeclaration,
  DetectionResult,
  ListenerAllocation,
  PayoutConfig,
  PayoutResult,
  ScoreSource,
} from "@trusic/core";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** Money is integer minor units (pence). bigint so large monthly totals can never overflow. */
const money = (name: string) => bigint(name, { mode: "number" }).notNull();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  /** "free" or "premium". Real billing (Stripe) will own this later. */
  plan: text("plan").notNull().default("free"),
  /** Set when an artist reaches three strikes. Uploads are blocked and their tracks hidden. */
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  /** Stripe billing: the listener's customer and subscription. */
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** Stripe Connect: the account artist payouts are sent to. */
  stripeAccountId: text("stripe_account_id"),
  /** When the owner proved they can read mail at `email`. Needed to upload or be paid. */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /** Set when the account was deleted. The row stays, anonymised, because money records point at it. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the bearer token. The token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** An artist or band profile. One user can manage several. */
export const artists = pgTable(
  "artists",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    bio: text("bio").notNull().default(""),
    /** Storage key of the profile image, e.g. "images/<uuid>.jpg". */
    imageKey: text("image_key"),
    /** Hidden after a report (see reports). Its owner and admins can still see it. */
    takenDownAt: timestamp("taken_down_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("artists_owner_idx").on(t.ownerUserId)],
);

export type ReleaseType = "album" | "ep" | "single";

/** An album, EP or single. Tracks belong to at most one release. */
export const releases = pgTable(
  "releases",
  {
    id: id(),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id),
    title: text("title").notNull(),
    type: text("type").$type<ReleaseType>().notNull(),
    /** "2026-10-06". Optional until the artist sets it. */
    releaseDate: text("release_date"),
    artworkKey: text("artwork_key"),
    /** Hidden after a report (see reports). */
    takenDownAt: timestamp("taken_down_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("releases_artist_idx").on(t.artistId)],
);

export type TrackStatus = "live" | "removed" | "suspended" | "taken_down";

export const tracks = pgTable(
  "tracks",
  {
    id: id(),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id),
    title: text("title").notNull(),
    genre: text("genre"),
    releaseId: uuid("release_id").references(() => releases.id, { onDelete: "set null" }),
    /** Songwriting credits and rights details, so PRS licensing can be decided later. */
    credits: jsonb("credits").$type<TrackCredits>(),
    /** Position within the release, starting at 1. */
    trackNumber: integer("track_number"),
    durationMs: integer("duration_ms").notNull(),
    audioKey: text("audio_key").notNull(),
    audioMimeType: text("audio_mime_type").notNull(),
    audioBytes: bigint("audio_bytes", { mode: "number" }).notNull(),

    /** What the artist told us, stage by stage. */
    declaration: jsonb("declaration").$type<AiDeclaration>().notNull(),
    declaredScore: integer("declared_score").notNull(),
    rubricVersion: text("rubric_version").notNull(),
    /** What automated detection found, if it ran. */
    detection: jsonb("detection").$type<DetectionResult>(),
    /** Set by a human reviewer when resolving an appeal. Overrides everything. */
    reviewScore: integer("review_score"),
    /** The score payouts use, resolved from the three above. */
    aiScore: integer("ai_score").notNull(),
    scoreSource: text("score_source").$type<ScoreSource>().notNull(),
    /** Detection raised the score above the declaration. */
    flagged: boolean("flagged").notNull().default(false),

    /**
     * "suspended" hides a suspended artist's tracks until they're reinstated. "taken_down" is set by an admin after a
     * report: hidden everywhere, not streamable, and not paid for months still being calculated.
     */
    status: text("status").$type<TrackStatus>().notNull().default("live"),
    createdAt: createdAt(),
  },
  (t) => [
    index("tracks_artist_idx").on(t.artistId),
    index("tracks_created_idx").on(t.createdAt),
    index("tracks_release_idx").on(t.releaseId),
  ],
);

/** Who gets paid for a track. Shares are basis points and total 10000. */
export const trackSplits = pgTable(
  "track_splits",
  {
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    shareBps: integer("share_bps").notNull(),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.userId] })],
);

export const appeals = pgTable(
  "appeals",
  {
    id: id(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    openedByUserId: uuid("opened_by_user_id")
      .notNull()
      .references(() => users.id),
    message: text("message").notNull(),
    status: text("status").$type<"open" | "upheld" | "rejected">().notNull().default("open"),
    /** The score the reviewer settled on. */
    resolvedScore: integer("resolved_score"),
    resolutionNote: text("resolution_note"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("appeals_track_idx").on(t.trackId), index("appeals_status_idx").on(t.status)],
);

/** One row per play. A play counts as a stream once ms_played reaches the threshold. */
export const plays = pgTable(
  "plays",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id),
    msPlayed: integer("ms_played").notNull(),
    /**
     * The track's AI score when it was played. Payouts currently use the score at
     * calculation time; this is kept so that can change (see docs/PRODUCT.md).
     */
    aiScore: integer("ai_score"),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("plays_played_at_idx").on(t.playedAt), index("plays_user_idx").on(t.userId, t.playedAt)],
);

/**
 * Money in, by period ("2026-10"). Amounts are net of VAT and payment fees.
 * userId is null for revenue not tied to a listener.
 */
export const revenueEntries = pgTable(
  "revenue_entries",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    period: text("period").notNull(),
    source: text("source").$type<"subscription" | "other">().notNull(),
    amount: money("amount"),
    /** e.g. the Stripe invoice id, so a webhook delivered twice is only counted once. */
    externalRef: text("external_ref").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("revenue_period_idx").on(t.period)],
);

export type PayoutTotals = PayoutResult["totals"];
export type HumanPot = PayoutResult["humanPot"];

export const payoutRuns = pgTable(
  "payout_runs",
  {
    id: id(),
    period: text("period").notNull(),
    currency: text("currency").notNull(),
    config: jsonb("config").$type<PayoutConfig>().notNull(),
    totals: jsonb("totals").$type<PayoutTotals>().notNull(),
    humanPot: jsonb("human_pot").$type<HumanPot>().notNull(),
    /**
     * Set when the month is locked for paying out. A finalised month can't be
     * recalculated; mistakes found later are corrected by clawbacks instead.
     */
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payout_runs_period_idx").on(t.period)],
);

export const payoutTrackLines = pgTable(
  "payout_track_lines",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => payoutRuns.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id),
    aiScore: integer("ai_score").notNull(),
    streams: integer("streams").notNull(),
    humanWeightedStreams: real("human_weighted_streams").notNull(),
    baseAmount: money("base_amount"),
    amount: money("amount"),
    forfeited: money("forfeited"),
    uplift: money("uplift"),
  },
  (t) => [primaryKey({ columns: [t.runId, t.trackId] })],
);

export const payoutPayeeLines = pgTable(
  "payout_payee_lines",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => payoutRuns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    amount: money("amount"),
    tracks: jsonb("tracks").$type<{ trackId: string; amount: number }[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.userId] })],
);

export const payoutListenerStatements = pgTable(
  "payout_listener_statements",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => payoutRuns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    revenue: money("revenue"),
    platform: money("platform"),
    artistShare: money("artist_share"),
    allocations: jsonb("allocations").$type<ListenerAllocation[]>().notNull(),
    toHumanPot: jsonb("to_human_pot").$type<{ amount: number; reason: string } | null>(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.userId] })],
);

export const likes = pgTable(
  "likes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.trackId] })],
);

export const follows = pgTable(
  "follows",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.artistId] }), index("follows_artist_idx").on(t.artistId)],
);

export const playlists = pgTable(
  "playlists",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    isPublic: boolean("is_public").notNull().default(true),
    /** Hidden from everyone but its owner after a report. */
    takenDownAt: timestamp("taken_down_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("playlists_owner_idx").on(t.ownerUserId)],
);

/** A track's place in a playlist. The same track can appear more than once. */
export const playlistEntries = pgTable(
  "playlist_entries",
  {
    id: id(),
    playlistId: uuid("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("playlist_entries_playlist_idx").on(t.playlistId, t.position)],
);

/**
 * A proven false declaration: the artist declared less AI than they used.
 * The track's score is corrected and what it over-earned is clawed back.
 */
export const strikes = pgTable(
  "strikes",
  {
    id: id(),
    /** The account that owns the artist profile. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id),
    reason: text("reason").notNull(),
    declaredScore: integer("declared_score").notNull(),
    correctedScore: integer("corrected_score").notNull(),
    /** Total over-earned across past months, owed back by the track's payees. */
    clawbackTotal: money("clawback_total"),
    /** The payout month whose human pot received the clawback. Null until the next run. */
    appliedInPeriod: text("applied_in_period"),
    issuedByUserId: uuid("issued_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("strikes_user_idx").on(t.userId)],
);

export type LedgerEntryType = "earnings" | "clawback" | "payout" | "adjustment";

/**
 * Each payee's running balance: monthly earnings in, clawbacks and payouts out.
 * Signed amounts in pence. Earnings rows belong to a payout run and are replaced
 * if that month is recalculated.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").$type<LedgerEntryType>().notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    runId: uuid("run_id").references(() => payoutRuns.id, { onDelete: "cascade" }),
    strikeId: uuid("strike_id").references(() => strikes.id),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Account emails, reports and takedowns.

export type EmailTokenPurpose = "verify_email" | "change_email" | "reset_password";

/**
 * Single-use links sent by email: confirm an address, switch to a new one, or reset a password.
 * Only a hash of the token is stored.
 */
export const emailTokens = pgTable(
  "email_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<EmailTokenPurpose>().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** The address the link was sent to. For "change_email", the new address. */
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("email_tokens_user_idx").on(t.userId, t.purpose)],
);

/** What an admin changed when taking something down, so it can be put back exactly. */
export interface TakedownRecord {
  tracks: { id: string; previousStatus: TrackStatus }[];
  releaseIds: string[];
  artistIds: string[];
  playlistIds: string[];
  /** Artwork taken off releases and artist profiles, with the image it pointed to. */
  images: { on: "release" | "artist"; id: string; key: string }[];
}

/**
 * Anyone can report a track, release, artist, playlist or a piece of artwork. Copyright, offensive and impersonation
 * reports go to the takedown queue; wrong AI labels go to the score review next to appeals.
 */
export const reports = pgTable(
  "reports",
  {
    id: id(),
    targetType: text("target_type").$type<ReportTargetType>().notNull(),
    /** A uuid, or for artwork the image's file name ("<uuid>.png"). */
    targetId: text("target_id").notNull(),
    /** What it was called when reported, e.g. "Chalk Paths by The Hollow Pines". */
    targetTitle: text("target_title").notNull(),
    /** Whoever uploaded or owns the reported content. */
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    reason: text("reason").$type<ReportReason>().notNull(),
    details: text("details").notNull(),
    reporterUserId: uuid("reporter_user_id").references(() => users.id),
    reporterName: text("reporter_name"),
    reporterEmail: text("reporter_email"),
    /** The parts of a copyright notice, for copyright reports. */
    copyright: jsonb("copyright").$type<CopyrightNotice>(),
    status: text("status").$type<ReportStatus>().notNull().default("open"),
    /** Lets the reporter answer questions from a link in their email, without an account. */
    replyTokenHash: text("reply_token_hash"),
    /** Set while the content is down. */
    takedown: jsonb("takedown").$type<TakedownRecord>(),
    counterNotice: jsonb("counter_notice").$type<CounterNotice>(),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reports_status_idx").on(t.status, t.createdAt),
    index("reports_target_idx").on(t.targetType, t.targetId),
    index("reports_owner_idx").on(t.ownerUserId),
  ],
);

/** Everything said about a report, in order: questions, replies, decisions and counter-notices. */
export const reportMessages = pgTable(
  "report_messages",
  {
    id: id(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ReportMessageKind>().notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("report_messages_report_idx").on(t.reportId, t.createdAt)],
);

/**
 * An upheld copyright takedown, kept apart from strikes for false AI declarations. Three that haven't been
 * withdrawn suspend the account. A strike is withdrawn if the content is put back after a counter-notice.
 */
export const copyrightStrikes = pgTable(
  "copyright_strikes",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id),
    /** What was taken down, e.g. "Track: Chalk Paths by The Hollow Pines". */
    targetTitle: text("target_title").notNull(),
    reason: text("reason").notNull(),
    issuedByUserId: uuid("issued_by_user_id")
      .notNull()
      .references(() => users.id),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("copyright_strikes_user_idx").on(t.userId)],
);
