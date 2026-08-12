import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";

/**
 * Test configuration.
 *
 * `.env.local` is loaded so RLS_TEST_DATABASE_URL can live alongside the other
 * local settings. dotenv never overwrites an existing variable, so a value
 * exported in CI still wins.
 */
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Database tests share fixtures keyed on a run id; running files in
    // parallel against one database invites interference.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
