import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";
import { setDemoPassword } from "./demo";
import { MetadataDetector } from "./detection";
import { MediaProcessor } from "./media/processor";
import { webDistDir } from "./paths";
import { createStripeClient } from "./routes/billing";
import { createStorage } from "./storage";

const config = loadConfig();
const database = await openDatabase({ url: config.databaseUrl, dataDir: path.join(config.dataDir, "pglite") });
// A hosted demo is built with the demo accounts in it, using the default password. Give them this site's own.
if (process.env.DEMO_PASSWORD) await setDemoPassword(database.db, config.demoPassword);
const storage = createStorage(config);
const media = await MediaProcessor.create({ db: database.db, storage, ffmpegPath: config.ffmpegPath });
const app = await buildApp(
  {
    db: database.db,
    storage,
    detector: new MetadataDetector(),
    config,
    stripe: createStripeClient(config),
    media,
  },
  { logger: true },
);

app.log.info(
  config.mail.smtp
    ? `Sending email through ${config.mail.smtp.host}`
    : "No SMTP server set (SMTP_HOST), so emails are printed to this log instead of sent",
);
app.log.info(`Files are kept in ${storage.description}.`);
await storage.check().catch((error: Error) => app.log.error(error.message));
// Keeping one without the other loses data on a restart: the database would point at files that are gone, or the
// other way round.
if (config.databaseUrl && !config.s3) {
  app.log.warn(
    "DATABASE_URL is set but the S3_ settings aren't: uploads are on this server's disk, which may not last.",
  );
} else if (config.s3 && !config.databaseUrl) {
  app.log.warn(
    "The S3_ settings are set but DATABASE_URL isn't: the database is on this server's disk, which may not last.",
  );
}

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
  await media.stop();
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
// Picks up any uploads that were waiting, including ones interrupted by a restart.
media.start(app.log);
