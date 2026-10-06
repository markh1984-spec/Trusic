// Draws the Trusic app icon (the web app's favicon: a green rounded square with a dark "T") and writes the
// files electron-builder needs. Plain Node, no dependencies. Run it again after changing the design:
//
//   pnpm --filter @trusic/desktop icons
//
//   build/icon.png   1024×1024, for Linux
//   build/icon.ico   16–256 px, for Windows (the .exe and the installer)
//   build/icon.icns  16–1024 px, for macOS, with the standard margin around the square
//   static/icon.png  256×256, the window icon on Linux

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The favicon (apps/web/public/favicon.svg) on its 64×64 grid.
const GREEN = [0x3f, 0xd9, 0x9a];
const INK = [0x04, 0x15, 0x0e];
const CORNER = 14;
const T_SHAPE = [
  { x0: 17, y0: 18, x1: 47, y1: 26 }, // the bar
  { x0: 28, y0: 26, x1: 36, y1: 48 }, // the stem
];

/** RGBA pixels of the icon at `size`, with the square inset by `margin` (a fraction of the size). */
function render(size, margin = 0) {
  const pixels = new Uint8Array(size * size * 4);
  const inset = size * margin;
  const scale = (size - 2 * inset) / 64;
  const samples = 8; // 8×8 samples per pixel for smooth edges

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      let ink = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          // Back to the 64×64 grid.
          const x = (px + (sx + 0.5) / samples - inset) / scale;
          const y = (py + (sy + 0.5) / samples - inset) / scale;
          if (!insideRoundedSquare(x, y)) continue;
          covered++;
          if (T_SHAPE.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1)) ink++;
        }
      }
      const i = (py * size + px) * 4;
      if (covered === 0) continue;
      const t = ink / covered;
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(GREEN[c] * (1 - t) + INK[c] * t);
      pixels[i + 3] = Math.round((covered / (samples * samples)) * 255);
    }
  }
  return pixels;
}

function insideRoundedSquare(x, y) {
  if (x < 0 || y < 0 || x >= 64 || y >= 64) return false;
  const dx = Math.max(CORNER - x, 0, x - (64 - CORNER));
  const dy = Math.max(CORNER - y, 0, y - (64 - CORNER));
  return dx * dx + dy * dy <= CORNER * CORNER;
}

function png(size, pixels) {
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // no filter
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(rows, y * (size * 4 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** Windows icon. 256 px is stored as PNG, smaller sizes as classic bitmaps, which every Windows tool reads. */
function ico(sizes) {
  const images = sizes.map((size) => (size >= 256 ? png(size, render(size)) : bitmap(size, render(size))));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry); // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(images[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

function bitmap(size, pixels) {
  const maskRow = Math.ceil(size / 32) * 4;
  const info = Buffer.alloc(40);
  info.writeUInt32LE(40, 0);
  info.writeInt32LE(size, 4);
  info.writeInt32LE(size * 2, 8); // colour image plus transparency mask
  info.writeUInt16LE(1, 12);
  info.writeUInt16LE(32, 14);
  info.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  const colour = Buffer.alloc(size * size * 4);
  const mask = Buffer.alloc(maskRow * size);
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y; // bitmaps are stored bottom row first
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = (row * size + x) * 4;
      colour[to] = pixels[from + 2]; // BGRA
      colour[to + 1] = pixels[from + 1];
      colour[to + 2] = pixels[from];
      colour[to + 3] = pixels[from + 3];
      if (pixels[from + 3] === 0) mask[row * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([info, colour, mask]);
}

/** macOS icon. Apple's template puts the 824 px square in the middle of a 1024 px canvas. */
function icns() {
  const entries = [
    ["icp4", 16],
    ["icp5", 32],
    ["ic11", 32], // 16@2x
    ["icp6", 64],
    ["ic12", 64], // 32@2x
    ["ic07", 128],
    ["ic08", 256],
    ["ic13", 256], // 128@2x
    ["ic09", 512],
    ["ic14", 512], // 256@2x
    ["ic10", 1024], // 512@2x
  ];
  const cache = new Map();
  const parts = entries.map(([type, size]) => {
    if (!cache.has(size)) cache.set(size, png(size, render(size, 100 / 1024)));
    const data = cache.get(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

function write(relative, data) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log(`${relative} (${Math.round(data.length / 1024)} KB)`);
}

write("build/icon.png", png(1024, render(1024)));
write("build/icon.ico", ico([16, 24, 32, 48, 64, 128, 256]));
write("build/icon.icns", icns());
write("static/icon.png", png(256, render(256)));
