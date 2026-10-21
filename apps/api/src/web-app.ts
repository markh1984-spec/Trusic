import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config";
import type { Db } from "./db/client";
import { embedTags, injectHead, previewTags } from "./share/html";
import { loadShareItem, SHARE_KINDS } from "./share/items";
import { siteUrl } from "./share/site";

/** Only embedded players may appear inside other websites. Every other page refuses to be framed (clickjacking). */
const NO_FRAMING = { "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'" };
const ANY_FRAMING = { "content-security-policy": "frame-ancestors *" };

/**
 * Serve the built web app (apps/web/dist) from the same origin as the API.
 *
 * It's a single-page app, so every page is index.html. Link previews in WhatsApp, iMessage, Slack and the rest
 * don't run JavaScript, though, so pages for tracks, releases, artists and public playlists get their title,
 * description, share image and AI label written into index.html here. Embedded players (/embed/…) use their own
 * small page, embed.html.
 */
export async function serveWebApp(app: FastifyInstance, deps: { db: Db; config: Config }, root: string) {
  const { db, config } = deps;
  const templates = new Map<string, { mtimeMs: number; html: string }>();

  /** Read an HTML file from the build, again only if it has changed. */
  async function template(name: string): Promise<string | null> {
    const file = path.join(root, name);
    const info = await stat(file).catch(() => null);
    if (!info) return null;
    const cached = templates.get(name);
    if (cached?.mtimeMs === info.mtimeMs) return cached.html;
    const html = await readFile(file, "utf8");
    templates.set(name, { mtimeMs: info.mtimeMs, html });
    return html;
  }

  /**
   * Pages are checked with the server on every visit (no-cache), so a title change or a playlist made private
   * shows at once; the ETag makes an unchanged page a tiny "304 Not Modified".
   */
  function sendPage(request: FastifyRequest, reply: FastifyReply, html: string, headers: Record<string, string>) {
    const etag = `"${createHash("sha256").update(html).digest("base64url").slice(0, 22)}"`;
    reply.headers(headers).header("cache-control", "no-cache").header("etag", etag);
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.type("text/html; charset=utf-8").send(html);
  }

  const indexHtml = async () => (await template("index.html")) ?? "";

  await app.register(fastifyStatic, {
    root,
    index: false,
    setHeaders(reply, file) {
      if (file.endsWith(".html")) reply.headers(NO_FRAMING);
    },
  });

  app.get("/", async (request, reply) => sendPage(request, reply, await indexHtml(), NO_FRAMING));

  for (const kind of SHARE_KINDS) {
    app.get<{ Params: { key: string } }>(`/${kind}/:key`, async (request, reply) => {
      const item = await loadShareItem(db, kind, request.params.key);
      const html = await indexHtml();
      // Missing or private: the plain app, which says so once it loads. Nothing about the item is in the page.
      return sendPage(
        request,
        reply,
        item ? injectHead(html, previewTags(item, siteUrl(config, request))) : html,
        NO_FRAMING,
      );
    });
  }

  app.get<{ Params: { kind: string; key: string } }>("/embed/:kind/:key", async (request, reply) => {
    const kind = z.enum(["track", "release", "artist"]).safeParse(request.params.kind);
    const item = kind.success ? await loadShareItem(db, kind.data, request.params.key) : null;
    const html = (await template("embed.html")) ?? (await indexHtml());
    return sendPage(request, reply, injectHead(html, embedTags(item, siteUrl(config, request))), ANY_FRAMING);
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.method !== "GET" || request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found." });
    }
    return sendPage(request, reply, await indexHtml(), NO_FRAMING);
  });
}
