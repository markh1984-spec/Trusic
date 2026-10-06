import { randomBytes } from "node:crypto";
import path from "node:path";

export interface Config {
  port: number;
  host: string;
  /** Real Postgres in production. Unset = embedded Postgres in dataDir. */
  databaseUrl?: string;
  dataDir: string;
  /** Signs short-lived audio URLs. Must be stable across restarts in production. */
  streamSigningSecret: string;
  currency: string;
  /** Monthly premium revenue per subscriber, net of VAT and payment fees, in minor units. */
  premiumMonthlyNetMinor: number;
  /** People who register with these emails become admins (review appeals, run payouts). */
  adminEmails: string[];
  /** Browser origins allowed to call the API directly. Empty = same-origin only. */
  corsOrigins: string[];
  maxUploadBytes: number;
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
    adminEmails: list(env.ADMIN_EMAILS),
    corsOrigins: list(env.CORS_ORIGINS),
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 200) * 1024 * 1024,
  };
}

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
