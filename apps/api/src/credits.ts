import type { TrackCredits } from "@trusic/client";
import { z } from "zod";

export const CreditsSchema = z.object({
  songwriters: z.array(z.string().trim().min(1).max(100)).max(20),
  societyMember: z.enum(["yes", "no", "unsure"]),
  isCover: z.boolean(),
  originalArtist: z.string().trim().max(200).optional(),
  isrc: z
    .string()
    .transform((v) => v.replace(/[\s-]/g, "").toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/, "An ISRC looks like GB-ABC-26-00001."))
    .optional(),
});

/** What anyone may see: who wrote it and whether it's a cover. */
export function publicCredits(credits: TrackCredits | null): TrackCredits | null {
  if (!credits) return null;
  return {
    songwriters: credits.songwriters,
    isCover: credits.isCover,
    ...(credits.originalArtist ? { originalArtist: credits.originalArtist } : {}),
  };
}
