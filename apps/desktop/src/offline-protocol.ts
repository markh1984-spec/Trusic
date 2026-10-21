import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { Handler } from "./app-protocol";
import { UNREACHABLE_HEADER } from "./app-protocol";
import type { CachedFile } from "./offline-store";

/** What the app:// handler needs from the downloads. */
export interface OfflineCache {
  track(trackId: string): CachedFile | null;
  image(name: string): CachedFile | null;
}

const STREAM = /^\/api\/stream\/([0-9a-f-]{36})$/;
const STREAM_URL = /^\/api\/tracks\/([0-9a-f-]{36})\/stream$/;
const IMAGE = /^\/api\/images\/([^/]+)$/;

/**
 * Put downloads in front of the app:// handler:
 *
 * - Audio for a downloaded track comes from disk, online or not, with Range support for seeking.
 *   Previews never do: someone whose subscription has ended hears the server's preview, as anyone would.
 * - Downloaded tracks' artwork comes from disk too.
 * - When the server can't be reached, the web app's request for a stream link is answered here for
 *   downloaded tracks, pointing at the local copy. The player then works as it always does.
 *
 * `onReachable` hears whether each request to the server got through, so the app knows when it's offline.
 */
export function withOfflineCache(handler: Handler, cache: OfflineCache, onReachable: (ok: boolean) => void): Handler {
  return async (request) => {
    const url = new URL(request.url);
    const reading = request.method === "GET" || request.method === "HEAD";
    if (reading) {
      const stream = STREAM.exec(url.pathname);
      if (stream && url.searchParams.get("preview") !== "1") {
        const hit = cache.track(stream[1]!);
        if (hit) return serveCached(hit, request, "private, no-store");
      }
      const image = IMAGE.exec(url.pathname);
      if (image) {
        const hit = cache.image(image[1]!);
        if (hit) return serveCached(hit, request, "public, max-age=31536000, immutable");
      }
    }

    const response = await handler(request);
    if (url.pathname.startsWith("/api/")) {
      const unreachable = response.headers.get(UNREACHABLE_HEADER) === "1";
      onReachable(!unreachable);
      const wanted = unreachable && request.method === "GET" ? STREAM_URL.exec(url.pathname) : null;
      if (wanted && cache.track(wanted[1]!)) {
        await response.body?.cancel().catch(() => undefined);
        return Response.json({
          url: `/api/stream/${wanted[1]}?offline=1`,
          expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
          preview: false,
          previewMs: null,
        });
      }
    }
    return response;
  };
}

/** A file from disk, honouring a single-range `Range` header as the server does. */
export function serveCached(hit: CachedFile, request: Request, cacheControl: string): Response {
  const headers = new Headers({
    "content-type": hit.mimeType,
    "accept-ranges": "bytes",
    "cache-control": cacheControl,
  });
  const header = request.headers.get("range");
  let start = 0;
  let end = hit.size - 1;
  let status = 200;
  if (header) {
    const range = parseRange(header, hit.size);
    if (!range) {
      headers.set("content-range", `bytes */${hit.size}`);
      return new Response(null, { status: 416, headers });
    }
    ({ start, end } = range);
    status = 206;
    headers.set("content-range", `bytes ${start}-${end}/${hit.size}`);
  }
  headers.set("content-length", String(end - start + 1));
  if (request.method === "HEAD" || hit.size === 0) return new Response(null, { status, headers });
  const body = Readable.toWeb(createReadStream(hit.file, { start, end })) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}

/** Parse `bytes=start-end`, `bytes=start-` or `bytes=-suffix`. Null if it can't be satisfied. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return { start, end };
}
