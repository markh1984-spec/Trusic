import { PLAY_SOURCES, type PlaySource } from "@trusic/client";
import { z } from "zod";

/**
 * Where a play started, as sent by the apps. Optional, because older apps don't send it. Any unknown value is
 * stored as "other" rather than rejected: a newer app must never lose a listener's play over a stats label.
 */
export const PlaySourceField = z
  .string()
  .max(40)
  .nullish()
  .transform((s): PlaySource | null => {
    if (s === undefined || s === null) return null;
    return (PLAY_SOURCES as readonly string[]).includes(s) ? (s as PlaySource) : "other";
  });
