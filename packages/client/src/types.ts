/**
 * The shapes the Trusic API sends and receives. The server checks its responses
 * against these, so every client (web, desktop, mobile) stays in step with it.
 */
import type {
  AiDeclaration,
  AiLabel,
  AiScoreRubric,
  AssistiveTool,
  DetectionVerdict,
  HumanPotReason,
  PayoutResult,
  ScoreBreakdown,
  ScorePolicy,
  ScoreSource,
} from "@trusic/core";

export interface User {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  /** "free" means not subscribed: previews only. There is no free tier. */
  plan: "free" | "premium";
  /** Suspended after three strikes: can't upload, and their tracks are hidden. */
  suspended: boolean;
}

export interface ArtistRef {
  id: string;
  name: string;
  slug: string;
}

export interface Artist extends ArtistRef {
  bio: string;
  imageUrl: string | null;
  createdAt: string;
}

export interface Me {
  user: User;
  artists: Artist[];
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ReleaseRef {
  id: string;
  title: string;
}

export interface TrackSummary {
  id: string;
  title: string;
  genre: string | null;
  durationMs: number;
  artist: ArtistRef;
  release: ReleaseRef | null;
  /** Position on its release, from 1. */
  trackNumber: number | null;
  /** The release's artwork, if it has any. */
  artworkUrl: string | null;
  aiScore: number;
  aiLabel: AiLabel;
  /** Share of the human per-stream rate this track earns, 0-100. */
  payoutRatePercent: number;
  scoreSource: ScoreSource;
  flagged: boolean;
  createdAt: string;
}

export interface TrackDetail extends TrackSummary {
  declaration: AiDeclaration;
  declaredScore: number;
  breakdown: ScoreBreakdown;
  detection: { detector: string; verdict: DetectionVerdict; confidence: number; evidence: string[] } | null;
  reviewScore: number | null;
  /**
   * Songwriting credits. Everyone sees the writers and whether it's a cover;
   * society membership and ISRC are only shown to the owner and admins.
   */
  credits: TrackCredits | null;
  /** The most recent appeal, if any. Only shown to the track's owner and admins. */
  appeal: Appeal | null;
  isOwner: boolean;
}

export interface TrackList {
  tracks: TrackSummary[];
  total: number;
}

export interface Split {
  userId: string;
  email: string;
  displayName: string;
  shareBps: number;
}

export interface Appeal {
  id: string;
  trackId: string;
  message: string;
  status: "open" | "upheld" | "rejected";
  resolvedScore: number | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdminAppeal extends Appeal {
  track: TrackSummary & { declaredScore: number; detection: TrackDetail["detection"] };
  openedBy: { id: string; email: string; displayName: string };
}

export interface StreamUrl {
  url: string;
  expiresAt: string;
  /**
   * True when the listener isn't subscribed: they get a preview of the first
   * `previewMs` milliseconds only. Previews never count as plays.
   */
  preview: boolean;
  previewMs: number | null;
}

export interface PlayRecorded {
  counted: boolean;
}

export interface RubricInfo {
  rubric: AiScoreRubric;
  assistiveTools: AssistiveTool[];
  labels: Record<AiLabel, { name: string; description: string }>;
  scorePolicy: ScorePolicy;
}

export type PayoutTotals = PayoutResult["totals"];
export type HumanPot = PayoutResult["humanPot"];

export interface PayoutRunSummary {
  id: string;
  period: string;
  currency: string;
  platformSharePercent: number;
  totals: PayoutTotals;
  humanPot: HumanPot;
  /** When the month was locked for paying out; null while it can still be recalculated. */
  finalizedAt: string | null;
  /** Streams and money by AI label. */
  byLabel: Record<AiLabel, { tracks: number; streams: number; amount: number; forfeited: number }>;
  createdAt: string;
}

export interface Transparency {
  currency: string;
  platformSharePercent: number;
  minStreamSeconds: number;
  catalog: Record<AiLabel, number>;
  runs: PayoutRunSummary[];
}

export interface ListenerStatementView {
  period: string;
  currency: string;
  revenue: number;
  platform: number;
  artistShare: number;
  allocations: {
    track: TrackSummary;
    streams: number;
    baseAmount: number;
    amount: number;
  }[];
  toHumanPot: { amount: number; reason: HumanPotReason } | null;
}

export interface EarningsPeriod {
  period: string;
  currency: string;
  amount: number;
  tracks: {
    track: TrackSummary;
    /** Your share of this track's money (after band splits). */
    amount: number;
    /** The whole track's figures, before splits. */
    streams: number;
    trackAmount: number;
    baseAmount: number;
    forfeited: number;
    uplift: number;
  }[];
}

/** How payments work on this server. "demo" takes no real money. */
export interface BillingConfig {
  provider: "demo" | "stripe";
  /** Monthly price including VAT, in minor units. */
  priceMinor: number;
  currency: string;
  /** Artists are paid once their available balance reaches this. */
  payoutMinimumMinor: number;
}

/** Demo billing subscribes immediately; Stripe sends the listener to a checkout page. */
export type SubscribeResult = { mode: "demo"; user: User } | { mode: "stripe"; checkoutUrl: string };

export interface CancelResult {
  user: User;
  /** With Stripe, Premium lasts until the end of the paid month. */
  endsAt: string | null;
}

export interface PayoutAccountStatus {
  provider: "demo" | "stripe";
  /** Has the artist set up where to be paid? Always true for demo billing. */
  connected: boolean;
  payoutsEnabled: boolean;
}

export interface PayArtistsResult {
  currency: string;
  paid: { userId: string; displayName: string; amount: number; transferId: string | null }[];
  skipped: { userId: string; displayName: string; available: number; reason: string }[];
}

export type ReleaseType = "album" | "ep" | "single";

export interface ReleaseSummary extends ReleaseRef {
  type: ReleaseType;
  /** "2026-10-06", or null if not set. */
  releaseDate: string | null;
  artworkUrl: string | null;
  artist: ArtistRef;
  trackCount: number;
  /** How many of its live tracks carry each AI label. */
  aiLabels: Record<AiLabel, number>;
}

export interface ReleaseDetail extends ReleaseSummary {
  tracks: TrackSummary[];
  durationMs: number;
  isOwner: boolean;
}

export interface ArtistPage {
  artist: Artist;
  tracks: TrackSummary[];
  releases: ReleaseSummary[];
  followers: number;
  /** Whether the signed-in viewer follows this artist. */
  isFollowing: boolean;
  isOwner: boolean;
}

/** IDs the signed-in listener has liked or followed, for showing hearts and follow buttons. */
export interface LibraryIds {
  likedTrackIds: string[];
  followedArtistIds: string[];
}

export interface LikedTrack {
  track: TrackSummary;
  likedAt: string;
}

export interface HistoryItem {
  track: TrackSummary;
  playedAt: string;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  description: string;
  isPublic: boolean;
  owner: { id: string; displayName: string };
  trackCount: number;
  /** Artwork from up to four of its tracks, for a cover mosaic. */
  artworkUrls: string[];
  updatedAt: string;
}

export interface PlaylistEntry {
  entryId: string;
  addedAt: string;
  track: TrackSummary;
}

export interface PlaylistDetail extends PlaylistSummary {
  entries: PlaylistEntry[];
  durationMs: number;
  isOwner: boolean;
}

/** A proven false declaration. */
export interface Strike {
  id: string;
  trackId: string;
  trackTitle: string;
  reason: string;
  declaredScore: number;
  correctedScore: number;
  /** What the track over-earned in past months, in pence, owed back by its payees. */
  clawbackTotal: number;
  /** The month whose human pot received the clawed-back money, once paid out. */
  appliedInPeriod: string | null;
  createdAt: string;
}

export interface StrikeResult {
  strike: Strike;
  strikeCount: number;
  suspended: boolean;
}

export interface AdminStrike {
  strike: Strike;
  artist: ArtistRef;
  user: { id: string; email: string; displayName: string };
}

export interface SuspendedAccount {
  id: string;
  email: string;
  displayName: string;
  suspendedAt: string;
  strikes: number;
}

export type LedgerEntryType = "earnings" | "clawback" | "payout" | "adjustment";

export interface LedgerEntry {
  id: string;
  type: LedgerEntryType;
  /** Signed, in pence: earnings are positive, clawbacks and payouts negative. */
  amount: number;
  note: string;
  /** Earnings from a month that isn't finalised yet, so not available to pay out. */
  pending: boolean;
  createdAt: string;
}

/** An artist's running balance: earnings in, clawbacks and payouts out. */
export interface Balance {
  currency: string;
  /** Everything, including months not yet finalised. */
  balance: number;
  /** What can be paid out now. Can be negative while a clawback is being recovered. */
  available: number;
  pending: number;
  entries: LedgerEntry[];
  strikes: Strike[];
  suspended: boolean;
}

/** Who wrote a track, and whether a collecting society licenses the song. */
export interface TrackCredits {
  songwriters: string[];
  /**
   * Is any songwriter a member of PRS for Music or another collecting society?
   * Omitted when shown to the public.
   */
  societyMember?: "yes" | "no" | "unsure";
  isCover: boolean;
  /** For covers: who the song is by. */
  originalArtist?: string;
  /** The recording's ISRC code, if it has one. */
  isrc?: string;
}

/** How many tracks involve society members, for the PRS licensing decision. */
export interface RightsSummary {
  totalTracks: number;
  societyMember: { yes: number; no: number; unsure: number; notGiven: number };
  covers: number;
}
