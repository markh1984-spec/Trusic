import { randomBytes } from "node:crypto";
import path from "node:path";
import { loadS3Config, type S3Config } from "./storage";

export interface Config {
  port: number;
  host: string;
  /** Real Postgres in production. Unset = embedded Postgres in dataDir. */
  databaseUrl?: string;
  dataDir: string;
  /** Signs short-lived audio URLs. Must be stable across restarts in production. */
  streamSigningSecret: string;
  currency: string;
  /** Monthly premium revenue per subscriber, net of VAT and payment fees, in minor units (demo billing). */
  premiumMonthlyNetMinor: number;
  /** What a subscriber is charged per month, including VAT, in minor units. */
  premiumMonthlyPriceMinor: number;
  /** VAT included in prices, in basis points (2000 = 20%). Revenue is booked net of it. */
  vatRateBps: number;
  /** Stripe secret key. Unset = demo billing (no real payments). Use a test-mode key (sk_test_…). */
  stripeSecretKey?: string;
  /** Signing secret of the Stripe webhook endpoint (whsec_…). */
  stripeWebhookSecret?: string;
  /** Where the web app lives, for Stripe to send people back to. */
  publicUrl: string;
  /** Artists are paid once their available balance reaches this, in minor units. */
  payoutMinimumMinor: number;
  /** People who register with these emails become admins (review appeals, run payouts). */
  adminEmails: string[];
  /** Browser origins allowed to call the API directly. Empty = same-origin only. */
  corsOrigins: string[];
  maxUploadBytes: number;
  /** Whether anyone can create an account. Closed on public demos. */
  registrationOpen: boolean;
  /** Password for the demo accounts the seed script creates. */
  demoPassword: string;
  /** S3-compatible bucket for uploads, so they survive restarts. Null = files on local disk in dataDir. */
  s3: S3Config | null;
  /** ffmpeg, which converts uploads for streaming and resizes artwork. Null = off: files are served as uploaded. */
  ffmpegPath: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const dataDir = path.resolve(env.TRUSIC_DATA_DIR ?? ".data");
  const secret = env.STREAM_SIGNING_SECRET;
  if (production && !secret) throw new Error("STREAM_SIGNING_SECRET must be set in production");

  return {
    port: Number(env.PORT ?? 3001),
    host: env.HOST ?? "127.0.0.1",
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir,
    streamSigningSecret: secret ?? randomBytes(32).toString("hex"),
    currency: env.CURRENCY ?? "GBP",
    premiumMonthlyNetMinor: Number(env.PREMIUM_MONTHLY_NET_MINOR ?? 916),
    premiumMonthlyPriceMinor: Number(env.PREMIUM_MONTHLY_PRICE_MINOR ?? 1099),
    vatRateBps: Number(env.VAT_RATE_BPS ?? 2000),
    stripeSecretKey: env.STRIPE_SECRET_KEY || undefined,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || undefined,
    publicUrl: (env.PUBLIC_URL ?? "http://localhost:5173").replace(/\/$/, ""),
    payoutMinimumMinor: Number(env.PAYOUT_MINIMUM_MINOR ?? 1000),
    adminEmails: list(env.ADMIN_EMAILS),
    corsOrigins: list(env.CORS_ORIGINS),
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 200) * 1024 * 1024,
    registrationOpen: env.REGISTRATION !== "closed",
    demoPassword: env.DEMO_PASSWORD || "trusic-demo",
    s3: loadS3Config(env),
    ffmpegPath: env.FFMPEG_PATH === "off" ? null : env.FFMPEG_PATH || "ffmpeg",
  };
}

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
