import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Fetch } from "./app-protocol";
import { readJson, writeJson } from "./json-file";

/**
 * Downloads for listening offline, kept in the app's own folder (userData/offline). The web app decides
 * what to download and asks for it through the preload bridge; this keeps the files and serves them to
 * the app:// handler.
 *
 *   device.json     this computer's id for downloads, made up once
 *   manifest.json   what's downloaded and until when it may play, saved by the web app
 *   files.json      each audio file's size and type
 *   audio/<id>      the audio, named by track id with no extension (not a plain music file)
 *   images/<name>   artwork for downloaded tracks, so pages look right offline
 *
 * Nothing here imports Electron, so it can be tested with plain Node.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STREAM_PATH = /^\/api\/stream\/([0-9a-f-]{36})\?[^#]*$/;
const IMAGE_PATH = /^\/api\/images\/([0-9a-f-]{36}\.(png|jpg|webp))$/;
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
/** Bigger than any upload the server accepts. */
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
/** The web app's list of downloads is small JSON; this stops a page filling the disk through it. */
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;

export interface CachedFile {
  file: string;
  size: number;
  mimeType: string;
}

/** What the web app saves: only the parts this side reads are checked. */
interface Manifest {
  version: 1;
  accountId: string;
  validUntil: string | null;
  tracks: Record<string, { track?: { artworkUrl?: string | null } }>;
}

export type DownloadResult =
  { ok: true; bytes: number } | { ok: false; offline: boolean; status: number; message: string };

export interface OfflineStoreOptions {
  dir: string;
  /** The Trusic server, like "http://localhost:3001". */
  serverUrl: () => string;
  fetch: Fetch;
  now?: () => number;
}

export class OfflineStore {
  private readonly dir: string;
  private manifest: Manifest | null;
  private files: Record<string, { bytes: number; mimeType: string }>;
  private readonly now: () => number;

  constructor(private readonly options: OfflineStoreOptions) {
    this.dir = options.dir;
    this.now = options.now ?? Date.now;
    this.manifest = asManifest(readJson(this.path("manifest.json")));
    const files = readJson(this.path("files.json"));
    this.files = files && typeof files === "object" ? (files as typeof this.files) : {};
  }

  private path(...parts: string[]) {
    return path.join(this.dir, ...parts);
  }

  /** This computer's id for downloads. Kept when downloads are deleted, so the server recognises it. */
  deviceId(): string {
    const saved = readJson(this.path("device.json")) as { id?: unknown } | undefined;
    if (typeof saved?.id === "string" && saved.id.length >= 8) return saved.id;
    const id = `desktop-${randomUUID()}`;
    writeJson(this.path("device.json"), { id });
    return id;
  }

  readManifest(): unknown {
    return this.manifest;
  }

  saveManifest(value: unknown): void {
    if (value === null) {
      this.manifest = null;
      rmSync(this.path("manifest.json"), { force: true });
      return;
    }
    const manifest = asManifest(value);
    if (!manifest) throw new Error("That isn't a list of downloads.");
    if (JSON.stringify(manifest).length > MAX_MANIFEST_BYTES) throw new Error("The list of downloads is too big.");
    this.manifest = manifest;
    writeJson(this.path("manifest.json"), manifest);
  }

  /**
   * Download a track from a signed link the server gave the web app, plus its artwork. Only links to this
   * server's audio and images are followed. Written to a temporary file first, so a download cut short is
   * never mistaken for a whole one.
   */
  async download(trackId: string, url: string, artworkUrl: string | null): Promise<DownloadResult> {
    const match = STREAM_PATH.exec(url);
    if (!UUID.test(trackId) || !match || match[1] !== trackId) {
      return { ok: false, offline: false, status: 400, message: "That isn't a Trusic download link." };
    }
    mkdirSync(this.path("audio"), { recursive: true });
    const target = this.path("audio", trackId);
    const partial = `${target}.part`;
    let response: Response;
    try {
      response = await this.options.fetch(this.options.serverUrl() + url, { method: "GET" });
    } catch (error) {
      return { ok: false, offline: true, status: 0, message: error instanceof Error ? error.message : String(error) };
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      const offline = response.status === 502 || response.status === 503 || response.status === 504;
      return { ok: false, offline, status: response.status, message: `The server said ${response.status}.` };
    }
    const mimeType = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim();
    try {
      let bytes = 0;
      const body = Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>);
      body.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_FILE_BYTES) body.destroy(new Error("That file is too big."));
      });
      await pipeline(body, createWriteStream(partial));
      renameSync(partial, target);
      this.files[trackId] = { bytes, mimeType };
      writeJson(this.path("files.json"), this.files);
    } catch (error) {
      rmSync(partial, { force: true });
      return { ok: false, offline: true, status: 0, message: error instanceof Error ? error.message : String(error) };
    }
    if (artworkUrl) await this.downloadImage(artworkUrl);
    return { ok: true, bytes: this.files[trackId]!.bytes };
  }

  private async downloadImage(url: string) {
    const match = IMAGE_PATH.exec(url);
    if (!match) return;
    const target = this.path("images", match[1]!);
    if (existsSync(target)) return;
    try {
      const response = await this.options.fetch(this.options.serverUrl() + url, { method: "GET" });
      if (!response.ok || !response.body) return;
      mkdirSync(this.path("images"), { recursive: true });
      const partial = `${target}.part`;
      await pipeline(
        Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>),
        createWriteStream(partial),
      );
      renameSync(partial, target);
    } catch {
      // Artwork is a nicety: the track still plays without it.
    }
  }

  remove(trackIds: string[]): void {
    for (const id of trackIds) {
      if (!UUID.test(id)) continue;
      rmSync(this.path("audio", id), { force: true });
      delete this.files[id];
    }
    writeJson(this.path("files.json"), this.files);
  }

  /** Delete every download (signing out, the subscription ending, or changing server). The device id stays. */
  removeAll(): void {
    for (const name of ["audio", "images"]) rmSync(this.path(name), { recursive: true, force: true });
    rmSync(this.path("manifest.json"), { force: true });
    this.files = {};
    this.manifest = null;
    writeJson(this.path("files.json"), this.files);
  }

  /** Delete audio that isn't in `keep`, and artwork no downloaded track uses. */
  prune(keep: string[]): void {
    const wanted = new Set(keep);
    for (const name of listDir(this.path("audio"))) {
      const id = name.replace(/\.part$/, "");
      if (!wanted.has(id) || name.endsWith(".part")) rmSync(this.path("audio", name), { force: true });
    }
    for (const id of Object.keys(this.files)) if (!wanted.has(id)) delete this.files[id];
    writeJson(this.path("files.json"), this.files);

    const artwork = new Set(
      Object.values(this.manifest?.tracks ?? {})
        .map((t) => IMAGE_PATH.exec(t.track?.artworkUrl ?? "")?.[1])
        .filter(Boolean),
    );
    for (const name of listDir(this.path("images"))) {
      if (!artwork.has(name)) rmSync(this.path("images", name), { force: true });
    }
  }

  /** A downloaded track that may play now: in the list of downloads, checked within 30 days, and on disk. */
  track(trackId: string): CachedFile | null {
    const m = this.manifest;
    if (!m?.validUntil || this.now() >= Date.parse(m.validUntil) || !m.tracks[trackId]) return null;
    const meta = this.files[trackId];
    if (!meta || !UUID.test(trackId)) return null;
    const file = this.path("audio", trackId);
    const size = fileSize(file);
    return size === null ? null : { file, size, mimeType: meta.mimeType };
  }

  /** Saved artwork, by its name in /api/images/<name>. */
  image(name: string): CachedFile | null {
    const match = IMAGE_PATH.exec(`/api/images/${name}`);
    if (!match) return null;
    const file = this.path("images", match[1]!);
    const size = fileSize(file);
    return size === null ? null : { file, size, mimeType: IMAGE_TYPES[match[2]!]! };
  }
}

function asManifest(value: unknown): Manifest | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Partial<Manifest>;
  if (m.version !== 1 || typeof m.accountId !== "string") return null;
  if (m.validUntil !== null && typeof m.validUntil !== "string") return null;
  if (!m.tracks || typeof m.tracks !== "object") return null;
  return value as Manifest;
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function fileSize(file: string): number | null {
  try {
    const info = statSync(file);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}
