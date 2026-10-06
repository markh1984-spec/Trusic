import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

/**
 * Where audio files live. Local disk for development; an S3-compatible bucket
 * behind a CDN is the production plan, behind this same interface.
 */
export interface AudioStorage {
  /** A fresh path to write an incoming upload to before it is validated. */
  tempPath(): Promise<string>;
  /** Move a validated temp file into storage under `key`. */
  save(key: string, tempPath: string): Promise<void>;
  size(key: string): Promise<number>;
  /** `end` is inclusive, as in HTTP Range headers. */
  read(key: string, range?: { start: number; end: number }): Readable;
  remove(key: string): Promise<void>;
}

export class LocalAudioStorage implements AudioStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error(`invalid storage key ${key}`);
    return full;
  }

  async tempPath(): Promise<string> {
    const dir = path.join(this.root, ".incoming");
    await mkdir(dir, { recursive: true });
    return path.join(dir, randomUUID());
  }

  async save(key: string, tempPath: string): Promise<void> {
    const dest = this.resolve(key);
    await mkdir(path.dirname(dest), { recursive: true });
    await rename(tempPath, dest);
  }

  async size(key: string): Promise<number> {
    return (await stat(this.resolve(key))).size;
  }

  read(key: string, range?: { start: number; end: number }): Readable {
    return createReadStream(this.resolve(key), range);
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
