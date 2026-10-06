import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";
import { setDemoPassword } from "./demo";
import { MetadataDetector } from "./detection";
import { webDistDir } from "./paths";
import { createStripeClient } from "./routes/billing";
import { LocalMediaStorage } from "./storage";

const config = loadConfig();
const database = await openDatabase({ url: config.databaseUrl, dataDir: path.join(config.dataDir, "pglite") });
// A hosted demo is built with the demo accounts in it, using the default password. Give them this site's own.
if (process.env.DEMO_PASSWORD) await setDemoPassword(database.db, config.demoPassword);
const app = await buildApp(
  {
    db: database.db,
    storage: new LocalMediaStorage(path.join(config.dataDir, "media")),
    detector: new MetadataDetector(),
    config,
    stripe: createStripeClient(config),
  },
  { logger: true },
);

// In production, serve the built web app from the same origin as the API.
const webDist = process.env.WEB_DIST ?? webDistDir;
if (existsSync(path.join(webDist, "index.html"))) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== "GET" || request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found." });
    }
    return reply.sendFile("index.html");
  });
  app.log.info(`Serving the web app from ${webDist}`);
}

const shutdown = async () => {
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
