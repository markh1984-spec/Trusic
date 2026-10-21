// Put the demo data this Docker image was built with into a database that lasts (DATABASE_URL), and its files into
// the S3_ storage, the first time the site starts with them: only into an empty database. deploy/start.sh runs this.
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";
import { users } from "./db/schema";
import { copyDemoData } from "./demo-copy";
import { createStorage } from "./storage";

const config = loadConfig();
const builtIn = path.join(config.dataDir, "pglite");
if (!config.databaseUrl || !existsSync(builtIn)) {
  console.log("No demo data to load here.");
  process.exit(0);
}

const target = await openDatabase({ url: config.databaseUrl });
const [existing] = await target.db.select({ id: users.id }).from(users).limit(1);
if (existing) {
  console.log("The database already has data, so the demo data isn't loaded again.");
  await target.close();
  process.exit(0);
}

const source = await openDatabase({ dataDir: builtIn });
const [demo] = await source.db.select({ id: users.id }).from(users).limit(1);
if (!demo) {
  console.log("This image was built without demo data (DEMO_SEED=false), so there's none to load.");
} else {
  console.log("Loading the demo data into the database for the first time…");
  // Without S3 settings, files stay on this server's disk, where the image already has them.
  const storage = config.s3 ? createStorage(config) : null;
  await storage?.check();
  const copied = await copyDemoData({
    source: source.db,
    target: target.db,
    mediaDir: path.join(config.dataDir, "media"),
    storage,
    log: (message) => console.log(`  ${message}`),
  });
  console.log(`Demo data loaded: ${copied.rows} rows and ${copied.files} files.`);
}
await source.close();
await target.close();
