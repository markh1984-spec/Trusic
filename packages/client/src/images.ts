/**
 * Every uploaded image (release artwork, artist photos) is also kept as a square at each of these sizes, in
 * pixels. Ask for one with `?size=`; without it the server sends the largest.
 */
export const IMAGE_SIZES = [120, 300, 640] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** Only Trusic's own image URLs ("…/api/images/<name>") come in sizes. */
const SIZED = /\/api\/images\/[^/?#]+$/;

/** The smallest stored size that's at least `pixels` across (pass device pixels), or the largest. */
export function imageSizeFor(pixels: number): ImageSize {
  return IMAGE_SIZES.find((s) => s >= pixels) ?? IMAGE_SIZES[IMAGE_SIZES.length - 1]!;
}

/** `url` at the size that covers `pixels`. Other URLs come back unchanged. */
export function sizedImageUrl(url: string, pixels: number): string {
  return SIZED.test(url) ? `${url}?size=${imageSizeFor(pixels)}` : url;
}

/** Every size of `url`, for an <img srcset> (the browser picks one to suit the screen), or undefined for other URLs. */
export function imageSrcSet(url: string): string | undefined {
  return SIZED.test(url) ? IMAGE_SIZES.map((s) => `${url}?size=${s} ${s}w`).join(", ") : undefined;
}

/** Every size of `url` for React Native's <Image source>, which picks the best fit for the view. */
export function imageSources(url: string): { uri: string; width: number; height: number }[] {
  return SIZED.test(url)
    ? IMAGE_SIZES.map((s) => ({ uri: `${url}?size=${s}`, width: s, height: s }))
    : [{ uri: url, width: 640, height: 640 }];
}
