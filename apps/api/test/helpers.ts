import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AiDeclaration, StageDeclaration } from "@trusic/core";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { openDatabase, type Database } from "../src/db/client";
import { MetadataDetector } from "../src/detection";
import { LocalAudioStorage } from "../src/storage";
import { synthWav } from "../src/synth";

export const ADMIN_EMAIL = "admin@trusic.test";

export interface TestApp {
  app: FastifyInstance;
  database: Database;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const dir = await mkdtemp(path.join(tmpdir(), "trusic-test-"));
  const config = loadConfig({ ADMIN_EMAILS: ADMIN_EMAIL, TRUSIC_DATA_DIR: dir });
  const database = await openDatabase({});
  const app = await buildApp({
    db: database.db,
    storage: new LocalAudioStorage(path.join(dir, "audio")),
    detector: new MetadataDetector(),
    config,
  });
  return {
    app,
    database,
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
export function multipart(fields: Record<string, string>, file?: { name: string; filename: string; data: Buffer }) {
  const boundary = `----trusic${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: audio/wav\r\n\r\n`,
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
