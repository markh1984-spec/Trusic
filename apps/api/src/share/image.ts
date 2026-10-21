import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AiLabel } from "@trusic/core";
import { Canvas, decodeImage, hex, mix, Path, type Rgb, type RgbaImage } from "./canvas";
import { Font } from "./font";
import type { ShareItem } from "./items";

/** The size link previews use (Facebook, WhatsApp, X, LinkedIn, Slack and Discord all crop to about 1.91:1). */
export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;

/** Bump to give every share image a new address when the design changes, so link previews pick it up. */
const DESIGN_VERSION = 1;

const COLOURS = {
  background: hex("#0c0d10"),
  text: hex("#eef0f4"),
  muted: hex("#a3abb8"),
  brand: hex("#3fd99a"),
  brandInk: hex("#04150e"),
  human: hex("#3fd99a"),
  ai_assisted: hex("#f4bf4f"),
  ai_generated: hex("#b48cff"),
} satisfies Record<string, Rgb>;

/** Placeholder artwork, matching the web app's. */
const PLACEHOLDERS: Record<AiLabel | "none", [string, string]> = {
  human: ["#1f6b4f", "#11231c"],
  ai_assisted: ["#7a5c1d", "#241c0c"],
  ai_generated: ["#563c8c", "#1a1328"],
  none: ["#2a3140", "#151820"],
};

interface Fonts {
  regular: Font;
  bold: Font;
}

let fonts: Fonts | null | undefined;

/** Inter, from its npm package. If it can't be found, link previews fall back to the plain artwork. */
function loadFonts(): Fonts | null {
  if (fonts !== undefined) return fonts;
  try {
    const require = createRequire(import.meta.url);
    const file = (weight: string) =>
      readFileSync(require.resolve(`@expo-google-fonts/inter/${weight}/Inter_${weight}.ttf`));
    fonts = { regular: new Font(file("400Regular")), bold: new Font(file("800ExtraBold")) };
  } catch {
    fonts = null;
  }
  return fonts;
}

export const shareImagesAvailable = () => loadFonts() !== null;

/** Changes whenever anything drawn on the image changes, so it can be cached forever under an address that has it. */
export function shareImageVersion(item: ShareItem): string {
  const drawn = [DESIGN_VERSION, item.eyebrow, item.title, item.byline, item.label, item.artworkUrl, item.round];
  return createHash("sha256").update(JSON.stringify(drawn)).digest("base64url").slice(0, 12);
}

/** Shorten `text` with an ellipsis until it fits in `width` pixels. */
function fit(font: Font, text: string, size: number, width: number): string {
  if (font.layout(text, size).width <= width) return text;
  const chars = [...text];
  while (chars.length > 1 && font.layout(`${chars.join("").trimEnd()}…`, size).width > width) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

/** Break `text` into at most `maxLines` lines no wider than `width`; the last line is shortened if needed. */
function wrap(font: Font, text: string, size: number, width: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let i = 0;
  while (i < words.length) {
    if (lines.length === maxLines - 1) {
      lines.push(words.slice(i).join(" "));
      break;
    }
    let line = words[i++]!;
    while (i < words.length && font.layout(`${line} ${words[i]}`, size).width <= width) line += ` ${words[i++]}`;
    lines.push(line);
  }
  const cut = lines.some((l) => font.layout(l, size).width > width);
  return { lines: lines.map((l) => fit(font, l, size, width)), cut };
}

/** Draw the 1200×630 card: artwork on the left; title, artist and AI label on the right. */
export function renderShareImage(item: ShareItem, art: RgbaImage | null): Buffer {
  const f = loadFonts();
  if (!f) throw new Error("share image fonts are missing");
  const W = SHARE_IMAGE_WIDTH;
  const H = SHARE_IMAGE_HEIGHT;
  const tone = item.label ? COLOURS[item.label.tone] : COLOURS.brand;
  const canvas = new Canvas(W, H);
  canvas.gradient(mix(COLOURS.background, tone, 0.2), COLOURS.background);

  // Artwork, or a placeholder with the first letter, like the app shows.
  const artSize = 430;
  const artX = 80;
  const artY = (H - artSize) / 2;
  const clip = item.round
    ? new Path().circle(artX + artSize / 2, artY + artSize / 2, artSize / 2)
    : new Path().roundedRect(artX, artY, artSize, artSize, 24);
  if (art) {
    canvas.drawCover(art, artX, artY, artSize, clip);
  } else {
    const [from, to] = PLACEHOLDERS[item.label?.tone ?? "none"].map(hex) as [Rgb, Rgb];
    canvas.fill(clip, (x, y) => mix(from, to, Math.min(1, (x - artX + (y - artY)) / (2 * artSize))));
    const letter = [...item.title][0]?.toUpperCase() ?? "";
    const size = 190;
    const width = f.bold.layout(letter, size).width;
    canvas.fill(
      new Path().text(f.bold, letter, size, artX + (artSize - width) / 2, artY + artSize / 2 + size * 0.36),
      [235, 235, 235],
    );
  }

  // Text, laid out top to bottom, then centred vertically above the footer.
  const left = 570;
  const width = W - left - 70;
  let titleSize = 68;
  let title = wrap(f.bold, item.title, titleSize, width, 2);
  for (const smaller of [58, 50, 44]) {
    if (!title.cut) break;
    titleSize = smaller;
    title = wrap(f.bold, item.title, titleSize, width, 2);
  }
  const eyebrowSize = 24;
  const bylineSize = 34;
  const pillHeight = 62;
  const titleLine = titleSize * 1.12;
  const blockHeight =
    eyebrowSize + 26 + titleLine * title.lines.length + 16 + bylineSize + (item.label ? 40 + pillHeight : 0);
  let y = Math.max(60, (H - 100 - blockHeight) / 2 + 20);

  canvas.fill(
    new Path().text(f.bold, item.eyebrow.toUpperCase(), eyebrowSize, left, y + eyebrowSize, 3),
    COLOURS.muted,
  );
  y += eyebrowSize + 26;
  const text = new Path();
  for (const line of title.lines) {
    text.text(f.bold, line, titleSize, left, y + titleSize * 0.92);
    y += titleLine;
  }
  canvas.fill(text, COLOURS.text);
  y += 16;
  canvas.fill(
    new Path().text(f.regular, fit(f.regular, item.byline, bylineSize, width), bylineSize, left, y + bylineSize * 0.85),
    COLOURS.muted,
  );
  y += bylineSize;

  if (item.label) {
    y += 40;
    let size = 28;
    while (size > 18 && 54 + f.bold.layout(item.label.text, size).width + 28 > width) size -= 2;
    const label = fit(f.bold, item.label.text, size, width - 82);
    const pillWidth = 54 + f.bold.layout(label, size).width + 28;
    canvas.fill(new Path().roundedRect(left, y, pillWidth, pillHeight, pillHeight / 2), tone, 0.16);
    canvas.fill(new Path().circle(left + 30, y + pillHeight / 2, 8), tone);
    canvas.fill(new Path().text(f.bold, label, size, left + 50, y + pillHeight / 2 + size * 0.36), tone);
  }

  // The Trusic mark and name, bottom right of the artwork's column.
  const footerY = H - 100;
  canvas.fill(new Path().roundedRect(left, footerY, 46, 46, 11), COLOURS.brand);
  const t = f.bold.layout("T", 28).width;
  canvas.fill(new Path().text(f.bold, "T", 28, left + (46 - t) / 2, footerY + 33), COLOURS.brandInk);
  canvas.fill(new Path().text(f.bold, "Trusic", 32, left + 60, footerY + 35), COLOURS.text);

  return canvas.toJpeg(86);
}

export { decodeImage };
