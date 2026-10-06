import type { AiDeclaration, DetectionResult, ListenerAllocation, PayoutConfig, PayoutResult, ScoreSource } from "@trusic/core";
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
    createdAt: createdAt(),
  },
  (t) => [index("artists_owner_idx").on(t.ownerUserId)],
);

export const tracks = pgTable(
  "tracks",
  {
    id: id(),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id),
    title: text("title").notNull(),
    genre: text("genre"),
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

    status: text("status").$type<"live" | "removed">().notNull().default("live"),
    createdAt: createdAt(),
  },
  (t) => [index("tracks_artist_idx").on(t.artistId), index("tracks_created_idx").on(t.createdAt)],
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
    playedAt: timestamp("played_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("plays_played_at_idx").on(t.playedAt), index("plays_user_idx").on(t.userId)],
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
    source: text("source").$type<"subscription" | "ads" | "other">().notNull(),
    amount: money("amount"),
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
