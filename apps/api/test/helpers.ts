import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AiDeclaration, StageDeclaration } from "@trusic/core";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { openDatabase, type Database } from "../src/db/client";
import { users } from "../src/db/schema";
import { MetadataDetector } from "../src/detection";
import { MemoryMailer } from "../src/mailer";
import { LocalMediaStorage } from "../src/storage";
import { synthPng, synthWav } from "../src/synth";

export const ADMIN_EMAIL = "admin@trusic.test";

export interface TestApp {
  app: FastifyInstance;
  database: Database;
  /** Every email the app has "sent". */
  mailer: MemoryMailer;
  close(): Promise<void>;
}

export async function createTestApp(
  options: { env?: Record<string, string>; stripe?: Stripe | null } = {},
): Promise<TestApp> {
  const dir = await mkdtemp(path.join(tmpdir(), "trusic-test-"));
  const config = loadConfig({
    ADMIN_EMAILS: ADMIN_EMAIL,
    TRUSIC_DATA_DIR: dir,
    PUBLIC_URL: "https://trusic.test",
    ...options.env,
  });
  const database = await openDatabase({});
  const mailer = new MemoryMailer();
  const app = await buildApp({
    db: database.db,
    storage: new LocalMediaStorage(path.join(dir, "media")),
    detector: new MetadataDetector(),
    config,
    stripe: options.stripe ?? null,
    mailer,
  });
  return {
    app,
    database,
    mailer,
    async close() {
      await app.close();
      await database.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export function declaration(
  stages: Partial<Record<keyof AiDeclaration["stages"], StageDeclaration>> = {},
): AiDeclaration {
  return {
    stages: {
      composition: "none",
      lyrics: "none",
      vocals: "none",
      instrumentation: "none",
      production: "none",
      ...stages,
    },
    assistiveTools: [],
    toolsUsed: [],
  };
}

/** Build a multipart body by hand so tests don't need a form-data library. */
export function multipart(
  fields: Record<string, string>,
  file?: { name: string; filename: string; data: Buffer; contentType?: string },
) {
  const boundary = `----trusic${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType ?? "audio/wav"}\r\n\r\n`,
      ),
      file.data,
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

export const wav = (options: { seconds?: number; seed?: number; comment?: string } = {}) =>
  synthWav({ seconds: options.seconds ?? 40, sampleRate: 8000, seed: options.seed, comment: options.comment });

export const png = (seed = 1) => synthPng({ size: 32, seed });

/** Call the API in tests. Throws on unexpected status codes so failures point at the call. */
export async function call<T = unknown>(
  t: TestApp,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  token?: string,
  body?: unknown,
) {
  const res = await t.app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, body: (res.body ? res.json() : null) as T, headers: res.headers };
}

/** Sign up. The account's email counts as confirmed unless `verified` is false, so it can upload straight away. */
export async function register(t: TestApp, email: string, options: { verified?: boolean } = {}) {
  const res = await call<{ token: string; user: { id: string } }>(t, "POST", "/api/auth/register", undefined, {
    email,
    password: "correct horse battery",
    displayName: email.split("@")[0],
  });
  if (res.status !== 201) throw new Error(`register ${email}: ${res.status}`);
  if (options.verified !== false) await confirmEmail(t, res.body.user.id);
  return { token: res.body.token, id: res.body.user.id };
}

/** Mark an account's email as confirmed, as if they'd clicked the link. */
export async function confirmEmail(t: TestApp, userId: string) {
  await t.database.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
}

/** The latest email sent to `to`, waiting briefly for ones sent after the reply. */
export async function lastEmail(t: TestApp, to: string, subject?: RegExp) {
  for (let i = 0; i < 50; i++) {
    const found = t.mailer.sent.findLast((m) => m.to === to && (!subject || subject.test(m.subject)));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No email to ${to}${subject ? ` matching ${subject}` : ""}`);
}

/** The first link in an email that starts with `prefix`. */
export function linkIn(email: { text: string }, prefix: string): string {
  const match = email.text.match(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\S+`));
  if (!match) throw new Error(`No link starting ${prefix} in:\n${email.text}`);
  return match[0];
}

export async function sendFile(
  t: TestApp,
  method: "POST" | "PUT",
  url: string,
  token: string,
  fields: Record<string, string>,
  file: { name: string; filename: string; data: Buffer; contentType?: string },
) {
  const form = multipart(fields, file);
  const res = await t.app.inject({
    method,
    url,
    headers: { ...form.headers, authorization: `Bearer ${token}` },
    payload: form.payload,
  });
  return { status: res.statusCode, body: res.json() as never };
}
