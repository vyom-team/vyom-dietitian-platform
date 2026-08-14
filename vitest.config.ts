import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
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
  resolve: {
    /**
     * Mirrors the `@/*` path alias from tsconfig.
     *
     * Type-only aliased imports are erased at compile time, so earlier suites
     * never needed this. A module with a *runtime* aliased import — such as
     * validations/assessment.ts pulling in the BMI bounds — fails to resolve
     * without it.
     */
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
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
