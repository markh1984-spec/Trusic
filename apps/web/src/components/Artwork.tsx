import { imageSrcSet, sizedImageUrl } from "@trusic/client";
import type { AiLabel } from "@trusic/core";

/** How wide a "fill" image is on screen: half the width on phones, a grid tile (about 160–240 px) otherwise. */
const FILL_SIZES = "(max-width: 600px) 50vw, 240px";

/**
 * An <img> that lets the browser choose from the server's sizes (120, 300 or 640 pixels square) to suit how big it
 * is shown and the screen's pixel density, so lists don't download full-size artwork.
 */
function SizedImage({
  url,
  size,
  ...props
}: {
  url: string;
  size: number | "fill";
  className?: string;
  style?: object;
}) {
  return (
    <img
      {...props}
      src={sizedImageUrl(url, size === "fill" ? 640 : size * 2)}
      srcSet={imageSrcSet(url)}
      sizes={size === "fill" ? FILL_SIZES : `${size}px`}
      alt=""
      loading="lazy"
    />
  );
}

/** Cover art, or a coloured placeholder with the title's first letter. */
export function Artwork({
  url,
  title,
  label,
  size = 48,
  round = false,
}: {
  url: string | null;
  title: string;
  label?: AiLabel;
  size?: number | "fill";
  round?: boolean;
}) {
  const style = size === "fill" ? undefined : { width: size, height: size, fontSize: Math.max(12, size * 0.4) };
  const className = `artwork${round ? " artwork--round" : ""}${size === "fill" ? " artwork--fill" : ""}`;
  if (url) return <SizedImage className={className} url={url} size={size} style={style} />;
  return (
    <div className={`${className} artwork--placeholder artwork--${label ?? "none"}`} style={style} aria-hidden>
      {title.slice(0, 1).toUpperCase()}
    </div>
  );
}

/** A playlist cover: a 2×2 mosaic of its tracks' artwork, or one image, or a placeholder. */
export function PlaylistCover({
  urls,
  title,
  size = "fill",
}: {
  urls: string[];
  title: string;
  size?: number | "fill";
}) {
  if (urls.length < 4) return <Artwork url={urls[0] ?? null} title={title} size={size} />;
  const style = size === "fill" ? undefined : { width: size, height: size };
  return (
    <div className={`mosaic${size === "fill" ? " artwork--fill" : ""}`} style={style} aria-hidden>
      {urls.slice(0, 4).map((u) => (
        <SizedImage key={u} url={u} size={size === "fill" ? 150 : size / 2} />
      ))}
    </div>
  );
}
