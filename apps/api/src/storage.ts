import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import path from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError } from "./errors";
import { EMPTY_SHA256, signRequest, uriEncode } from "./sigv4";

/**
 * Where uploaded files (audio and images) live: local disk by default, or an S3-compatible bucket (Supabase
 * Storage, Cloudflare R2, Backblaze B2, MinIO) so they survive restarts on hosting without a lasting disk.
 *
 * Files are always streamed to listeners through the API's own signed URLs rather than straight from the bucket,
 * so previews stay limited to 30 seconds and the desktop app's app:// proxy keeps working.
 */
export interface MediaStorage {
  /** Where files are kept, for the logs. */
  readonly description: string;
  /** A fresh path on local disk to write a file to before it is stored. */
  tempPath(): Promise<string>;
  /** Move a local file (usually from `tempPath`) into storage under `key`. */
  save(key: string, tempPath: string): Promise<void>;
  size(key: string): Promise<number>;
  /** `end` is inclusive, as in HTTP Range headers. */
  read(key: string, range?: { start: number; end: number }): Readable;
  remove(key: string): Promise<void>;
  /** Run `use` with the stored file at a local path (downloaded first if storage is remote, and removed after). */
  withLocalCopy<T>(key: string, use: (filePath: string) => Promise<T>): Promise<T>;
  /** Check files can be stored and read back. Throws a helpful message if not. */
  check(): Promise<void>;
}

export class LocalMediaStorage implements MediaStorage {
  readonly description: string;

  constructor(private readonly root: string) {
    this.description = `the folder ${root}`;
  }

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

  async withLocalCopy<T>(key: string, use: (filePath: string) => Promise<T>): Promise<T> {
    const filePath = this.resolve(key);
    await stat(filePath);
    return use(filePath);
  }

  async check(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }
}

export interface S3Config {
  /** e.g. "https://abcd.storage.supabase.co/storage/v1/s3", "https://<account>.r2.cloudflarestorage.com". */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const S3_SETTINGS = {
  endpoint: "S3_ENDPOINT",
  bucket: "S3_BUCKET",
  accessKeyId: "S3_ACCESS_KEY_ID",
  secretAccessKey: "S3_SECRET_ACCESS_KEY",
} as const;

/** S3 settings from the environment, or null to use local disk. Half-filled settings are an error, not a fallback. */
export function loadS3Config(env: NodeJS.ProcessEnv): S3Config | null {
  const names = Object.values(S3_SETTINGS);
  if (!names.some((name) => env[name]?.trim())) return null;
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(
      `To keep files in S3-compatible storage, also set ${missing.join(", ")} (or remove the S3_ settings).`,
    );
  }
  const endpoint = env.S3_ENDPOINT!.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(endpoint))
    throw new Error(`S3_ENDPOINT must be a web address starting with https:// (it's "${endpoint}").`);
  return {
    endpoint,
    region: env.S3_REGION?.trim() || "us-east-1",
    bucket: env.S3_BUCKET!.trim(),
    accessKeyId: env.S3_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!.trim(),
  };
}

export class StorageError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".aiff": "audio/aiff",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

/** Network errors worth one more try: usually a kept-alive connection the server had already closed. */
const RETRYABLE = new Set(["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_SOCKET"]);

/**
 * Files in an S3-compatible bucket, addressed path-style (https://endpoint/bucket/key), which all the stores
 * above accept. Uploads are sent with their SHA-256, the most widely supported way of signing a body.
 */
export class S3MediaStorage implements MediaStorage {
  readonly description: string;
  private readonly base: URL;
  private readonly agent: http.Agent;

  constructor(
    private readonly config: S3Config,
    /** Local folder for temporary files. */
    private readonly tempDir: string,
  ) {
    this.base = new URL(config.endpoint);
    this.agent = new (this.base.protocol === "https:" ? https : http).Agent({ keepAlive: true, maxSockets: 16 });
    this.description = `the "${config.bucket}" bucket at ${this.base.host}`;
  }

  private url(key: string): URL {
    const prefix = this.base.pathname.replace(/\/+$/, "");
    const encoded = [this.config.bucket, ...key.split("/")].map(uriEncode).join("/");
    return new URL(`${this.base.origin}${prefix}/${encoded}`);
  }

  /** Start a signed request. The caller reads the response (and must consume or destroy it). */
  private start(
    method: string,
    key: string,
    options: { headers?: Record<string, string>; body?: () => Readable; payloadHash?: string; length?: number } = {},
  ) {
    const url = this.url(key);
    const headers = signRequest(this.config, {
      method,
      url,
      headers: options.headers,
      payloadHash: options.payloadHash ?? EMPTY_SHA256,
    });
    if (options.length !== undefined) headers["content-length"] = String(options.length);
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, { method, headers, agent: this.agent, timeout: 60_000 });
    const response = new Promise<IncomingMessage>((resolve, reject) => {
      req.on("response", resolve);
      req.on("error", reject);
    });
    req.on("timeout", () =>
      req.destroy(Object.assign(new Error(`Storage timed out: ${method} ${key}`), { code: "ETIMEDOUT" })),
    );
    if (options.body) {
      const body = options.body();
      body.on("error", (error) => req.destroy(error));
      body.pipe(req);
    } else {
      req.end();
    }
    return { req, response };
  }

  /** A complete request, retried once on a network error. Fails with a StorageError unless the status is in `ok`. */
  private async send(
    method: string,
    key: string,
    ok: number[],
    options: Parameters<S3MediaStorage["start"]>[2] = {},
  ): Promise<IncomingMessage> {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.start(method, key, options).response;
        if (!ok.includes(res.statusCode ?? 0)) throw await storageError(res, method, key);
        return res;
      } catch (error) {
        const code = (error as { code?: string }).code ?? "";
        if (attempt >= 2 || error instanceof StorageError || !RETRYABLE.has(code)) throw error;
      }
    }
  }

  async tempPath(): Promise<string> {
    await mkdir(this.tempDir, { recursive: true });
    return path.join(this.tempDir, randomUUID());
  }

  async save(key: string, tempPath: string): Promise<void> {
    const { size } = await stat(tempPath);
    const hash = createHash("sha256");
    await pipeline(createReadStream(tempPath), hash);
    const contentType = CONTENT_TYPES[path.extname(key)] ?? "application/octet-stream";
    try {
      const res = await this.send("PUT", key, [200], {
        headers: { "content-type": contentType },
        body: () => createReadStream(tempPath),
        payloadHash: hash.digest("hex"),
        length: size,
      });
      res.resume();
    } catch (error) {
      if (error instanceof StorageError && (error.status === 413 || error.code === "EntityTooLarge")) {
        throw new HttpError(
          413,
          `That file is too large for this site's file storage (it's ${Math.round(size / 1024 / 1024)} MB). Try a FLAC or MP3 version.`,
        );
      }
      throw error;
    }
    await rm(tempPath, { force: true });
  }

  async size(key: string): Promise<number> {
    const res = await this.send("HEAD", key, [200]);
    res.resume();
    return Number(res.headers["content-length"]);
  }

  read(key: string, range?: { start: number; end: number }): Readable {
    const out = new PassThrough();
    const { req, response } = this.start("GET", key, {
      headers: range ? { range: `bytes=${range.start}-${range.end}` } : {},
    });
    // A listener who skips or closes the page stops the download from storage too.
    out.on("close", () => {
      if (!out.readableEnded) req.destroy();
    });
    response.then(
      async (res) => {
        if (res.statusCode !== 200 && res.statusCode !== 206) return out.destroy(await storageError(res, "GET", key));
        pipeline(res, out).catch(() => undefined);
      },
      (error: Error) => out.destroy(error),
    );
    return out;
  }

  async remove(key: string): Promise<void> {
    const res = await this.send("DELETE", key, [200, 202, 204, 404]);
    res.resume();
  }

  async withLocalCopy<T>(key: string, use: (filePath: string) => Promise<T>): Promise<T> {
    const filePath = await this.tempPath();
    try {
      const res = await this.send("GET", key, [200]);
      await pipeline(res, createWriteStream(filePath));
      return await use(filePath);
    } finally {
      await rm(filePath, { force: true });
    }
  }

  async check(): Promise<void> {
    const key = `.trusic-check/${randomUUID()}`;
    const probe = await this.tempPath();
    try {
      await writeFile(probe, "Trusic checks it can store files here.");
      await this.save(key, probe);
      await this.size(key);
      await this.remove(key);
    } catch (error) {
      throw new Error(
        `Can't store files in ${this.description}: ${(error as Error).message}. Check the S3_ settings (endpoint, region, bucket name and keys).`,
        { cause: error },
      );
    } finally {
      await rm(probe, { force: true });
    }
  }
}

async function storageError(res: IncomingMessage, method: string, key: string): Promise<StorageError> {
  let body = "";
  res.setEncoding("utf8");
  for await (const chunk of res) if (body.length < 8192) body += chunk;
  const status = res.statusCode ?? 0;
  const code = /<Code>([^<]*)<\/Code>/.exec(body)?.[1] ?? (status === 404 ? "NotFound" : `HTTP${status}`);
  const detail = /<Message>([^<]*)<\/Message>/.exec(body)?.[1];
  return new StorageError(status, code, `${method} ${key}: ${status} ${code}${detail ? ` (${detail})` : ""}`);
}

/** S3-compatible storage when it's configured, otherwise the local data folder. */
export function createStorage(config: { dataDir: string; s3: S3Config | null }): MediaStorage {
  return config.s3
    ? new S3MediaStorage(config.s3, path.join(config.dataDir, "tmp"))
    : new LocalMediaStorage(path.join(config.dataDir, "media"));
}
