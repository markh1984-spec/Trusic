// Bundle the server, seed and migrate scripts into dist/ for production, so the server starts quickly and doesn't spend
// memory compiling TypeScript (free hosting allows 512 MB). Workspace packages are bundled in; packages from npm
// stay in node_modules.
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const pkg = JSON.parse(await readFile(new URL("package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith("@trusic/"));

await build({
  entryPoints: ["src/server.ts", "src/seed.ts", "src/migrate.ts"],
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external,
  sourcemap: true,
  logLevel: "info",
});
