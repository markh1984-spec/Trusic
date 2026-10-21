/**
 * "Human-made only": a listener setting that leaves tracks labelled Partly AI and AI Slop out of browsing,
 * search, recommendations and radio. Albums, playlists, artist pages and tracks the listener opens themselves
 * still show and play everything, with labels on every track (see docs/PRODUCT.md).
 */
import { AI_LABEL_RANGES } from "@trusic/core";
import { eq, lt } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { optionalUser, type AuthUser } from "./auth";
import type { Db } from "./db/client";
import { tracks, users } from "./db/schema";

/** Only tracks labelled Human-made. */
export const humanMadeOnly = () => lt(tracks.aiScore, AI_LABEL_RANGES.human.max);

/** "1"/"true" or "0"/"false" from a query string; anything else means "not given". */
function parseFlag(value: unknown): boolean | undefined {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return undefined;
}

/**
 * Whether to leave out tracks that aren't Human-made: the app's `humanOnly` query value if it sent one (visitors
 * have no account to keep the setting on), otherwise the signed-in listener's setting.
 */
export async function resolveHumanOnly(
  db: Db,
  request: FastifyRequest,
  user?: AuthUser | null,
): Promise<{ humanOnly: boolean; user: AuthUser | null }> {
  const viewer = user === undefined ? await optionalUser(db, request) : user;
  const given = parseFlag((request.query as Record<string, unknown> | undefined)?.humanOnly);
  if (given !== undefined) return { humanOnly: given, user: viewer };
  return { humanOnly: viewer ? await humanOnlySetting(db, viewer.id) : false, user: viewer };
}

export async function humanOnlySetting(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ humanOnly: users.humanOnly }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.humanOnly ?? false;
}
