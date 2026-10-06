import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import { migrationsDir as migrationsFolder } from "../paths";
import * as schema from "./schema";

/**
 * Both drivers expose the same Drizzle query builder. We type against the
 * PGlite flavour so app code doesn't care which one is running.
 */
export type Db = PgliteDatabase<typeof schema>;
/** A transaction handle, usable wherever a query only needs `select`/`insert`/`update`/`delete`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Database {
  db: Db;
  close(): Promise<void>;
}

/**
 * With a DATABASE_URL, connect to real Postgres (production).
 * Without one, run embedded Postgres (PGlite): on disk in `dataDir`, or in memory for tests.
 * Migrations run on open, either way.
 */
export async function openDatabase(opts: { url?: string; dataDir?: string }): Promise<Database> {
  if (opts.url) {
    const pool = new pg.Pool({ connectionString: opts.url });
    const db = drizzlePg({ client: pool, schema });
    await migratePg(db, { migrationsFolder });
    return { db: db as unknown as Db, close: () => pool.end() };
  }
  if (opts.dataDir) await mkdir(path.dirname(opts.dataDir), { recursive: true });
  const client = new PGlite(opts.dataDir);
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
