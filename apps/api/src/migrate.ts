// Create the database if needed and bring it up to date, then exit.
//
// The Docker image runs this while it's being built. Creating a new embedded database briefly needs about 700 MB,
// more than free hosting allows, but opening one that already exists needs under 300 MB.
import path from "node:path";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";

const config = loadConfig();
const database = await openDatabase({ url: config.databaseUrl, dataDir: path.join(config.dataDir, "pglite") });
await database.close();
console.log("Database ready.");
