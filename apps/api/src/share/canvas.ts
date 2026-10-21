import { inflateSync } from "node:zlib";
import jpeg from "jpeg-js";
import type { Font } from "./font";
import { encodeJpeg } from "./jpeg";
import { decodeJpegPreview } from "./jpeg-preview";

/**
 * A small drawing surface for share images, in plain JavaScript: anti-aliased shapes and text, and photos scaled
 * to fit. It uses a few megabytes of memory, where a native or WebAssembly graphics library would use around a
 * hundred, which matters on a 512 MB server.
 */

export type Rgb = [number, number, number];

export function hex(colour: string): Rgb {
  const n = Number.parseInt(colour.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as Rgb;

/** A shape as straight line segments (curves are flattened as they're added), in pixels. */
export class Path {
  readonly segments: number[] = [];
  private startX = 0;
  private startY = 0;
  private x = 0;
  private y = 0;

  moveTo(x: number, y: number): this {
    this.close();
    this.startX = this.x = x;
    this.startY = this.y = y;
    return this;
  }

  lineTo(x: number, y: number): this {
    if (x !== this.x || y !== this.y) this.segments.push(this.x, this.y, x, y);
    this.x = x;
    this.y = y;
    return this;
  }

  quadTo(cx: number, cy: number, x: number, y: number): this {
    const steps = Math.min(16, Math.max(2, Math.ceil(Math.hypot(x - this.x, y - this.y) / 4)));
    const [x0, y0] = [this.x, this.y];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      this.lineTo(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y);
    }
    return this;
  }

  close(): this {
    return this.lineTo(this.startX, this.startY);
  }

  roundedRect(x: number, y: number, w: number, h: number, r: number): this {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    const steps = Math.max(4, Math.ceil(radius / 2));
    // Each corner is a quarter circle, starting from the top right and going clockwise.
    const corners = [
      [x + w - radius, y + radius, -Math.PI / 2],
      [x + w - radius, y + h - radius, 0],
      [x + radius, y + h - radius, Math.PI / 2],
      [x + radius, y + radius, Math.PI],
    ] as const;
    for (const [i, [cx, cy, start]] of corners.entries()) {
      for (let step = 0; step <= steps; step++) {
        const angle = start + (step / steps) * (Math.PI / 2);
        const [px, py] = [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
        if (i === 0 && step === 0) this.moveTo(px, py);
        else this.lineTo(px, py);
      }
    }
    return this.close();
  }

  circle(cx: number, cy: number, r: number): this {
    const steps = Math.max(24, Math.ceil(r));
    this.moveTo(cx + r, cy);
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      this.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    return this.close();
  }

  /** Glyph outlines at `size` pixels, with the text's baseline starting at (x, baseline). */
  text(font: Font, text: string, size: number, x: number, baseline: number, letterSpacing = 0): this {
    const scale = size / font.unitsPerEm;
    for (const { glyph, x: gx } of font.layout(text, size, letterSpacing).glyphs) {
      for (const contour of font.outline(glyph)) {
        const points = contour.map((p) => ({ x: x + gx + p.x * scale, y: baseline - p.y * scale, on: p.onCurve }));
        if (points.length < 2) continue;
        // Start on a point that's on the curve, or halfway between two control points.
        const startIndex = points.findIndex((p) => p.on);
        const start =
          startIndex >= 0
            ? points[startIndex]!
            : { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2, on: true };
        const ordered =
          startIndex >= 0
            ? [...points.slice(startIndex + 1), ...points.slice(0, startIndex)]
            : [...points.slice(1), points[0]!];
        this.moveTo(start.x, start.y);
        let control: { x: number; y: number } | null = null;
        for (const p of [...ordered, start]) {
          if (p.on) {
            if (control) this.quadTo(control.x, control.y, p.x, p.y);
            else this.lineTo(p.x, p.y);
            control = null;
          } else if (control) {
            // Two control points in a row imply an on-curve point halfway between them.
            const midX = (control.x + p.x) / 2;
            const midY = (control.y + p.y) / 2;
            this.quadTo(control.x, control.y, midX, midY);
            control = p;
          } else {
            control = p;
          }
        }
        this.close();
      }
    }
    return this;
  }
}

/**
 * Working buffers, kept and reused from one image to the next. Allocating several megabytes afresh for every
 * image leaves memory behind that the system doesn't take back, which adds up on a 512 MB server. Drawing is
 * synchronous, so only one image is ever using them.
 */
const buffers = new Map<string, Float32Array | Uint8Array>();
function scratch<T extends Float32Array | Uint8Array>(
  name: string,
  type: { new (length: number): T },
  length: number,
): T {
  let buffer = buffers.get(name) as T | undefined;
  if (!buffer || buffer.length < length) {
    buffer = new type(length);
    buffers.set(name, buffer);
  }
  return buffer.subarray(0, length) as T;
}

/**
 * How much of each pixel a path covers, from 0 to 1, using signed-area accumulation: every edge adds or removes
 * coverage to its right, and a running sum along each row gives the answer.
 */
function rasterize(segments: number[], left: number, top: number, w: number, h: number): Float32Array {
  const stride = w + 2;
  const acc = scratch("accumulation", Float32Array, stride * h).fill(0);
  for (let i = 0; i < segments.length; i += 4) {
    accumulateLine(
      acc,
      stride,
      w,
      h,
      segments[i]! - left,
      segments[i + 1]! - top,
      segments[i + 2]! - left,
      segments[i + 3]! - top,
    );
  }
  const coverage = scratch("coverage", Float32Array, w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      sum += acc[y * stride + x]!;
      coverage[y * w + x] = Math.min(1, Math.abs(sum));
    }
  }
  return coverage;
}

function accumulateLine(
  acc: Float32Array,
  stride: number,
  w: number,
  h: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): void {
  if (ay === by) return;
  let direction = 1;
  let [x0, y0, x1, y1] = [ax, ay, bx, by];
  if (y0 > y1) {
    direction = -1;
    [x0, y0, x1, y1] = [bx, by, ax, ay];
  }
  const dxdy = (x1 - x0) / (y1 - y0);
  let x = x0;
  let yStart = y0;
  if (yStart < 0) {
    x -= yStart * dxdy;
    yStart = 0;
  }
  const yEnd = Math.min(h, y1);
  const clampX = (v: number) => Math.max(0, Math.min(w, v));
  const add = (i: number, v: number) => {
    acc[i] = acc[i]! + v;
  };
  for (let y = Math.floor(yStart); y < Math.ceil(yEnd); y++) {
    const row = y * stride;
    const dy = Math.min(y + 1, yEnd) - Math.max(y, yStart);
    const xNext = x + dxdy * dy;
    const d = dy * direction;
    const xa = clampX(Math.min(x, xNext));
    const xb = clampX(Math.max(x, xNext));
    const xaFloor = Math.floor(xa);
    const xbCeil = Math.ceil(xb);
    if (xbCeil <= xaFloor + 1) {
      // The edge stays within one pixel column on this row.
      const middle = 0.5 * (xa + xb) - xaFloor;
      add(row + xaFloor, d - d * middle);
      add(row + xaFloor + 1, d * middle);
    } else {
      // It crosses several columns: share the area out between them.
      const s = 1 / (xb - xa);
      const fa = xa - xaFloor;
      const a0 = 0.5 * s * (1 - fa) ** 2;
      const fb = xb - xbCeil + 1;
      const am = 0.5 * s * fb ** 2;
      add(row + xaFloor, d * a0);
      if (xbCeil === xaFloor + 2) {
        add(row + xaFloor + 1, d * (1 - a0 - am));
      } else {
        const a1 = s * (1.5 - fa);
        add(row + xaFloor + 1, d * (a1 - a0));
        for (let xi = xaFloor + 2; xi < xbCeil - 1; xi++) add(row + xi, d * s);
        const a2 = a1 + (xbCeil - xaFloor - 3) * s;
        add(row + xbCeil - 1, d * (1 - a2 - am));
      }
      add(row + xbCeil, d * am);
    }
    x = xNext;
  }
}

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export class Canvas {
  /** RGB, 0-255, kept as floats while drawing so layers blend smoothly. */
  private readonly pixels: Float32Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    // Every pixel is painted by `gradient` first, so the reused buffer needs no clearing.
    this.pixels = scratch("pixels", Float32Array, width * height * 3);
  }

  /** Fill the whole canvas with a diagonal gradient. */
  gradient(from: Rgb, to: Rgb): void {
    const { width, height } = this;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = Math.min(1, (x / width) * 0.55 + (y / height) * 0.45);
        const i = (y * width + x) * 3;
        for (let c = 0; c < 3; c++) this.pixels[i + c] = from[c]! + (to[c]! - from[c]!) * t;
      }
    }
  }

  /** Paint inside `path`. `paint` gives the colour at a pixel, for gradients. */
  fill(path: Path, paint: Rgb | ((x: number, y: number) => Rgb), opacity = 1): void {
    this.blend(path, (px, py, coverage) => {
      const colour = typeof paint === "function" ? paint(px, py) : paint;
      const a = coverage * opacity;
      const i = (py * this.width + px) * 3;
      for (let c = 0; c < 3; c++) this.pixels[i + c] = this.pixels[i + c]! * (1 - a) + colour[c]! * a;
    });
  }

  /** Call `apply` for every pixel `path` touches, with how much of it the path covers. */
  private blend(path: Path, apply: (x: number, y: number, coverage: number) => void): void {
    const box = this.bounds(path);
    if (!box) return;
    const coverage = rasterize(path.segments, box.left, box.top, box.w, box.h);
    for (let y = 0; y < box.h; y++) {
      for (let x = 0; x < box.w; x++) {
        const a = coverage[y * box.w + x]!;
        if (a > 0) apply(box.left + x, box.top + y, a);
      }
    }
  }

  private bounds(path: Path) {
    const s = path.segments;
    if (s.length === 0) return null;
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < s.length; i += 2) {
      minX = Math.min(minX, s[i]!);
      maxX = Math.max(maxX, s[i]!);
      minY = Math.min(minY, s[i + 1]!);
      maxY = Math.max(maxY, s[i + 1]!);
    }
    const left = Math.max(0, Math.floor(minX));
    const top = Math.max(0, Math.floor(minY));
    const right = Math.min(this.width, Math.ceil(maxX) + 1);
    const bottom = Math.min(this.height, Math.ceil(maxY) + 1);
    if (right <= left || bottom <= top) return null;
    return { left, top, w: right - left, h: bottom - top };
  }

  /** Draw `image` to fill a `size`×`size` square at (x, y), cropping it to a square, clipped to `clip`. */
  drawCover(image: RgbaImage, x: number, y: number, size: number, clip: Path): void {
    const scaled = resizeCover(image, size);
    const ox = Math.round(x);
    const oy = Math.round(y);
    this.blend(clip, (px, py, coverage) => {
      const sx = Math.min(size - 1, Math.max(0, px - ox));
      const sy = Math.min(size - 1, Math.max(0, py - oy));
      const s = (sy * size + sx) * 4;
      const a = (coverage * scaled[s + 3]!) / 255;
      const i = (py * this.width + px) * 3;
      for (let c = 0; c < 3; c++) this.pixels[i + c] = this.pixels[i + c]! * (1 - a) + scaled[s + c]! * a;
    });
  }

  toJpeg(quality = 85): Buffer {
    return encodeJpeg(this.pixels, this.width, this.height, quality);
  }
}

/** Crop to the centre square and scale to `size`: averaging pixels when shrinking, blending when enlarging. */
function resizeCover(image: RgbaImage, size: number): Uint8Array {
  const { width, height, data } = image;
  const side = Math.min(width, height);
  const offsetX = (width - side) / 2;
  const offsetY = (height - side) / 2;
  const step = side / size;
  const out = scratch("artwork", Uint8Array, size * size * 4);
  for (let ty = 0; ty < size; ty++) {
    for (let tx = 0; tx < size; tx++) {
      const o = (ty * size + tx) * 4;
      if (step > 1) {
        const x0 = Math.floor(offsetX + tx * step);
        const y0 = Math.floor(offsetY + ty * step);
        const x1 = Math.max(x0 + 1, Math.min(width, Math.floor(offsetX + (tx + 1) * step)));
        const y1 = Math.max(y0 + 1, Math.min(height, Math.floor(offsetY + (ty + 1) * step)));
        const sums = [0, 0, 0, 0];
        for (let sy = y0; sy < y1; sy++) {
          for (let sx = x0; sx < x1; sx++) for (let c = 0; c < 4; c++) sums[c]! += data[(sy * width + sx) * 4 + c]!;
        }
        const n = (x1 - x0) * (y1 - y0);
        for (let c = 0; c < 4; c++) out[o + c] = sums[c]! / n;
      } else {
        const sx = Math.max(0, Math.min(width - 1, offsetX + (tx + 0.5) * step - 0.5));
        const sy = Math.max(0, Math.min(height - 1, offsetY + (ty + 0.5) * step - 0.5));
        const xa = Math.floor(sx);
        const ya = Math.floor(sy);
        const fx = sx - xa;
        const fy = sy - ya;
        const topLeft = (ya * width + xa) * 4;
        const right = xa + 1 < width ? 4 : 0;
        const down = ya + 1 < height ? width * 4 : 0;
        for (let c = 0; c < 4; c++) {
          const i = topLeft + c;
          const top = data[i]! * (1 - fx) + data[i + right]! * fx;
          const bottom = data[i + down]! * (1 - fx) + data[i + down + right]! * fx;
          out[o + c] = top * (1 - fy) + bottom * fy;
        }
      }
    }
  }
  return out;
}

/** Larger PNGs are skipped (the share image shows a placeholder) to keep memory use down. */
const MAX_PNG_PIXELS = 4_000_000;
/** JPEGs at least this wide or tall are read at an eighth of their size, which is plenty for a share image. */
const JPEG_PREVIEW_FROM = 800;

/**
 * Decode PNG or JPEG artwork, possibly at a reduced size. Returns null for anything else (such as WebP) or
 * anything we can't read.
 */
export function decodeImage(bytes: Buffer): RgbaImage | null {
  try {
    if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return decodePng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const preview = decodeJpegPreview(bytes);
      if (preview && Math.max(preview.width, preview.height) * 8 >= JPEG_PREVIEW_FROM) return preview;
      // Small enough to decode in full: under 800×800 takes little memory.
      const image = jpeg.decode(bytes, {
        useTArray: true,
        formatAsRGBA: true,
        maxResolutionInMP: (JPEG_PREVIEW_FROM * JPEG_PREVIEW_FROM) / 1_000_000,
        maxMemoryUsageInMB: 64,
      });
      return { width: image.width, height: image.height, data: image.data };
    }
  } catch {
    // Corrupt or unusual files just get the placeholder.
  }
  return null;
}

/** PNG decoding for the common cases: 8 or 16 bits, greyscale, RGB, palette, with or without alpha. */
function decodePng(bytes: Buffer): RgbaImage | null {
  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const chunks: Buffer[] = [];
  for (let p = 8; p + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(p);
    const type = bytes.toString("latin1", p + 4, p + 8);
    const body = bytes.subarray(p + 8, p + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      colourType = body[9]!;
      if (body[12] !== 0) return null; // interlaced
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") chunks.push(body);
    else if (type === "IEND") break;
    p += 12 + length;
  }
  if (!width || !height || width * height > MAX_PNG_PIXELS) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (!channels || (depth < 8 && colourType !== 3 && colourType !== 0) || (depth === 16 && colourType === 3))
    return null;

  const raw = inflateSync(Buffer.concat(chunks));
  const bitsPerPixel = channels * depth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const rows = Buffer.alloc(rowBytes * height);
  let previous = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)]!;
    const line = raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1));
    const out = rows.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= bpp ? out[i - bpp]! : 0;
      const up = previous[i]!;
      const upLeft = i >= bpp ? previous[i - bpp]! : 0;
      let value = line[i]!;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const [dl, du, dul] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
        value += dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
      }
      out[i] = value & 255;
    }
    previous = out;
  }

  const data = new Uint8Array(width * height * 4);
  const sample = (row: number, index: number): number => {
    // The value of the index-th sample in a row, scaled to 0-255 (palette indices aren't scaled).
    const base = row * rowBytes;
    if (depth === 8) return rows[base + index]!;
    if (depth === 16) return rows[base + index * 2]!;
    const perByte = 8 / depth;
    const byte = rows[base + Math.floor(index / perByte)]!;
    const value = (byte >> (8 - depth * ((index % perByte) + 1))) & ((1 << depth) - 1);
    return colourType === 3 ? value : Math.round((value * 255) / ((1 << depth) - 1));
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * channels;
      if (colourType === 3) {
        const index = sample(y, s);
        data[o] = palette?.[index * 3] ?? 0;
        data[o + 1] = palette?.[index * 3 + 1] ?? 0;
        data[o + 2] = palette?.[index * 3 + 2] ?? 0;
        data[o + 3] = transparency?.[index] ?? 255;
      } else if (colourType === 0 || colourType === 4) {
        data[o] = data[o + 1] = data[o + 2] = sample(y, s);
        data[o + 3] = colourType === 4 ? sample(y, s + 1) : 255;
      } else {
        data[o] = sample(y, s);
        data[o + 1] = sample(y, s + 1);
        data[o + 2] = sample(y, s + 2);
        data[o + 3] = colourType === 6 ? sample(y, s + 3) : 255;
      }
    }
  }
  return { width, height, data };
}
