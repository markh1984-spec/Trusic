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
  plan: "free" | "premium";
}

export interface ArtistRef {
  id: string;
  name: string;
  slug: string;
}

export interface Artist extends ArtistRef {
  bio: string;
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

export interface TrackSummary {
  id: string;
  title: string;
  genre: string | null;
  durationMs: number;
  artist: ArtistRef;
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

export interface Subscription {
  user: User;
  priceMinor: number;
  currency: string;
}
