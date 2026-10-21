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
import type { PlaySource } from "./insights";

export interface User {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  /** "free" means not subscribed: previews only. There is no free tier. */
  plan: "free" | "premium";
  /** Suspended after three strikes: can't upload, and their tracks are hidden. */
  suspended: boolean;
  /** Has the owner clicked the link we emailed? Needed to upload or set up payouts, not to listen. */
  emailVerified: boolean;
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
  /** A new email address waiting to be confirmed; the account keeps its old one until then. */
  pendingEmail: string | null;
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
  /**
   * Streams counted this month that were played in an earlier one, because they
   * reached us after that month was finalised (for example, listening offline).
   */
  lateStreams?: number;
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
  /** Strikes for false AI declarations. */
  strikes: number;
  /** Upheld copyright takedowns that haven't been withdrawn. */
  copyrightStrikes: number;
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

// Lyrics and sharing

/** Plain text, or time-synced LRC so lines can follow the music. */
export type LyricsFormat = "plain" | "synced";

export interface LyricLine {
  /** When the line starts, in milliseconds. Null for plain lyrics. */
  timeMs: number | null;
  /** Empty for a gap between verses, or an instrumental break in synced lyrics. */
  text: string;
}

export interface TrackLyrics {
  trackId: string;
  /** Null when the track has no lyrics, or they can't be shown (see `hidden`). */
  format: LyricsFormat | null;
  lines: LyricLine[];
  /** Exactly what was entered (LRC for synced lyrics). Only sent to people who can edit them. */
  source: string | null;
  /** Why lyrics aren't shown to listeners. Covers need a lyric licence Trusic doesn't have yet. */
  hidden: "cover" | null;
  /** The uploader and the track's split members can edit its lyrics. */
  canEdit: boolean;
  updatedAt: string | null;
}

/** A track whose lyrics the signed-in user can edit. */
export interface LyricsTrack {
  track: TrackSummary;
  format: LyricsFormat | null;
  isCover: boolean;
  /** Declared as having no lyrics (an instrumental). */
  instrumental: boolean;
  /** Uploaded it, or is in its band split. */
  role: "uploader" | "split";
}

/** Where this Trusic site lives, for share links made in apps that don't run on it (the desktop app). */
export interface SiteInfo {
  url: string;
}
// Offline listening (downloads in the phone and desktop apps)

/** One listen, reported by an app's play queue. Reporting the same id again never counts it twice. */
export interface PlayReport {
  /** Made up by the app (a UUID) when the listen starts. */
  id: string;
  trackId: string;
  /** When the listen started. */
  playedAt: string;
  msPlayed: number;
  /** Where the play started, for artists' stats. Optional. */
  source?: PlaySource | null;
}

export type PlayReportResult =
  /** Kept. "counted" means it was long enough to count as a stream. */
  | { id: string; status: "counted" | "recorded" }
  | {
      id: string;
      status: "rejected";
      /**
       * too_old: played more than 30 days ago. not_subscribed: the listener wasn't
       * subscribed when they played it. unavailable: the track has been taken down.
       */
      reason: "too_old" | "not_subscribed" | "unavailable";
    };

export interface PlayBatchResult {
  results: PlayReportResult[];
}

/** Something a listener keeps downloaded. */
export type OfflineCollectionRef = { type: "release" | "playlist"; id: string } | { type: "liked" };

export interface OfflineCollection {
  type: "release" | "playlist" | "liked";
  /** Null for liked songs. */
  id: string | null;
  title: string;
  /** The artist of a release, or the owner of a playlist. */
  subtitle: string | null;
  artworkUrl: string | null;
  /** Its tracks that can be downloaded, in order. */
  trackIds: string[];
}

export interface OfflineDevice {
  /** Made up by the app when it's installed. */
  id: string;
  name: string;
  platform: "ios" | "android" | "web" | "desktop";
}

export interface OfflineSyncRequest {
  device: OfflineDevice;
  collections: OfflineCollectionRef[];
  /** Tracks already downloaded on this device. */
  trackIds: string[];
}

export interface OfflineSync {
  /**
   * not_subscribed: delete every download. device_removed: downloads were used on
   * too many other devices since this one last checked in, so delete them here.
   */
  status: "ok" | "not_subscribed" | "device_removed";
  checkedAt: string;
  /** Downloads play until then without checking in again. */
  validUntil: string | null;
  collections: OfflineCollection[];
  /** Collections that have gone, or can no longer be seen (a playlist made private). */
  unavailable: OfflineCollectionRef[];
  /** Every track this device may keep: the collections' tracks and any it has that are still live. */
  tracks: TrackSummary[];
  /** Tracks on the device that have been taken down or suspended. Delete them. */
  removedTrackIds: string[];
}

export interface DownloadAuthorization {
  downloads: {
    trackId: string;
    /** A signed link, valid until expiresAt: long enough to finish the download. */
    url: string;
    expiresAt: string;
    bytes: number;
    mimeType: string;
  }[];
  /** Tracks that can't be downloaded (taken down, or not found). */
  refusedTrackIds: string[];
}

// ---------------------------------------------------------------------------
// Account settings, reports and takedowns.

export interface SettingsResult {
  user: User;
  pendingEmail: string | null;
}

export type ReportTargetType = "track" | "release" | "artist" | "playlist" | "artwork";

/** "ai_label" reports go to the score review with appeals; the others go to the takedown queue. */
export type ReportReason = "copyright" | "offensive" | "impersonation" | "ai_label";

export type ReportStatus =
  /** Waiting for an admin. */
  | "open"
  /** An admin asked the reporter for more information. */
  | "needs_info"
  /** The content is down. The uploader can send a counter-notice. */
  | "taken_down"
  /** Not taken down. */
  | "rejected"
  /** The uploader disputes the takedown; an admin decides whether to put it back. */
  | "counter_notice"
  /** Taken down, then put back. */
  | "restored"
  /** A wrong-label report that's been reviewed. */
  | "resolved";

export type ReportMessageKind =
  | "info_request"
  | "reporter_reply"
  | "taken_down"
  | "rejected"
  | "counter_notice"
  | "restored"
  | "kept_down"
  | "label_reviewed";

/** What a valid copyright notice needs. */
export interface CopyrightNotice {
  /** The claimant owns the rights, or is authorised to act for whoever does. */
  role: "owner" | "agent";
  claimantName: string;
  organisation?: string;
  address: string;
  phone?: string;
  /** The original work: its title, who made it, and where it's published. */
  work: string;
  /** "I believe in good faith that this use isn't authorised by the owner, their agent or the law." */
  goodFaith: boolean;
  /** "The information in this notice is accurate, and I own the rights or may act for the owner." */
  accurate: boolean;
  /** The claimant's full name, typed as a signature. */
  signature: string;
}

export interface CounterNotice {
  /** The uploader's full name, typed as a signature. */
  name: string;
  explanation: string;
  /** "I believe in good faith this was taken down by mistake or because it was misidentified." */
  goodFaith: boolean;
  /** Agrees that Trusic may pass the counter-notice, with their name and email, to the person who reported it. */
  consentToShare: boolean;
  sentAt: string;
}

export interface ReportInput {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details: string;
  /** Needed when not signed in, so we can reply. */
  reporterName?: string;
  reporterEmail?: string;
  copyright?: CopyrightNotice;
}

export interface ReportReceipt {
  id: string;
  /** Short reference to quote, e.g. "3F2A9C1B". */
  reference: string;
}

/** Something that can be reported, as the report form shows it. */
export interface ReportTarget {
  type: ReportTargetType;
  id: string;
  title: string;
  /** e.g. "Track by The Hollow Pines". */
  description: string;
  /** Where it is in the web app. */
  path: string | null;
  /** Its artwork or photo, which can be reported on its own. */
  artwork: { name: string; url: string } | null;
}

export interface ReportMessage {
  id: string;
  kind: ReportMessageKind;
  from: "reporter" | "uploader" | "trusic";
  body: string;
  createdAt: string;
}

export interface AdminReport {
  id: string;
  reference: string;
  targetType: ReportTargetType;
  targetId: string;
  targetTitle: string;
  targetPath: string | null;
  /** Whether the reported content can be seen right now. */
  targetState: "live" | "taken_down" | "gone";
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  reporter: { userId: string | null; name: string | null; email: string | null };
  owner: { id: string; displayName: string; email: string; copyrightStrikes: number } | null;
  copyright: CopyrightNotice | null;
  counterNotice: CounterNotice | null;
  messages: ReportMessage[];
  /** For wrong-label reports: the track as it is now. */
  track: (TrackSummary & { declaredScore: number }) | null;
  createdAt: string;
  decidedAt: string | null;
}

/** A takedown of something the signed-in user uploaded. */
export interface MyTakedown {
  id: string;
  reference: string;
  targetType: ReportTargetType;
  targetTitle: string;
  reason: ReportReason;
  status: ReportStatus;
  /** For copyright: who complained and about which work. Their contact details stay private. */
  claimant: { name: string; organisation: string | null; work: string } | null;
  counterNotice: CounterNotice | null;
  /** What Trusic told the uploader: the reason for the takedown and any later decisions. */
  messages: ReportMessage[];
  createdAt: string;
  decidedAt: string | null;
}

/** An upheld copyright takedown. Separate from strikes for false AI declarations. */
export interface CopyrightStrike {
  id: string;
  reportId: string;
  targetTitle: string;
  reason: string;
  /** Withdrawn when the content was put back after a counter-notice. */
  withdrawn: boolean;
  createdAt: string;
}

export interface MyTakedowns {
  takedowns: MyTakedown[];
  copyrightStrikes: CopyrightStrike[];
  /** How many copyright strikes (not withdrawn) suspend an account. */
  strikesToSuspend: number;
}

export interface AdminCopyrightStrike {
  strike: CopyrightStrike;
  user: { id: string; email: string; displayName: string };
}

/** What a reporter sees when answering from the link in their email. */
export interface ReporterView {
  reference: string;
  targetTitle: string;
  status: ReportStatus;
  /** The latest question from Trusic, or the uploader's counter-notice. */
  question: string | null;
  canReply: boolean;
}

/** Everything Trusic holds about an account, as downloaded from Settings. */
export type DataExport = Record<string, unknown> & { exportedAt: string };
