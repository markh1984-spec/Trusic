import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { InvalidDeclarationError, PayoutInputError } from "@trusic/core";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config";
import type { Db } from "./db/client";
import type { AiDetector } from "./detection";
import { HttpError } from "./errors";
import { accountRoutes } from "./routes/accounts";
import { adminRoutes } from "./routes/admin";
import { artistRoutes } from "./routes/artists";
import { listeningRoutes } from "./routes/listening";
import { moneyRoutes } from "./routes/money";
import { trackRoutes } from "./routes/tracks";
import type { AudioStorage } from "./storage";

export interface AppDeps {
  db: Db;
  storage: AudioStorage;
  detector: AiDetector;
  config: Config;
}

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
    await app.register(cors, { origin: deps.config.corsOrigins });
  }
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: deps.config.maxUploadBytes, files: 1, fields: 10, fieldSize: 64 * 1024 },
  });

  await app.register(
    async (api) => {
      api.get("/health", async () => ({ ok: true }));
      await api.register(accountRoutes(deps));
      await api.register(artistRoutes(deps));
      await api.register(trackRoutes(deps));
      await api.register(listeningRoutes(deps));
      await api.register(moneyRoutes(deps));
      await api.register(adminRoutes(deps));
    },
    { prefix: "/api" },
  );

  return app;
}
