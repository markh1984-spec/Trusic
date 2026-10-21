import { EMBED_HEIGHT, embedCode, jpegImageUrl, type EmbedKind, type SiteInfo } from "@trusic/client";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { HttpError } from "../errors";
import { previewImageUrl, shareTitle } from "../share/html";
import {
  decodeImage,
  renderShareImage,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
  shareImagesAvailable,
  shareImageVersion,
} from "../share/image";
import { loadShareItem, SHARE_KINDS, type ShareItem } from "../share/items";
import { siteUrl } from "../share/site";

/** Rendered share images, most recently used last. Each is about 100 KB. */
const MAX_CACHED_IMAGES = 40;
const cache = new Map<string, Buffer>();
const rendering = new Map<string, Promise<Buffer>>();
/** One image at a time, so a burst of link previews can't use much memory at once. */
let queue: Promise<unknown> = Promise.resolve();

async function shareImage(app: FastifyInstance, item: ShareItem, version: string): Promise<Buffer> {
  const key = `${item.kind}/${item.key}/${version}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const pending = rendering.get(key);
  if (pending) return pending;

  const work = queue.then(async () => {
    const image = renderShareImage(item, await loadArtwork(app, item.artworkUrl));
    cache.set(key, image);
    while (cache.size > MAX_CACHED_IMAGES) cache.delete(cache.keys().next().value!);
    return image;
  });
  queue = work.catch(() => undefined);
  rendering.set(key, work);
  try {
    return await work;
  } finally {
    rendering.delete(key);
  }
}

/**
 * Fetch artwork through its public address, so it works wherever images are stored. Trusic's own images are
 * asked for as JPEG: their usual resized copies are WebP, which decodeImage can't read.
 */
async function loadArtwork(app: FastifyInstance, url: string | null) {
  if (!url) return null;
  try {
    let bytes: Buffer;
    if (url.startsWith("/")) {
      const res = await app.inject({ method: "GET", url: jpegImageUrl(url) });
      if (res.statusCode !== 200) return null;
      bytes = res.rawPayload;
    } else {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      bytes = Buffer.from(await res.arrayBuffer());
    }
    return decodeImage(bytes);
  } catch {
    return null;
  }
}

const OembedQuery = z.object({
  url: z.string().max(2000),
  format: z.string().optional(),
  maxwidth: z.coerce.number().int().positive().optional(),
  maxheight: z.coerce.number().int().positive().optional(),
});

export const shareRoutes =
  ({ db, config }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    /** The desktop app runs the web app from app://, so it asks where the site is to make share links. */
    app.get("/share/site", async (request) => ({ url: siteUrl(config, request) }) satisfies SiteInfo);

    /** The 1200×630 picture link previews show, with the artwork, title, artist and AI label. */
    app.get<{ Params: { kind: string; key: string }; Querystring: { v?: string } }>(
      "/share/:kind/:key/image.jpg",
      async (request, reply) => {
        const kind = z.enum(SHARE_KINDS).safeParse(request.params.kind);
        const item = kind.success ? await loadShareItem(db, kind.data, request.params.key) : null;
        if (!item || !shareImagesAvailable()) throw new HttpError(404, "Not found.");
        const version = shareImageVersion(item);
        const image = await shareImage(app, item, version);
        return reply
          .header("content-type", "image/jpeg")
          .header("content-length", image.length)
          .header(
            "cache-control",
            // The address changes whenever the picture does, so a current one can be kept for a day. Not longer:
            // if the item is taken down, its picture should stop being served soon after.
            request.query.v === version ? "public, max-age=86400" : "public, max-age=300",
          )
          .send(image);
      },
    );

    /**
     * oEmbed (https://oembed.com): lets tools that support it turn a pasted Trusic link into the embedded player.
     * Pages point to it with a <link rel="alternate" type="application/json+oembed"> tag.
     */
    app.get("/oembed", async (request) => {
      const query = OembedQuery.parse(request.query);
      if (query.format && query.format !== "json") throw new HttpError(501, "Only JSON is supported.");
      let path: string;
      try {
        path = new URL(query.url).pathname;
      } catch {
        throw new HttpError(404, "Not found.");
      }
      const match = /^(?:\/embed)?\/(track|release|artist)\/([^/]+)\/?$/.exec(path);
      const item = match ? await loadShareItem(db, match[1] as EmbedKind, decodeURIComponent(match[2]!)) : null;
      if (!item) throw new HttpError(404, "Not found.");

      const origin = siteUrl(config, request);
      const kind = item.kind as EmbedKind;
      const title = shareTitle(item);
      const height = Math.min(EMBED_HEIGHT[kind], query.maxheight ?? Infinity);
      const thumbnail = previewImageUrl(item, origin);
      return {
        version: "1.0",
        type: "rich",
        provider_name: "Trusic",
        provider_url: origin,
        title,
        ...(item.author ? { author_name: item.author.name } : {}),
        ...(item.author?.path ? { author_url: origin + item.author.path } : {}),
        html: embedCode(origin, kind, item.key, { title }).replace(/height="\d+"/, `height="${height}"`),
        width: Math.min(660, query.maxwidth ?? 660),
        height,
        ...(thumbnail
          ? {
              thumbnail_url: thumbnail,
              thumbnail_width: thumbnail.includes("/api/share/") ? SHARE_IMAGE_WIDTH : undefined,
              thumbnail_height: thumbnail.includes("/api/share/") ? SHARE_IMAGE_HEIGHT : undefined,
            }
          : {}),
        cache_age: 3600,
      };
    });
  };
