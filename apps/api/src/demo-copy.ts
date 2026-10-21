import { copyFile, readdir } from "node:fs/promises";
import path from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import type { MediaStorage } from "./storage";

/**
 * Copy demo data from one database (and media folder) to another. The Docker image is built with the demo data
 * already made, its audio converted at full speed; a site with a database that lasts (Supabase, say) copies it in
 * when it first starts, rather than making it all again on a tenth of a processor, which takes half an hour.
 */

/** Every table, each after the tables it refers to, so rows can be inserted in this order. */
export function tablesInOrder(): PgTable[] {
  const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable => is(value, PgTable));
  const ordered: PgTable[] = [];
  const visiting = new Set<PgTable>();
  const visit = (table: PgTable) => {
    if (ordered.includes(table)) return;
    if (visiting.has(table)) throw new Error(`Tables refer to each other in a loop: ${getTableConfig(table).name}`);
    visiting.add(table);
    for (const fk of getTableConfig(table).foreignKeys) {
      const parent = fk.reference().foreignTable;
      if (parent !== table) visit(parent);
    }
    visiting.delete(table);
    ordered.push(table);
  };
  tables.forEach(visit);
  return ordered;
}

/** Every file under `root`, as storage keys ("images/<uuid>.png"). Unfinished uploads are skipped. */
async function listFiles(root: string, dir = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true }).catch(() => []);
  const keys: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const key = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) keys.push(...(await listFiles(root, key)));
    else if (entry.isFile()) keys.push(key);
  }
  return keys;
}

const BATCH = 500;

/**
 * Copy the files in `mediaDir` into `storage` (if given), then every row from `source` into `target`, in one
 * transaction: if anything goes wrong, the target database is left empty and the next start tries again.
 */
export async function copyDemoData(options: {
  source: Db;
  target: Db;
  mediaDir: string;
  /** Where files go; null if they're already where the target expects them. */
  storage: MediaStorage | null;
  log?: (message: string) => void;
}): Promise<{ rows: number; files: number }> {
  const log = options.log ?? (() => {});
  let files = 0;
  if (options.storage) {
    const keys = await listFiles(options.mediaDir);
    log(`Copying ${keys.length} files to ${options.storage.description}…`);
    for (const key of keys) {
      // save() moves its file into storage, so give it a copy.
      const temp = await options.storage.tempPath();
      await copyFile(path.join(options.mediaDir, key), temp);
      await options.storage.save(key, temp);
      files++;
    }
  }

  let rows = 0;
  await options.target.transaction(async (tx) => {
    for (const table of tablesInOrder()) {
      const all = await options.source.select().from(table);
      for (let i = 0; i < all.length; i += BATCH) await tx.insert(table).values(all.slice(i, i + BATCH));
      rows += all.length;
    }
  });
  log(`Copied ${rows} rows.`);
  return { rows, files };
}
