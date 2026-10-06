import type { AiLabel } from "@trusic/core";

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
  if (url) return <img className={className} src={url} alt="" style={style} loading="lazy" />;
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
        <img key={u} src={u} alt="" loading="lazy" />
      ))}
    </div>
  );
}
