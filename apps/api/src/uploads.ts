import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { FastifyRequest } from "fastify";
import { HttpError } from "./errors";
import type { MediaStorage } from "./storage";

export interface ReceivedUpload {
  fields: Record<string, string>;
  /** Where the file was written. Gone once `storage.save` has moved it. */
  filePath: string | null;
}

/**
 * Read a multipart request with at most one file, in `fileField`, written to a
 * temp file. The temp file is always cleaned up after `handle` finishes.
 */
export async function withUpload<T>(
  request: FastifyRequest,
  storage: MediaStorage,
  fileField: string,
  handle: (upload: ReceivedUpload) => Promise<T>,
): Promise<T> {
  const fields: Record<string, string> = {};
  let filePath: string | null = null;
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== fileField || filePath) {
          part.file.resume();
          throw new HttpError(400, `Send exactly one file, in a field named "${fileField}".`);
        }
        filePath = await storage.tempPath();
        await pipeline(part.file, createWriteStream(filePath));
        if (part.file.truncated) throw new HttpError(413, "That file is too large.");
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    return await handle({ fields, filePath });
  } finally {
    // After a successful save the temp file has been moved, so this is a no-op.
    if (filePath) await rm(filePath, { force: true });
  }
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_TYPES = [
  {
    ext: "png",
    mime: "image/png",
    matches: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  },
  { ext: "jpg", mime: "image/jpeg", matches: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: "webp",
    mime: "image/webp",
    matches: (b: Buffer) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  },
] as const;

export const IMAGE_MIME_BY_EXT: Record<string, string> = Object.fromEntries(IMAGE_TYPES.map((t) => [t.ext, t.mime]));

/**
 * Check an uploaded file really is a PNG, JPEG or WebP (by its bytes, not its
 * name), store it under a fresh key and return the key. A new key per upload
 * means image URLs can be cached forever.
 */
export async function storeImage(storage: MediaStorage, filePath: string | null): Promise<string> {
  if (!filePath) throw new HttpError(400, 'Attach an image in a field named "image".');
  const handle = await open(filePath, "r");
  let header: Buffer;
  let size: number;
  try {
    size = (await handle.stat()).size;
    header = Buffer.alloc(12);
    await handle.read(header, 0, 12, 0);
  } finally {
    await handle.close();
  }
  if (size > MAX_IMAGE_BYTES) throw new HttpError(413, "Images must be 10 MB or smaller.");
  const type = IMAGE_TYPES.find((t) => t.matches(header));
  if (!type) throw new HttpError(415, "Images must be PNG, JPEG or WebP.");
  const key = `images/${randomUUID()}.${type.ext}`;
  await storage.save(key, filePath);
  return key;
}

/** Public URL for a stored image key ("images/<uuid>.png" → "/api/images/<uuid>.png"). */
export const imageUrl = (key: string | null): string | null => (key ? `/api/${key}` : null);
