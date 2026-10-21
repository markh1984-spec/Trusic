import { sharePath } from "@trusic/client";
import { SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH, shareImagesAvailable, shareImageVersion } from "./image";
import type { ShareItem } from "./items";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Safe inside HTML text and quoted attributes. Everything an artist or listener typed goes through this. */
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ENTITIES[c]!);

/** "Chalk Paths · The Hollow Pines". Artists are just their name. */
export const shareTitle = (item: ShareItem): string =>
  item.kind === "artist" ? item.title : `${item.title} · ${item.byline}`;

/** Where the share image is. The version changes with the image, so it can be cached for good. */
export const shareImagePath = (item: ShareItem): string =>
  `/api/share/${item.kind}/${encodeURIComponent(item.key)}/image.jpg?v=${shareImageVersion(item)}`;

/** The share image, or the plain artwork if share images can't be drawn here. */
export function previewImageUrl(item: ShareItem, origin: string): string | null {
  if (shareImagesAvailable()) return origin + shareImagePath(item);
  if (!item.artworkUrl) return null;
  return /^https?:\/\//.test(item.artworkUrl) ? item.artworkUrl : origin + item.artworkUrl;
}

/**
 * Tags for the page's <head>: a title and description, Open Graph (Facebook, WhatsApp, iMessage, Slack, Discord,
 * LinkedIn) and Twitter cards (X), and oEmbed discovery for players other websites can embed.
 */
export function previewTags(item: ShareItem, origin: string): string {
  const url = origin + sharePath(item.kind, item.key);
  const title = shareTitle(item);
  const image = previewImageUrl(item, origin);
  const meta: [string, string, string][] = [
    ["name", "description", item.description],
    ["property", "og:site_name", "Trusic"],
    ["property", "og:type", item.ogType],
    ["property", "og:title", title],
    ["property", "og:description", item.description],
    ["property", "og:url", url],
    ["property", "og:locale", "en_GB"],
  ];
  if (image) {
    const alt = `${title}.${item.label ? ` ${item.label.text}.` : ""}`;
    meta.push(["property", "og:image", image], ["property", "og:image:alt", alt]);
    if (image.includes("/api/share/")) {
      meta.push(
        ["property", "og:image:type", "image/jpeg"],
        ["property", "og:image:width", String(SHARE_IMAGE_WIDTH)],
        ["property", "og:image:height", String(SHARE_IMAGE_HEIGHT)],
      );
    }
    meta.push(["name", "twitter:image", image], ["name", "twitter:image:alt", alt]);
  }
  meta.push(
    ["name", "twitter:card", image ? "summary_large_image" : "summary"],
    ["name", "twitter:title", title],
    ["name", "twitter:description", item.description],
  );
  if (item.author?.path && item.kind !== "playlist")
    meta.push(["property", "music:musician", origin + item.author.path]);
  for (const link of item.links) meta.push(["property", link.property, origin + link.path]);
  if (item.durationSeconds) meta.push(["property", "music:duration", String(item.durationSeconds)]);

  const lines = [
    `<title>${escapeHtml(`${title} · Trusic`)}</title>`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    ...meta.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`),
  ];
  if (item.kind !== "playlist") {
    const oembed = `${origin}/api/oembed?url=${encodeURIComponent(url)}&format=json`;
    lines.push(
      `<link rel="alternate" type="application/json+oembed" href="${escapeHtml(oembed)}" title="${escapeHtml(title)}" />`,
    );
  }
  return lines.join("\n    ");
}

/** Tags for an embedded player's page: a title, and a pointer to the real page so search engines index that. */
export function embedTags(item: ShareItem | null, origin: string): string {
  const lines = [`<meta name="robots" content="noindex" />`];
  if (item) {
    lines.unshift(`<title>${escapeHtml(`${shareTitle(item)} · Trusic`)}</title>`);
    lines.push(`<link rel="canonical" href="${escapeHtml(origin + sharePath(item.kind, item.key))}" />`);
  }
  return lines.join("\n    ");
}

/** Put `tags` into the web app's index.html, replacing its own title (and description, if the tags have one). */
export function injectHead(template: string, tags: string): string {
  let html = template;
  if (tags.includes("<title>")) html = html.replace(/<title>[^<]*<\/title>\s*/i, "");
  if (tags.includes('name="description"')) html = html.replace(/<meta\s+name="description"[^>]*>\s*/i, "");
  // A function, so "$&" and friends in a title are left alone.
  return html.replace(/<\/head>/i, () => `  ${tags}\n  </head>`);
}
