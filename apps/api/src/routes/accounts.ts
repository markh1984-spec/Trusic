import type { AuthResponse, Me } from "@trusic/client";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { bearerToken, createSession, deleteSession, hashPassword, requireUser, verifyPassword } from "../auth";
import { artists, users } from "../db/schema";
import { HttpError } from "../errors";
import { toArtist, toUser } from "../views";

const RegisterBody = z.object({
  email: z.email().max(254),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
  displayName: z.string().trim().min(1).max(60),
});

const LoginBody = z.object({
  email: z.string().max(254),
  password: z.string().max(200),
});

const authRateLimit = { rateLimit: { max: 20, timeWindow: "1 minute" } };

export const accountRoutes =
  ({ db, config }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.post("/auth/register", { config: authRateLimit }, async (request, reply) => {
      const body = RegisterBody.parse(request.body);
      const email = body.email.toLowerCase();
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing) throw new HttpError(409, "An account with that email already exists.");

      const [user] = await db
        .insert(users)
        .values({
          email,
          passwordHash: await hashPassword(body.password),
          displayName: body.displayName,
          isAdmin: config.adminEmails.includes(email),
        })
        .returning();
      const token = await createSession(db, user!.id);
      return reply.code(201).send({ token, user: toUser(user!) } satisfies AuthResponse);
    });

    app.post("/auth/login", { config: authRateLimit }, async (request) => {
      const body = LoginBody.parse(request.body);
      const [user] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase())).limit(1);
      if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
        throw new HttpError(401, "Wrong email or password.");
      }
      const token = await createSession(db, user.id);
      return { token, user: toUser(user) } satisfies AuthResponse;
    });

    app.post("/auth/logout", async (_request, reply) => {
      const token = bearerToken(_request);
      if (token) await deleteSession(db, token);
      return reply.code(204).send();
    });

    app.get("/me", async (request) => {
      const user = await requireUser(db, request);
      const mine = await db.select().from(artists).where(eq(artists.ownerUserId, user.id)).orderBy(artists.createdAt);
      return { user: toUser(user), artists: mine.map(toArtist) } satisfies Me;
    });
  };
