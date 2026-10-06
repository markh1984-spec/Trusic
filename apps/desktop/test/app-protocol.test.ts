import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APP_ORIGIN,
  CONTENT_SECURITY_POLICY,
  createStaticHandler,
  createWebAppHandler,
  relayResponse,
  type Fetch,
} from "../src/app-protocol";

const AUDIO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

let server: Server;
let serverUrl: string;
let lastSeen: Seen | null = null;
let tmp: string;
let webRoot: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const seen: Seen = { method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) };
      lastSeen = seen;
      const url = new URL(req.url!, "http://localhost");

      // A stand-in for GET /api/stream/:id, with single-range support like the real API.
      if (url.pathname.endsWith("/api/stream/track-1")) {
        res.setHeader("content-type", "audio/wav");
        res.setHeader("accept-ranges", "bytes");
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
        if (!match) {
          res.setHeader("content-length", AUDIO.length);
          return res.end(req.method === "HEAD" ? undefined : AUDIO);
        }
        const start = match[1] ? Number(match[1]) : AUDIO.length - Number(match[2]);
        const end = match[1] && match[2] ? Number(match[2]) : AUDIO.length - 1;
        if (start >= AUDIO.length) {
          res.writeHead(416, { "content-range": `bytes */${AUDIO.length}` });
          return res.end();
        }
        res.writeHead(206, {
          "content-range": `bytes ${start}-${end}/${AUDIO.length}`,
          "content-length": end - start + 1,
        });
        return res.end(AUDIO.subarray(start, end + 1));
      }
      if (url.pathname.endsWith("/api/gzipped")) {
        res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
        return res.end(gzipSync(JSON.stringify({ hello: "compressed" })));
      }
      if (url.pathname.endsWith("/api/with-cookie")) {
        res.writeHead(200, { "content-type": "application/json", "set-cookie": "session=abc; HttpOnly" });
        return res.end("{}");
      }
      if (url.pathname.endsWith("/api/old")) {
        res.writeHead(302, { location: "/api/new" });
        return res.end();
      }
      if (url.pathname.endsWith("/api/missing")) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Track not found." }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          method: seen.method,
          url: seen.url,
          headers: seen.headers,
          body: seen.body.toString("utf8"),
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  tmp = mkdtempSync(path.join(tmpdir(), "trusic-desktop-"));
  webRoot = path.join(tmp, "web");
  mkdirSync(path.join(webRoot, "assets"), { recursive: true });
  writeFileSync(path.join(webRoot, "index.html"), "<!doctype html><title>Trusic</title>");
  writeFileSync(path.join(webRoot, "assets", "index-abc123.js"), "console.log('hi')");
  writeFileSync(path.join(webRoot, "favicon.svg"), "<svg/>");
  writeFileSync(path.join(tmp, "secret.txt"), "not for the web app");
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
});

const plainFetch: Fetch = (url, init) => fetch(url, init);
/** Electron's net.fetch returns a Response built with `new Response()`, whose headers can be edited. */
const netFetchLike: Fetch = async (url, init) => {
  const res = await fetch(url, init);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
};

function handler(options: { fetch?: Fetch; server?: () => string; devServerUrl?: string } = {}) {
  return createWebAppHandler({
    webRoot,
    serverUrl: options.server ?? (() => serverUrl),
    fetch: options.fetch ?? plainFetch,
    devServerUrl: options.devServerUrl,
    contentSecurityPolicy: CONTENT_SECURITY_POLICY,
  });
}

const app = (pathname: string, init?: RequestInit & { duplex?: "half" }) =>
  new Request(`${APP_ORIGIN}${pathname}`, init);

describe("the web app's files", () => {
  it("serves index.html with a Content-Security-Policy", async () => {
    const res = await handler()(app("/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(await res.text()).toContain("<title>Trusic</title>");
  });

  it("serves scripts with a JavaScript content type, as module scripts require", async () => {
    const res = await handler()(app("/assets/index-abc123.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(await res.text()).toBe("console.log('hi')");
  });

  it("falls back to index.html for app routes, so a reload on /release/123 works", async () => {
    for (const route of ["/release/123", "/search", "/library/liked"]) {
      const res = await handler()(app(route));
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<title>Trusic</title>");
    }
  });

  it("returns 404 for a missing asset instead of HTML", async () => {
    expect((await handler()(app("/assets/missing.js"))).status).toBe(404);
  });

  it("never serves files outside the web app folder", async () => {
    for (const sneaky of [
      "/..%2fsecret.txt",
      "/%2e%2e/secret.txt",
      "/assets/..%2f..%2fsecret.txt",
      "/..%5csecret.txt",
    ]) {
      const res = await createStaticHandler(webRoot)(app(sneaky));
      expect(res.status, sneaky).toBe(404);
      expect(await res.text()).not.toContain("not for the web app");
    }
  });

  it("answers HEAD without a body", async () => {
    const res = await handler()(app("/favicon.svg", { method: "HEAD" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("6");
    expect(await res.text()).toBe("");
  });

  it("refuses other methods outside /api", async () => {
    expect((await handler()(app("/", { method: "POST", body: "x" }))).status).toBe(405);
  });

  it("explains a missing build", async () => {
    const res = await createWebAppHandler({
      webRoot: path.join(tmp, "nope"),
      serverUrl: () => serverUrl,
      fetch: plainFetch,
    })(app("/"));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("hasn't been built");
  });

  it("has no SPA fallback for the desktop app's own pages", async () => {
    expect((await createStaticHandler(webRoot)(app("/elsewhere"))).status).toBe(404);
  });
});

describe("the /api proxy", () => {
  it("forwards the method, path, query and Authorization header", async () => {
    const res = await handler()(app("/api/tracks?label=human&limit=5", { headers: { authorization: "Bearer t0ken" } }));
    expect(res.status).toBe(200);
    const echo = (await res.json()) as { method: string; url: string; headers: Record<string, string> };
    expect(echo.method).toBe("GET");
    expect(echo.url).toBe("/api/tracks?label=human&limit=5");
    expect(echo.headers.authorization).toBe("Bearer t0ken");
    expect(echo.headers.host).toBe(new URL(serverUrl).host);
  });

  it("passes a Range request through and streams back 206 Partial Content, so seeking works", async () => {
    const res = await handler()(app("/api/stream/track-1?expires=1&sig=abc", { headers: { range: "bytes=100-199" } }));
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(res.headers.get("content-length")).toBe("100");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(AUDIO.subarray(100, 200));
    expect(lastSeen!.headers.range).toBe("bytes=100-199");
    expect(lastSeen!.url).toBe("/api/stream/track-1?expires=1&sig=abc");
  });

  it("handles open-ended and unsatisfiable ranges like the server does", async () => {
    const tail = await handler()(app("/api/stream/track-1", { headers: { range: "bytes=990-" } }));
    expect(tail.status).toBe(206);
    expect(tail.headers.get("content-range")).toBe("bytes 990-999/1000");
    expect(Buffer.from(await tail.arrayBuffer())).toEqual(AUDIO.subarray(990));

    const beyond = await handler()(app("/api/stream/track-1", { headers: { range: "bytes=5000-" } }));
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get("content-range")).toBe("bytes */1000");
  });

  it("returns the whole file with 200 when there's no Range header", async () => {
    const res = await handler()(app("/api/stream/track-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("1000");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(AUDIO);
  });

  it("streams a JSON body through", async () => {
    const res = await handler()(
      app("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "listener@trusic.local", password: "trusic-demo" }),
      }),
    );
    const echo = (await res.json()) as { method: string; body: string; headers: Record<string, string> };
    expect(echo.method).toBe("POST");
    expect(echo.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(echo.body)).toEqual({ email: "listener@trusic.local", password: "trusic-demo" });
  });

  it("streams a multipart upload through intact", async () => {
    const form = new FormData();
    form.set("title", "Morning Light");
    form.set("audio", new Blob([AUDIO], { type: "audio/wav" }), "song.wav");
    const res = await handler()(app("/api/tracks", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    expect(lastSeen!.method).toBe("POST");
    expect(lastSeen!.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(lastSeen!.body.includes(AUDIO)).toBe(true);
    expect(lastSeen!.body.toString("latin1")).toContain("Morning Light");
  });

  it("doesn't forward headers that describe the app://trusic hop", async () => {
    let sent = new Headers();
    const spy: Fetch = (url, init) => {
      sent = new Headers(init.headers);
      return fetch(url, init);
    };
    await handler({ fetch: spy })(
      app("/api/me", {
        headers: {
          origin: APP_ORIGIN,
          referer: `${APP_ORIGIN}/library`,
          cookie: "x=1",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "x-trusic-client": "desktop",
        },
      }),
    );
    expect([...sent.keys()]).toEqual(["x-trusic-client"]);
    expect(lastSeen!.headers.origin).toBeUndefined();
    expect(lastSeen!.headers.cookie).toBeUndefined();
    expect(lastSeen!.headers["x-trusic-client"]).toBe("desktop");
  });

  it("passes error statuses and their JSON through unchanged", async () => {
    const res = await handler()(app("/api/missing"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Track not found." });
  });

  it("drops Content-Encoding once the body has been decompressed", async () => {
    const res = await handler()(app("/api/gzipped"));
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.json()).toEqual({ hello: "compressed" });
  });

  it("doesn't pass Set-Cookie to the page", async () => {
    const res = await handler()(app("/api/with-cookie"));
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("follows redirects", async () => {
    const res = await handler()(app("/api/old"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toBe("/api/new");
  });

  it("hands back net.fetch's own Response, so Electron can stream it natively", async () => {
    const res = await handler({ fetch: netFetchLike })(app("/api/with-cookie"));
    expect(res.headers.get("set-cookie")).toBeNull();
    const upstream = new Response("x", { headers: { "content-type": "text/plain", connection: "keep-alive" } });
    expect(relayResponse(upstream)).toBe(upstream);
    expect(upstream.headers.get("connection")).toBeNull();
  });

  it("uses the current server for every request, so a change applies at once", async () => {
    let current = "http://127.0.0.1:9"; // nothing listens on the discard port
    const proxy = handler({ server: () => current });
    const down = await proxy(app("/api/me"));
    expect(down.status).toBe(502);
    expect(((await down.json()) as { error: string }).error).toContain(
      "Can't reach the Trusic server at http://127.0.0.1:9",
    );

    current = serverUrl;
    expect((await proxy(app("/api/me"))).status).toBe(200);
  });

  it("keeps a path prefix in the server address", async () => {
    await handler({ server: () => `${serverUrl}/trusic` })(app("/api/health"));
    expect(lastSeen!.url).toBe("/trusic/api/health");
  });
});

describe("development mode", () => {
  it("loads the web app from the Vite dev server but still sends /api to the Trusic server", async () => {
    const proxy = handler({ devServerUrl: `${serverUrl}/vite`, server: () => `${serverUrl}/server` });
    await proxy(app("/src/main.tsx", { headers: { accept: "*/*" } }));
    expect(lastSeen!.url).toBe("/vite/src/main.tsx");
    expect(lastSeen!.headers.accept).toBe("*/*");
    await proxy(app("/api/me"));
    expect(lastSeen!.url).toBe("/server/api/me");
  });
});
