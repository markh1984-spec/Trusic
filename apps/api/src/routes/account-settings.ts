import type { AuthResponse, SettingsResult } from "@trusic/client";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { deleteAccount, exportAccountData } from "../account-data";
import type { FullAppDeps } from "../app";
import { bearerToken, createSession, hashPassword, requireUser, verifyPassword } from "../auth";
import { sessions, users } from "../db/schema";
import {
  cancelTokens,
  consumeToken,
  hashToken,
  issueToken,
  LINKS_PER_HOUR,
  linksSentRecently,
  pendingEmail,
  sendVerificationEmail,
} from "../email-tokens";
import { compose, emails } from "../emails";
import { HttpError } from "../errors";
import { sendLater } from "../mailer";
import { toUser } from "../views";

const NewPassword = z.string().min(8, "Use at least 8 characters.").max(200);
const Token = z.string().min(10).max(200);

const authRateLimit = { rateLimit: { max: 20, timeWindow: "1 minute" } };
/** Each request can send an email, so these are tighter. */
const emailRateLimit = { rateLimit: { max: 5, timeWindow: "15 minutes" } };

const EXPIRED = "This link has expired or has already been used.";

/**
 * Account self-service: forgotten passwords, confirming email addresses, settings, and "your data" (download and
 * delete).
 */
export const accountSettingsRoutes =
  (deps: FullAppDeps): FastifyPluginAsync =>
  async (app) => {
    const { db, config, mailer } = deps;
    const link = (path: string) => `${config.publicUrl}${path}`;

    async function loadUser(id: string) {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);
      if (!row) throw new HttpError(404, "Account not found.");
      return row;
    }

    /** Email a reset link, unless the address has no account or has had a few links this hour. Never throws. */
    async function sendResetLink(email: string) {
      try {
        const [user] = await db
          .select()
          .from(users)
          .where(and(eq(users.email, email), isNull(users.deletedAt)))
          .limit(1);
        if (!user || (await linksSentRecently(db, user.id, "reset_password")) >= LINKS_PER_HOUR) return;
        const token = await issueToken(db, { userId: user.id, purpose: "reset_password", email: user.email });
        sendLater(mailer, compose(user.email, emails.resetPassword({ url: link(`/reset-password?token=${token}`) })));
      } catch (error) {
        app.log.error(error);
      }
    }

    /**
     * Always answers the same, straight away, whether or not the address has an account, so this can't be used to
     * find out who's on Trusic. The lookup and email happen without the reply waiting for them.
     */
    app.post("/auth/forgot-password", { config: emailRateLimit }, async (request) => {
      const { email } = z.object({ email: z.string().trim().max(254) }).parse(request.body);
      void sendResetLink(email.toLowerCase());
      return { ok: true as const };
    });

    /** Set a new password from an emailed link. Every other session is signed out, and this one signed in. */
    app.post("/auth/reset-password", { config: authRateLimit }, async (request) => {
      const body = z.object({ token: Token, password: NewPassword }).parse(request.body);
      const passwordHash = await hashPassword(body.password);
      const user = await db.transaction(async (tx) => {
        const used = await consumeToken(tx, body.token, "reset_password");
        if (!used) throw new HttpError(400, `${EXPIRED} Ask for a new one.`);
        const [row] = await tx
          .select()
          .from(users)
          .where(and(eq(users.id, used.userId), isNull(users.deletedAt)))
          .limit(1);
        if (!row) throw new HttpError(400, `${EXPIRED} Ask for a new one.`);
        // The link reached this address, which proves it's theirs.
        const emailVerifiedAt = row.emailVerifiedAt ?? (used.email === row.email ? new Date() : null);
        await tx.update(users).set({ passwordHash, emailVerifiedAt }).where(eq(users.id, row.id));
        await tx.delete(sessions).where(eq(sessions.userId, row.id));
        await cancelTokens(tx, row.id, ["reset_password"]);
        return { ...row, emailVerifiedAt };
      });
      const token = await createSession(db, user.id);
      sendLater(
        mailer,
        compose(user.email, emails.passwordChanged({ name: user.displayName, resetUrl: link("/forgot-password") })),
      );
      return { token, user: toUser(user) } satisfies AuthResponse;
    });

    /** Confirm an address from an emailed link: the account's own, or a new one it's switching to. */
    app.post("/auth/verify-email", { config: authRateLimit }, async (request) => {
      const { token } = z.object({ token: Token }).parse(request.body);
      return db.transaction(async (tx) => {
        const used = (await consumeToken(tx, token, "verify_email")) ?? (await consumeToken(tx, token, "change_email"));
        if (!used) throw new HttpError(400, `${EXPIRED} You can ask for a new one in Settings.`);
        const [user] = await tx
          .select()
          .from(users)
          .where(and(eq(users.id, used.userId), isNull(users.deletedAt)))
          .limit(1);
        if (!user) throw new HttpError(400, EXPIRED);

        if (used.purpose === "verify_email") {
          if (used.email !== user.email) {
            throw new HttpError(400, "This link was for an email address the account no longer uses.");
          }
          if (!user.emailVerifiedAt) {
            await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
          }
          return { email: user.email };
        }

        const [taken] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.email, used.email), ne(users.id, user.id)))
          .limit(1);
        if (taken) throw new HttpError(409, "Another account now uses that email address.");
        await tx.update(users).set({ email: used.email, emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
        // Links sent to the old address must stop working.
        await cancelTokens(tx, user.id, ["verify_email", "change_email", "reset_password"]);
        return { email: used.email };
      });
    });

    app.post("/me/verify-email/resend", { config: emailRateLimit }, async (request) => {
      const user = await requireUser(db, request);
      if (user.emailVerifiedAt) return { ok: true as const };
      if ((await linksSentRecently(db, user.id, "verify_email")) >= LINKS_PER_HOUR) {
        throw new HttpError(
          429,
          "We've sent you a few links already. Please check your inbox and spam folder, or try again in an hour.",
        );
      }
      await sendVerificationEmail(db, mailer, config.publicUrl, user);
      return { ok: true as const };
    });

    app.patch("/me", async (request) => {
      const user = await requireUser(db, request);
      const { displayName } = z.object({ displayName: z.string().trim().min(1).max(60) }).parse(request.body);
      const [updated] = await db.update(users).set({ displayName }).where(eq(users.id, user.id)).returning();
      return { user: toUser(updated!), pendingEmail: await pendingEmail(db, user.id) } satisfies SettingsResult;
    });

    /**
     * Change email address. The account keeps its old address until the new one is confirmed from a link, so a typo
     * can't lock anyone out. The old address is told, in case it wasn't them.
     */
    app.post("/me/email", { config: emailRateLimit }, async (request) => {
      const user = await requireUser(db, request);
      const body = z.object({ email: z.email().max(254), password: z.string().max(200) }).parse(request.body);
      const email = body.email.toLowerCase();
      const row = await loadUser(user.id);
      if (!(await verifyPassword(body.password, row.passwordHash))) {
        throw new HttpError(400, "That password isn't right.");
      }
      if (email === row.email) throw new HttpError(400, "That's already your email address.");
      const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (taken) throw new HttpError(409, "An account with that email already exists.");
      if ((await linksSentRecently(db, user.id, "change_email")) >= LINKS_PER_HOUR) {
        throw new HttpError(429, "You've asked for a few changes already. Please try again in an hour.");
      }

      await cancelTokens(db, user.id, ["change_email"]);
      const token = await issueToken(db, { userId: user.id, purpose: "change_email", email });
      sendLater(
        mailer,
        compose(email, emails.confirmNewEmail({ name: row.displayName, url: link(`/verify-email?token=${token}`) })),
      );
      sendLater(
        mailer,
        compose(
          row.email,
          emails.emailChangeRequested({ name: row.displayName, newEmail: email, settingsUrl: link("/settings") }),
        ),
      );
      return { user: toUser(row), pendingEmail: email } satisfies SettingsResult;
    });

    /** Change password. Needs the current one; signs out every other session. */
    app.post("/me/password", { config: authRateLimit }, async (request, reply) => {
      const user = await requireUser(db, request);
      const body = z.object({ currentPassword: z.string().max(200), newPassword: NewPassword }).parse(request.body);
      const row = await loadUser(user.id);
      if (!(await verifyPassword(body.currentPassword, row.passwordHash))) {
        throw new HttpError(400, "Your current password isn't right.");
      }
      const passwordHash = await hashPassword(body.newPassword);
      const current = hashToken(bearerToken(request)!);
      await db.transaction(async (tx) => {
        await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
        await tx.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.tokenHash, current)));
        await cancelTokens(tx, user.id, ["reset_password"]);
      });
      sendLater(
        mailer,
        compose(row.email, emails.passwordChanged({ name: row.displayName, resetUrl: link("/forgot-password") })),
      );
      return reply.code(204).send();
    });

    app.post("/auth/logout-everywhere", async (request, reply) => {
      const user = await requireUser(db, request);
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      return reply.code(204).send();
    });

    /** Download everything we hold about the account (UK GDPR right of access and portability). */
    app.get("/me/export", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
      const user = await requireUser(db, request);
      const data = await exportAccountData(db, user.id);
      const date = data.exportedAt.slice(0, 10);
      return reply.header("content-disposition", `attachment; filename="trusic-data-${date}.json"`).send(data);
    });

    /** Delete the account (UK GDPR right to erasure). See account-data.ts for what's kept and why. */
    app.post("/me/delete", { config: authRateLimit }, async (request, reply) => {
      const user = await requireUser(db, request);
      const body = z
        .object({
          password: z.string().max(200),
          confirm: z.literal("DELETE", { error: 'Type "DELETE" to confirm.' }),
        })
        .parse(request.body);
      const row = await loadUser(user.id);
      if (!(await verifyPassword(body.password, row.passwordHash))) {
        throw new HttpError(400, "That password isn't right.");
      }
      await deleteAccount(deps, user.id);
      return reply.code(204).send();
    });
  };
