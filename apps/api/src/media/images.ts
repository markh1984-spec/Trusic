import { open } from "node:fs/promises";
import { runFfmpeg, type Ffmpeg } from "./ffmpeg";

/**
 * Artwork and artist photos are kept as squares at a few standard sizes (IMAGE_SIZES in @trusic/client), cropped
 * from the middle and saved as WebP, so a list of 40-pixel thumbnails doesn't download full-size photos.
 */
export const IMAGE_MIME = "image/webp";

/** Filters that turn a photo the right way up, by its EXIF orientation (phones store photos sideways). */
const ORIENTATION_FILTERS: Record<number, string> = {
  2: "hflip",
  3: "hflip,vflip",
  4: "vflip",
  5: "transpose=0",
  6: "transpose=1",
  7: "transpose=3",
  8: "transpose=2",
};

/** Square copies of `input`, one per output, never larger than the original. */
export async function resizeImage(
  ffmpeg: Ffmpeg,
  input: string,
  options: { outputs: { size: number; path: string }[]; timeoutMs: number; signal?: AbortSignal },
): Promise<void> {
  const orientation = ORIENTATION_FILTERS[await readOrientation(input)];
  const n = options.outputs.length;
  const graph = [
    `[0:v]${orientation ? `${orientation},` : ""}crop='min(iw,ih)':'min(iw,ih)',split=${n}${options.outputs.map((_, i) => `[s${i}]`).join("")}`,
    ...options.outputs.map(({ size }, i) => `[s${i}]scale='min(${size},iw)':'min(${size},ih)':flags=lanczos[o${i}]`),
  ].join(";");
  await runFfmpeg(
    ffmpeg,
    [
      // We turn photos upright ourselves, so ffmpeg mustn't as well.
      ...["-noautorotate", "-i", input, "-filter_complex", graph],
      ...options.outputs.flatMap(({ path }, i) => [
        ...["-map", `[o${i}]`, "-frames:v", "1", "-map_metadata", "-1"],
        ...["-c:v", "libwebp", "-quality", "82", "-f", "webp", path],
      ]),
    ],
    options,
  );
}

async function readOrientation(filePath: string): Promise<number> {
  const handle = await open(filePath, "r");
  try {
    // EXIF sits near the start of a JPEG, and is at most 64 KB.
    const buffer = Buffer.alloc(128 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return jpegOrientation(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** The EXIF orientation of a JPEG, from 1 (upright) to 8. 1 for anything else. */
export function jpegOrientation(data: Buffer): number {
  if (data[0] !== 0xff || data[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return 1;
    const marker = data[offset + 1]!;
    if (marker === 0xff) {
      offset += 1; // padding
      continue;
    }
    // Start of the image data, or the end: EXIF comes before either.
    if (marker === 0xda || marker === 0xd9) return 1;
    const length = data.readUInt16BE(offset + 2);
    if (marker === 0xe1 && data.toString("latin1", offset + 4, offset + 10) === "Exif\0\0") {
      return exifOrientation(data.subarray(offset + 10, Math.min(data.length, offset + 2 + length)));
    }
    offset += 2 + length;
  }
  return 1;
}

function exifOrientation(tiff: Buffer): number {
  if (tiff.length < 8) return 1;
  const little = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const ifd = little ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
  if (ifd + 2 > tiff.length) return 1;
  for (let i = 0, count = u16(ifd); i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}
