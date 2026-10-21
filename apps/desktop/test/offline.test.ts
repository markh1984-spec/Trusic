import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createWebAppHandler, type Fetch } from "../src/app-protocol";
import { withOfflineCache } from "../src/offline-protocol";
import { OfflineStore } from "../src/offline-store";

const TRACK = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const IMAGE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png";
const AUDIO = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
const NOW = Date.parse("2026-10-21T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let server: Server;
let serverUrl: string;
let up = true;
/** The web app's folder: empty, since only /api requests are tested here. */
let tmp: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === `/api/stream/${TRACK}` && url.searchParams.get("sig") === "good") {
      res.writeHead(200, { "content-type": "audio/wav", "content-length": AUDIO.length });
      return res.end(AUDIO);
    }
    if (url.pathname === `/api/images/${IMAGE}`) {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(Buffer.from("png"));
    }
    if (url.pathname.startsWith("/api/stream/")) {
      res.writeHead(403, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "This stream link has expired." }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ url: `/api/stream/${TRACK}?expires=1&sig=fromserver`, preview: false }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  tmp = mkdtempSync(path.join(tmpdir(), "trusic-offline-"));
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
});

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
  up = true;
});

/** A fetch that can pretend the server has gone away. */
const fetchLike: Fetch = (url, init) => (up ? fetch(url, init) : Promise.reject(new TypeError("fetch failed")));

function makeStore(now = () => NOW) {
  const dir = mkdtempSync(path.join(tmpdir(), "trusic-downloads-"));
  dirs.push(dir);
  return { dir, store: new OfflineStore({ dir, serverUrl: () => serverUrl, fetch: fetchLike, now }) };
}

const manifest = (validUntil: string | null, trackIds: string[] = [TRACK]) => ({
  version: 1,
  accountId: "user-1",
  checkedAt: new Date(NOW).toISOString(),
  validUntil,
  collections: [],
  tracks: Object.fromEntries(
    trackIds.map((id) => [id, { track: { id, artworkUrl: `/api/images/${IMAGE}` }, bytes: AUDIO.length }]),
  ),
});

describe("OfflineStore", () => {
  it("downloads a track and its artwork into its own folder, under names that aren't music files", async () => {
    const { dir, store } = makeStore();
    const result = await store.download(TRACK, `/api/stream/${TRACK}?expires=1&sig=good`, `/api/images/${IMAGE}`);
    expect(result).toEqual({ ok: true, bytes: AUDIO.length });
    expect(readdirSync(path.join(dir, "audio"))).toEqual([TRACK]);
    expect(readdirSync(path.join(dir, "images"))).toEqual([IMAGE]);

    store.saveManifest(manifest(new Date(NOW + 30 * DAY).toISOString()));
    expect(store.track(TRACK)).toMatchObject({ size: AUDIO.length, mimeType: "audio/wav" });
    expect(store.image(IMAGE)).toMatchObject({ mimeType: "image/png" });
  });

  it("only follows links to this server's audio", async () => {
    const { store } = makeStore();
    for (const url of [
      `https://evil.example/api/stream/${TRACK}?sig=good`,
      `/api/stream/${OTHER}?sig=good`,
      "/api/me",
      `/api/stream/${TRACK}/../../me?x`,
    ]) {
      expect(await store.download(TRACK, url, null)).toMatchObject({ ok: false, offline: false, status: 400 });
    }
    expect(await store.download("../../etc", `/api/stream/../../etc?sig=good`, null)).toMatchObject({ ok: false });
  });

  it("reports an expired link, and a server that's gone, without keeping half a file", async () => {
    const { dir, store } = makeStore();
    expect(await store.download(TRACK, `/api/stream/${TRACK}?sig=old`, null)).toMatchObject({
      ok: false,
      offline: false,
      status: 403,
    });
    up = false;
    expect(await store.download(TRACK, `/api/stream/${TRACK}?sig=good`, null)).toMatchObject({
      ok: false,
      offline: true,
    });
    expect(existsSync(path.join(dir, "audio", TRACK))).toBe(false);
  });

  it("only plays downloads checked in the last 30 days", async () => {
    let now = NOW;
    const { store } = makeStore(() => now);
    await store.download(TRACK, `/api/stream/${TRACK}?sig=good`, null);
    store.saveManifest(manifest(new Date(NOW + 30 * DAY).toISOString()));
    expect(store.track(TRACK)).not.toBeNull();
    now = NOW + 31 * DAY;
    expect(store.track(TRACK)).toBeNull();
    store.saveManifest(manifest(null));
    now = NOW;
    expect(store.track(TRACK)).toBeNull();
  });

  it("refuses a list of downloads that isn't one", () => {
    const { store } = makeStore();
    expect(() => store.saveManifest({ version: 2 })).toThrow();
    expect(() => store.saveManifest("hello")).toThrow();
  });

  it("deletes downloads but keeps the device id, and tidies stray files", async () => {
    const { dir, store } = makeStore();
    const id = store.deviceId();
    expect(store.deviceId()).toBe(id);
    await store.download(TRACK, `/api/stream/${TRACK}?sig=good`, `/api/images/${IMAGE}`);
    writeFileSync(path.join(dir, "audio", `${OTHER}.part`), "half");
    store.saveManifest(manifest(new Date(NOW + DAY).toISOString()));
    store.prune([TRACK]);
    expect(readdirSync(path.join(dir, "audio"))).toEqual([TRACK]);

    store.removeAll();
    expect(existsSync(path.join(dir, "audio"))).toBe(false);
    expect(store.track(TRACK)).toBeNull();
    expect(store.deviceId()).toBe(id);
  });
});

describe("the app:// handler with downloads", () => {
  async function setup() {
    const { store } = makeStore();
    await store.download(TRACK, `/api/stream/${TRACK}?sig=good`, `/api/images/${IMAGE}`);
    store.saveManifest(manifest(new Date(Date.now() + 30 * DAY).toISOString()));
    const seen: boolean[] = [];
    const handler = withOfflineCache(
      createWebAppHandler({ webRoot: tmp, serverUrl: () => serverUrl, fetch: fetchLike }),
      store,
      (ok) => seen.push(ok),
    );
    return { store, handler, seen };
  }
  const get = (url: string, headers: Record<string, string> = {}) => new Request(`app://trusic${url}`, { headers });

  it("plays a downloaded track from disk, with seeking", async () => {
    const { handler } = await setup();
    const whole = await handler(get(`/api/stream/${TRACK}?expires=1&sig=anything`));
    expect(whole.status).toBe(200);
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(AUDIO);

    const part = await handler(get(`/api/stream/${TRACK}?offline=1`, { range: "bytes=100-199" }));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 100-199/${AUDIO.length}`);
    expect(Buffer.from(await part.arrayBuffer())).toEqual(AUDIO.subarray(100, 200));
    expect((await handler(get(`/api/stream/${TRACK}`, { range: "bytes=999999-" }))).status).toBe(416);
  });

  it("never serves a download as a preview", async () => {
    const { handler } = await setup();
    const res = await handler(get(`/api/stream/${TRACK}?expires=1&preview=1&sig=x`));
    expect(res.status).toBe(403); // the server's answer: that link isn't valid
  });

  it("answers for downloaded tracks when the server can't be reached, and says it's offline", async () => {
    const { handler, seen } = await setup();
    const online = await handler(get(`/api/tracks/${TRACK}/stream`));
    expect(((await online.json()) as { url: string }).url).toContain("sig=fromserver");

    up = false;
    const offline = await handler(get(`/api/tracks/${TRACK}/stream`));
    expect(offline.status).toBe(200);
    const body = (await offline.json()) as { url: string; preview: boolean };
    expect(body).toMatchObject({ url: `/api/stream/${TRACK}?offline=1`, preview: false });
    const notDownloaded = await handler(get(`/api/tracks/${OTHER}/stream`));
    expect(notDownloaded.status).toBe(502);
    expect(seen).toEqual([true, false, false]);

    const artwork = await handler(get(`/api/images/${IMAGE}`));
    expect(await artwork.text()).toBe("png");
    // The web app asks for artwork at a size (?size=120); offline, the saved copy answers for every size.
    const sized = await handler(get(`/api/images/${IMAGE}?size=120`));
    expect(await sized.text()).toBe("png");
  });

  it("labels saved artwork by what it is: the server sends resized artwork as WebP whatever its name", async () => {
    const { dir, store } = makeStore();
    await store.download(TRACK, `/api/stream/${TRACK}?expires=1&sig=good`, `/api/images/${IMAGE}`);
    store.saveManifest(manifest(new Date(NOW + 30 * DAY).toISOString()));
    writeFileSync(path.join(dir, "images", IMAGE), Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"));
    expect(store.image(IMAGE)).toMatchObject({ mimeType: "image/webp" });
  });
});
