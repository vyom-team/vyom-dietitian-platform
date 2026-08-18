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
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      /*
       * `server-only` throws when resolved outside Next's server condition,
       * which would make every service importing it impossible to test. The
       * alias applies to the test run only — the real package still guards the
       * application build.
       */
      "server-only": resolve(import.meta.dirname, "tests/helpers/server-only-stub.ts"),
    },
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
