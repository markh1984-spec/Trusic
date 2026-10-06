import { inArray, like } from "drizzle-orm";
import { hashPassword, verifyPassword } from "./auth";
import type { Db } from "./db/client";
import { sessions, users } from "./db/schema";

/** Every account the seed script creates has an email at this domain. */
export const DEMO_EMAIL_DOMAIN = "trusic.local";

/**
 * Give every demo account `password`, and sign them out everywhere.
 *
 * A hosted demo's image is built with the demo data already in it (seeding needs more memory and time than free
 * hosting has), so its accounts start with the well-known default password. The server calls this at startup to
 * switch them to the site's own. Does nothing if they already have it.
 */
export async function setDemoPassword(db: Db, password: string): Promise<boolean> {
  const demo = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(like(users.email, `%@${DEMO_EMAIL_DOMAIN}`));
  if (!demo.length || (await verifyPassword(password, demo[0]!.passwordHash))) return false;

  const ids = demo.map((u) => u.id);
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(inArray(users.id, ids));
    await tx.delete(sessions).where(inArray(sessions.userId, ids));
  });
  return true;
}
