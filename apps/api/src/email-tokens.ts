import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, isNull, ne } from "drizzle-orm";
import type { Db, Tx } from "./db/client";
import { emailTokens, type EmailTokenPurpose } from "./db/schema";
import { compose, emails } from "./emails";
import { HttpError } from "./errors";
import { sendLater, type Mailer } from "./mailer";

const HOUR = 60 * 60 * 1000;

/** How long each kind of link works. */
export const TOKEN_LIFETIME_MS: Record<EmailTokenPurpose, number> = {
  verify_email: 72 * HOUR,
  change_email: 72 * HOUR,
  reset_password: HOUR,
};

/** At most this many links of one kind are emailed to an account per hour, however often they're asked for. */
export const LINKS_PER_HOUR = 3;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Create a single-use link token. Only its hash is stored; the token itself goes in the email. */
export async function issueToken(
  db: Db | Tx,
  input: { userId: string; purpose: EmailTokenPurpose; email: string },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(emailTokens).values({
    userId: input.userId,
    purpose: input.purpose,
    email: input.email,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS[input.purpose]),
  });
  return token;
}

/** How many links of this kind were sent to the account in the last hour. */
export async function linksSentRecently(db: Db, userId: string, purpose: EmailTokenPurpose): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.userId, userId),
        eq(emailTokens.purpose, purpose),
        gt(emailTokens.createdAt, new Date(Date.now() - HOUR)),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Use a token: it must be the right kind, unused and unexpired. Marking it used and checking it happen in one
 * statement, so the same link can't be used twice even by two requests at once.
 */
export async function consumeToken(db: Db | Tx, token: string, purpose: EmailTokenPurpose) {
  const [row] = await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailTokens.tokenHash, hashToken(token)),
        eq(emailTokens.purpose, purpose),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  return row ?? null;
}

/** Cancel a user's outstanding links, e.g. when their email address or password changes. */
export async function cancelTokens(
  db: Db | Tx,
  userId: string,
  purposes: EmailTokenPurpose[],
  except?: string,
): Promise<void> {
  for (const purpose of purposes) {
    await db
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailTokens.userId, userId),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.usedAt),
          except ? ne(emailTokens.id, except) : undefined,
        ),
      );
  }
}

/** The new address the account is waiting to confirm, if any. */
export async function pendingEmail(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: emailTokens.email, createdAt: emailTokens.createdAt })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.userId, userId),
        eq(emailTokens.purpose, "change_email"),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(emailTokens.createdAt))
    .limit(1);
  return row?.email ?? null;
}

/** Email a link that confirms the account's current address. */
export async function sendVerificationEmail(
  db: Db,
  mailer: Mailer,
  publicUrl: string,
  user: { id: string; email: string; displayName: string },
): Promise<void> {
  const token = await issueToken(db, { userId: user.id, purpose: "verify_email", email: user.email });
  const url = `${publicUrl}/verify-email?token=${token}`;
  sendLater(mailer, compose(user.email, emails.verifyEmail({ name: user.displayName, url })));
}

/** Uploading music and being paid need a confirmed email address. Listening doesn't. */
export function requireVerifiedEmail(user: { emailVerifiedAt: Date | null }, action: string): void {
  if (!user.emailVerifiedAt) {
    throw new HttpError(
      403,
      `Please confirm your email address before you ${action}. We've emailed you a link; you can send it again from the banner at the top of the page.`,
    );
  }
}
