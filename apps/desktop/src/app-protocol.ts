import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The web app runs at app://trusic/ inside the desktop app. Its relative URLs ("/api/me",
 * "/api/stream/<id>?expires=…&sig=…", "/assets/index.js") then work unchanged:
 *
 * - app://trusic/api/… is forwarded to the Trusic server, with method, headers (Authorization, Range…)
 *   and body passed through and the response streamed back, including 206 Partial Content for seeking.
 * - Everything else is a file from the built web app, with index.html for unknown paths so routes like
 *   /release/123 survive a reload.
 *
 * Nothing here imports Electron, so it can be tested with plain Node.
 */
export const APP_SCHEME = "app";
export const APP_HOST = "trusic";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Small pages that belong to the desktop app itself, like the Server… window. */
export const DESKTOP_HOST = "desktop";
export const DESKTOP_ORIGIN = `${APP_SCHEME}://${DESKTOP_HOST}`;

/**
 * Content-Security-Policy for the bundled web app. Audio and artwork may move to a CDN later, so media and
 * images may also come from any https address.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export type ProxyRequestInit = RequestInit & { duplex?: "half" };
/** Electron's net.fetch in the app, the global fetch in tests. */
export type Fetch = (url: string, init: ProxyRequestInit) => Promise<Response>;
export type Handler = (request: Request) => Promise<Response>;

export interface WebAppOptions {
  /** Folder holding the built web app (index.html and assets/). */
  webRoot: string;
  /** The Trusic server, like "http://localhost:3001". Read on every request, so a change applies at once. */
  serverUrl: () => string;
  fetch: Fetch;
  /** Development only: load the web app from a running Vite dev server instead of webRoot. */
  devServerUrl?: string;
  /** Sent with HTML pages from webRoot. */
  contentSecurityPolicy?: string;
}

export function createWebAppHandler(options: WebAppOptions): Handler {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return proxyToServer(request, url, options.serverUrl(), options.fetch);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return textResponse(405, "Method not allowed.");
    if (options.devServerUrl) return proxyToDevServer(request, url, options.devServerUrl, options.fetch);
    const headers: Record<string, string> = {};
    if (options.contentSecurityPolicy) headers["content-security-policy"] = options.contentSecurityPolicy;
    return serveFile(options.webRoot, url.pathname, request.method, { spaFallback: true, htmlHeaders: headers });
  };
}

/** Plain static files with no fallback, for the desktop app's own pages. */
export function createStaticHandler(root: string): Handler {
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return textResponse(405, "Method not allowed.");
    return serveFile(root, new URL(request.url).pathname, request.method, { spaFallback: false });
  };
}

async function proxyToServer(request: Request, url: URL, serverUrl: string, fetchImpl: Fetch): Promise<Response> {
  const hasBody = request.body !== null && request.method !== "GET" && request.method !== "HEAD";
  try {
    const upstream = await fetchImpl(serverUrl + url.pathname + url.search, {
      method: request.method,
      headers: forwardedRequestHeaders(request.headers),
      // Streamed, so large uploads don't sit in memory.
      body: hasBody ? request.body : null,
      duplex: hasBody ? "half" : undefined,
      redirect: "follow",
    });
    return relayResponse(upstream);
  } catch (error) {
    console.error(`[trusic] ${request.method} ${url.pathname} failed:`, error instanceof Error ? error.message : error);
    // The web app shows the "error" field of a JSON error, so this is what people will read.
    return Response.json(
      {
        error: `Can't reach the Trusic server at ${serverUrl}. Check that it's running and you're online, or choose another server from the Server… menu.`,
      },
      { status: 502 },
    );
  }
}

async function proxyToDevServer(request: Request, url: URL, devServerUrl: string, fetchImpl: Fetch): Promise<Response> {
  try {
    const upstream = await fetchImpl(devServerUrl + url.pathname + url.search, {
      method: request.method,
      headers: forwardedRequestHeaders(request.headers),
      redirect: "follow",
    });
    return relayResponse(upstream);
  } catch {
    return textResponse(502, `Can't reach the web dev server at ${devServerUrl}. Start it with "pnpm dev".`);
  }
}

// Hop-by-hop headers describe one connection, not the request, so they never travel through a proxy.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Headers to send on to the server: Authorization, Range, Content-Type, If-Range and the rest. Left out:
 * headers about the app://trusic hop itself (Origin, Referer, Sec-Fetch-*), and ones the network stack sets
 * for the new request (Host, Content-Length, Accept-Encoding). Cookies come from the app's own cookie jar
 * for the server, not from app://trusic.
 */
export function forwardedRequestHeaders(incoming: Headers): Headers {
  const headers = new Headers();
  for (const [name, value] of incoming) {
    if (HOP_BY_HOP.has(name) || name.startsWith("sec-")) continue;
    if (["host", "content-length", "accept-encoding", "cookie", "origin", "referer", "expect"].includes(name)) continue;
    headers.append(name, value);
  }
  return headers;
}

/**
 * Pass the server's response back as it is: status (200, 206, 304, 416…), headers and a streamed body.
 *
 * Electron's net.fetch hands back a Response with editable headers, and returning that same object lets
 * Electron pipe the body to the page natively instead of through JavaScript.
 */
export function relayResponse(upstream: Response): Response {
  const unwanted = [...upstream.headers.keys()].filter((name) => HOP_BY_HOP.has(name) || name === "set-cookie");
  // The network stack has already decompressed the body, so these would describe bytes that no longer exist.
  if (upstream.headers.has("content-encoding")) unwanted.push("content-encoding", "content-length");
  if (unwanted.length === 0) return upstream;
  try {
    for (const name of unwanted) upstream.headers.delete(name);
    return upstream;
  } catch {
    // A Response from the standard fetch() has read-only headers.
    const headers = new Headers(upstream.headers);
    for (const name of unwanted) headers.delete(name);
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

async function serveFile(
  root: string,
  pathname: string,
  method: string,
  options: { spaFallback: boolean; htmlHeaders?: Record<string, string> },
): Promise<Response> {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    return textResponse(400, "Bad request.");
  }
  if (relative.includes("\0")) return textResponse(400, "Bad request.");

  const base = path.resolve(root);
  let file = path.resolve(base, `.${relative}`);
  // Never serve anything outside the folder, whatever "..", "%2e%2e" or "\" tricks the path holds.
  if (file !== base && !file.startsWith(base + path.sep)) return textResponse(404, "Not found.");

  let info = await statOrNull(file);
  if (info?.isDirectory()) {
    file = path.join(file, "index.html");
    info = await statOrNull(file);
  }
  if (!info?.isFile()) {
    // A missing script or stylesheet is a real 404. Any other path is a route in the single-page app.
    if (!options.spaFallback || relative.startsWith("/assets/")) return textResponse(404, "Not found.");
    file = path.join(base, "index.html");
    info = await statOrNull(file);
    if (!info?.isFile()) {
      return textResponse(
        500,
        `The web app hasn't been built (no ${file}). Run "pnpm --filter @trusic/desktop build".`,
      );
    }
  }

  const headers = new Headers({ "content-type": contentTypeFor(file), "content-length": String(info.size) });
  if (file.endsWith(".html")) {
    headers.set("cache-control", "no-cache");
    for (const [name, value] of Object.entries(options.htmlHeaders ?? {})) headers.set(name, value);
  }
  const body = method === "HEAD" ? null : new Uint8Array(await readFile(file));
  return new Response(body, { status: 200, headers });
}

async function statOrNull(file: string) {
  try {
    return await stat(file);
  } catch {
    return null;
  }
}

function textResponse(status: number, message: string): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
