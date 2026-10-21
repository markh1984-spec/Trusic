import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { InvalidDeclarationError, PayoutInputError } from "@trusic/core";
import Fastify, { type FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { ZodError } from "zod";
import type { Config } from "./config";
import type { Db } from "./db/client";
import type { AiDetector } from "./detection";
import { HttpError } from "./errors";
import { createMailer, type Mailer } from "./mailer";
import { accountSettingsRoutes } from "./routes/account-settings";
import { accountRoutes } from "./routes/accounts";
import { adminRoutes } from "./routes/admin";
import { artistRoutes } from "./routes/artists";
import { billingRoutes } from "./routes/billing";
import { insightRoutes } from "./routes/insights";
import { libraryRoutes } from "./routes/library";
import { listeningRoutes } from "./routes/listening";
import { moneyRoutes } from "./routes/money";
import { playlistRoutes } from "./routes/playlists";
import { recommendationRoutes } from "./routes/recommendations";
import { releaseRoutes } from "./routes/releases";
import { reportRoutes } from "./routes/reports";
import { trackRoutes } from "./routes/tracks";
import type { MediaStorage } from "./storage";

export interface AppDeps {
  db: Db;
  storage: MediaStorage;
  detector: AiDetector;
  config: Config;
  /** Real payments when configured; null means demo billing. */
  stripe: Stripe | null;
  /** Sends email. Defaults to SMTP if configured, otherwise printing emails to the log. */
  mailer?: Mailer;
}

/** AppDeps with every optional part filled in. */
export type FullAppDeps = AppDeps & { mailer: Mailer };

export async function buildApp(deps: AppDeps, options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof ZodError) {
      const message = error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
      return reply.code(400).send({ error: message.join("; "), issues: error.issues });
    }
    if (error instanceof InvalidDeclarationError || error instanceof PayoutInputError) {
      return reply.code(400).send({ error: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: (error as Error).message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "Something went wrong on our side." });
  });

  if (deps.config.corsOrigins.length > 0) {
    // The plugin only allows GET, HEAD and POST by default; likes, follows and playlist edits need the rest.
    await app.register(cors, {
      origin: deps.config.corsOrigins,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    });
  }
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: deps.config.maxUploadBytes, files: 1, fields: 10, fieldSize: 64 * 1024 },
  });

  const full: FullAppDeps = { ...deps, mailer: deps.mailer ?? createMailer(deps.config) };
  await app.register(
    async (api) => {
      api.get("/health", async () => ({ ok: true }));
      await api.register(accountRoutes(full));
      await api.register(artistRoutes(deps));
      await api.register(trackRoutes(deps));
      await api.register(releaseRoutes(deps));
      await api.register(listeningRoutes(deps));
      await api.register(libraryRoutes(deps));
      await api.register(playlistRoutes(deps));
      await api.register(moneyRoutes(deps));
      await api.register(billingRoutes(deps));
      await api.register(adminRoutes(deps));
      // Account settings, password resets, email confirmation, and reports and takedowns.
      await api.register(accountSettingsRoutes(full));
      await api.register(reportRoutes(full));
      // Artist stats, recommendations and radio.
      await api.register(insightRoutes(deps));
      await api.register(recommendationRoutes(deps));
    },
    { prefix: "/api" },
  );

  return app;
}
