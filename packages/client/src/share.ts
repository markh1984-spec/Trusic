/**
 * Share links and embed codes. Shared by the server (link previews, oEmbed) and the apps (the Share menu), so a
 * pasted link and an embedded player always point at the same pages.
 */

export type ShareKind = "track" | "release" | "artist" | "playlist";
/** Players other websites can embed. Playlists can be private, so they aren't embeddable. */
export type EmbedKind = Exclude<ShareKind, "playlist">;
export type EmbedTheme = "auto" | "light" | "dark";

/** Artists are linked by their slug; everything else by id. */
export function sharePath(kind: ShareKind, key: string): string {
  return `/${kind}/${encodeURIComponent(key)}`;
}

/** A single track fits in a compact strip; releases and artists list their tracks. */
export const EMBED_HEIGHT: Record<EmbedKind, number> = { track: 176, release: 380, artist: 380 };

export function embedUrl(origin: string, kind: EmbedKind, key: string, theme: EmbedTheme = "auto"): string {
  return `${origin}/embed${sharePath(kind, key)}${theme === "auto" ? "" : `?theme=${theme}`}`;
}

const escapeAttribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The HTML a band pastes into its own website. */
export function embedCode(
  origin: string,
  kind: EmbedKind,
  key: string,
  options: { title: string; theme?: EmbedTheme },
): string {
  const src = embedUrl(origin, kind, key, options.theme);
  return (
    `<iframe src="${escapeAttribute(src)}" title="${escapeAttribute(options.title)}" width="100%" ` +
    `height="${EMBED_HEIGHT[kind]}" style="border:0;border-radius:12px;max-width:660px" loading="lazy" ` +
    `allow="autoplay; encrypted-media"></iframe>`
  );
}
