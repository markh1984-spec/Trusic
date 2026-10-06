import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Embedded Postgres takes a few seconds to boot.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
