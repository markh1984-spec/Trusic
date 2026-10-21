import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PlaylistDetail, ReleaseDetail, TrackDetail } from "@trusic/client";
import { AI_LABELS } from "@trusic/core";
import jpeg from "jpeg-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { escapeHtml, injectHead } from "../src/share/html";
import { collectionLabel } from "../src/share/items";
import { serveWebApp } from "../src/web-app";
import { call, createTestApp, declaration, png, register, sendFile, wav, type TestApp } from "./helpers";

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="Trusic: music streaming that pays the humans who make it." />
    <title>Trusic</title>
  </head>
  <body><div id="root"></div></body>
</html>`;
const EMBED = INDEX.replace('<div id="root"></div>', '<div id="embed"></div>');

let t: TestApp;
let webDist: string;
let band: { token: string; id: string };
let fan: { token: string; id: string };
let track: TrackDetail;
let release: ReleaseDetail;
let publicPlaylist: PlaylistDetail;
let privatePlaylist: PlaylistDetail;
const TRICKY_TITLE = `Fire & "Ice" <script>alert(1)</script> $& £5`;

const page = (url: string, headers: Record<string, string> = {}) => t.app.inject({ method: "GET", url, headers });

beforeAll(async () => {
  t = await createTestApp();
  webDist = await mkdtemp(path.join(tmpdir(), "trusic-web-"));
  await writeFile(path.join(webDist, "index.html"), INDEX);
  await writeFile(path.join(webDist, "embed.html"), EMBED);
  await writeFile(path.join(webDist, "app.js"), "console.log('hi')");
  await serveWebApp(t.app, { db: t.database.db, config: loadConfig({ TRUSIC_DATA_DIR: webDist }) }, webDist);

  band = await register(t, "band@trusic.test");
  fan = await register(t, "fan@trusic.test");
  const artist = (await call<{ id: string }>(t, "POST", "/api/artists", band.token, { name: "The Hollow Pines" })).body;
  const upload = async (title: string, stages = {}) =>
    (
      await sendFile(
        t,
        "POST",
        "/api/tracks",
        band.token,
        { artistId: artist.id, title, declaration: JSON.stringify(declaration(stages)) },
        { name: "audio", filename: "t.wav", data: wav({ seconds: 6, seed: title.length }) },
      )
    ).body as TrackDetail;
  track = await upload("Chalk Paths");
  const partly = await upload(TRICKY_TITLE, { vocals: "generated" });
  release = (
    await call<ReleaseDetail>(t, "POST", "/api/releases", band.token, {
      artistId: artist.id,
      title: "Chalk",
      type: "ep",
    })
  ).body;
  await call(t, "PUT", `/api/releases/${release.id}/tracks`, band.token, { trackIds: [track.id, partly.id] });
  await sendFile(
    t,
    "PUT",
    `/api/releases/${release.id}/artwork`,
    band.token,
    {},
    {
      name: "image",
      filename: "art.png",
      data: png(5),
      contentType: "image/png",
    },
  );

  const playlist = (name: string, isPublic: boolean) =>
    call<PlaylistDetail>(t, "POST", "/api/playlists", fan.token, { name, isPublic }).then((r) => r.body);
  publicPlaylist = await playlist("Road trip", true);
  privatePlaylist = await playlist("Secret crush songs", false);
  await call(t, "POST", `/api/playlists/${privatePlaylist.id}/entries`, fan.token, { trackIds: [track.id] });
});
afterAll(async () => {
  await t?.close();
  if (webDist) await rm(webDist, { recursive: true, force: true });
});

describe("link previews", () => {
  it("writes a track's title, artist, artwork and AI label into the page", async () => {
    const res = await page(`/track/${track.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    const html = res.body;
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain("<title>Chalk Paths · The Hollow Pines · Trusic</title>");
    expect(html).toContain('<meta property="og:title" content="Chalk Paths · The Hollow Pines" />');
    expect(html).toContain(`${AI_LABELS.human.name}, AI score 0 out of 100`);
    expect(html).toContain(`<meta property="og:url" content="http://localhost:80/track/${track.id}" />`);
    expect(html).toMatch(
      new RegExp(`og:image" content="http://localhost:80/api/share/track/${track.id}/image.jpg\\?v=`),
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain(`<meta property="music:album" content="http://localhost:80/release/${release.id}" />`);
    expect(html).toContain("application/json+oembed");
    // The app's own description is replaced, not repeated.
    expect(html).not.toContain("pays the humans who make it");
  });

  it("escapes everything people typed", async () => {
    const tracks = (await call<ReleaseDetail>(t, "GET", `/api/releases/${release.id}`)).body.tracks;
    const tricky = tracks.find((x) => x.title === TRICKY_TITLE)!;
    const html = (await page(`/track/${tricky.id}`)).body;
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(escapeHtml(TRICKY_TITLE));
    expect(html).toContain("Fire &amp; &quot;Ice&quot; &lt;script&gt;alert(1)&lt;/script&gt; $&amp; £5");
    expect(html).toContain(AI_LABELS.ai_assisted.name);
  });

  it("describes releases, artists and public playlists by their tracks' labels", async () => {
    const releaseHtml = (await page(`/release/${release.id}`)).body;
    expect(releaseHtml).toContain("<title>Chalk · EP by The Hollow Pines · Trusic</title>");
    expect(releaseHtml).toContain(`2 tracks: 1 ${AI_LABELS.human.name}, 1 ${AI_LABELS.ai_assisted.name}.`);

    const artistHtml = (await page("/artist/the-hollow-pines")).body;
    expect(artistHtml).toContain('<meta property="og:title" content="The Hollow Pines" />');
    expect(artistHtml).toContain('<meta property="og:type" content="profile" />');

    const playlistHtml = (await page(`/playlist/${publicPlaylist.id}`)).body;
    expect(playlistHtml).toContain("Road trip · Playlist by fan");
    expect(playlistHtml).not.toContain("application/json+oembed");
  });

  it("never gives away a private playlist", async () => {
    const res = await page(`/playlist/${privatePlaylist.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX);
    expect(res.body).not.toContain("Secret crush");
    const image = await page(`/api/share/playlist/${privatePlaylist.id}/image.jpg`);
    expect(image.statusCode).toBe(404);
    // Even its owner's link shows nothing, since previews are made for whoever pastes the link.
    expect((await page(`/playlist/${privatePlaylist.id}`, { authorization: `Bearer ${fan.token}` })).body).toBe(INDEX);
  });

  it("serves the plain app for anything unknown, and keeps API 404s as JSON", async () => {
    expect((await page("/track/not-a-uuid")).body).toBe(INDEX);
    expect((await page("/track/00000000-0000-4000-8000-000000000000")).body).toBe(INDEX);
    expect((await page("/library")).body).toBe(INDEX);
    expect((await page("/")).body).toBe(INDEX);
    const api = await page("/api/nothing-here");
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: "Not found." });
    expect((await page("/app.js")).body).toBe("console.log('hi')");
  });

  it("revalidates pages cheaply", async () => {
    const first = await page(`/track/${track.id}`);
    expect(first.headers["cache-control"]).toBe("no-cache");
    const again = await page(`/track/${track.id}`, { "if-none-match": String(first.headers.etag) });
    expect(again.statusCode).toBe(304);
  });

  it("lets only embedded players be framed by other websites", async () => {
    for (const url of ["/", `/track/${track.id}`, "/library", "/index.html"]) {
      const res = await page(url);
      expect(res.headers["x-frame-options"], url).toBe("DENY");
      expect(res.headers["content-security-policy"], url).toBe("frame-ancestors 'none'");
    }
    const embed = await page(`/embed/track/${track.id}`);
    expect(embed.statusCode).toBe(200);
    expect(embed.headers["x-frame-options"]).toBeUndefined();
    expect(embed.headers["content-security-policy"]).toBe("frame-ancestors *");
    expect(embed.body).toContain('<div id="embed"></div>');
    expect(embed.body).toContain('<meta name="robots" content="noindex" />');
    expect(embed.body).toContain(`<link rel="canonical" href="http://localhost:80/track/${track.id}" />`);
    // Playlists have no embed.
    expect((await page(`/embed/playlist/${publicPlaylist.id}`)).body).not.toContain("Road trip");
  });
});

describe("share images", () => {
  it("draws a 1200×630 JPEG, cached for good at its versioned address", async () => {
    const html = (await page(`/track/${track.id}`)).body;
    const imageUrl = /og:image" content="http:\/\/localhost:80([^"]+)"/.exec(html)![1]!.replace(/&amp;/g, "&");
    const res = await page(imageUrl);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    const decoded = jpeg.decode(res.rawPayload, { useTArray: true });
    expect([decoded.width, decoded.height]).toEqual([1200, 630]);

    const stale = await page(`/api/share/track/${track.id}/image.jpg?v=old`);
    expect(stale.headers["cache-control"]).toBe("public, max-age=300");
    expect((await page(`/api/share/nope/${track.id}/image.jpg`)).statusCode).toBe(404);
  });

  it("gives the image a new address when what's on it changes", async () => {
    const version = async () => /image\.jpg\?v=([\w-]+)/.exec((await page(`/release/${release.id}`)).body)![1];
    const before = await version();
    await call(t, "PATCH", `/api/releases/${release.id}`, band.token, { title: "Chalk (Deluxe)" });
    expect(await version()).not.toBe(before);
    const res = await page(`/api/share/release/${release.id}/image.jpg`);
    expect(res.statusCode).toBe(200);
  });

  it("labels collections by their tracks", () => {
    expect(collectionLabel({ human: 3, ai_assisted: 0, ai_generated: 0 })).toEqual({
      text: `All 3 tracks ${AI_LABELS.human.name}`,
      tone: "human",
    });
    expect(collectionLabel({ human: 0, ai_assisted: 0, ai_generated: 1 })?.text).toBe(
      `1 track · ${AI_LABELS.ai_generated.name}`,
    );
    expect(collectionLabel({ human: 2, ai_assisted: 0, ai_generated: 1 })).toEqual({
      text: `2 ${AI_LABELS.human.name} · 1 ${AI_LABELS.ai_generated.name}`,
      tone: "ai_assisted",
    });
    expect(collectionLabel({ human: 0, ai_assisted: 0, ai_generated: 0 })).toBeNull();
  });
});

describe("oEmbed and share links", () => {
  it("turns a pasted link into an embedded player", async () => {
    const res = await call<Record<string, unknown>>(
      t,
      "GET",
      `/api/oembed?url=${encodeURIComponent(`https://trusic.example/track/${track.id}`)}&maxwidth=400`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: "1.0",
      type: "rich",
      provider_name: "Trusic",
      title: "Chalk Paths · The Hollow Pines",
      author_name: "The Hollow Pines",
      width: 400,
      height: 176,
    });
    expect(res.body.html).toContain(`src="http://localhost:80/embed/track/${track.id}"`);

    const playlistLink = encodeURIComponent(`https://trusic.example/playlist/${publicPlaylist.id}`);
    expect((await call(t, "GET", `/api/oembed?url=${playlistLink}`)).status).toBe(404);
    expect((await call(t, "GET", `/api/oembed?url=nonsense`)).status).toBe(404);
  });

  it("tells apps where the site is", async () => {
    expect((await call(t, "GET", "/api/share/site")).body).toEqual({ url: "http://localhost:80" });
  });

  it("only replaces the head it's given", () => {
    expect(injectHead(INDEX, '<meta name="robots" content="noindex" />')).toContain("<title>Trusic</title>");
  });
});
