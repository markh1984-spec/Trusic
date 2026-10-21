import { existsSync } from "node:fs";
import path from "node:path";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";
import { setDemoPassword } from "./demo";
import { MetadataDetector } from "./detection";
import { webDistDir } from "./paths";
import { createStripeClient } from "./routes/billing";
import { LocalMediaStorage } from "./storage";
import { serveWebApp } from "./web-app";

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

app.log.info(
  config.mail.smtp
    ? `Sending email through ${config.mail.smtp.host}`
    : "No SMTP server set (SMTP_HOST), so emails are printed to this log instead of sent",
);

// In production, serve the built web app from the same origin as the API, with link previews for shared pages.
const webDist = process.env.WEB_DIST ?? webDistDir;
if (existsSync(path.join(webDist, "index.html"))) {
  await serveWebApp(app, { db: database.db, config }, webDist);
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
