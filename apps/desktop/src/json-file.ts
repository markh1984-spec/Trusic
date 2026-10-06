import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Read a small JSON file from the app's data folder. Missing or damaged files read as undefined. */
export function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Write via a temporary file, so a crash mid-write can't leave half a file behind. */
export function writeJson(file: string, value: unknown): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(temporary, file);
  } catch (error) {
    console.error(`[trusic] Couldn't save ${file}:`, error);
  }
}
