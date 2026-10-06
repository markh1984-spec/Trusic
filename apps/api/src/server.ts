import path from "node:path";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";
import { MetadataDetector } from "./detection";
import { LocalAudioStorage } from "./storage";

const config = loadConfig();
const database = await openDatabase({ url: config.databaseUrl, dataDir: path.join(config.dataDir, "pglite") });
const app = await buildApp(
  {
    db: database.db,
    storage: new LocalAudioStorage(path.join(config.dataDir, "audio")),
    detector: new MetadataDetector(),
    config,
  },
  { logger: true },
);

const shutdown = async () => {
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
