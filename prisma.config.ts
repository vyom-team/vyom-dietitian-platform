import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

/**
 * Next.js reads `.env.local` but the Prisma CLI does not, so load it here
 * explicitly. Without this the app and the CLI would read different files and
 * could point at different databases — migrations would silently apply
 * somewhere other than where the app reads.
 *
 * `.env.local` is loaded first and wins: dotenv never overwrites a variable
 * that is already set, and real shell environment variables (CI, Vercel) still
 * take precedence over both files.
 */
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

/**
 * Prisma CLI configuration (migrations, introspection, seeding).
 *
 * Connection strategy for Supabase — two URLs, used in different places:
 *
 *   DIRECT_URL   port 5432, a direct connection. Used *here*, by the CLI.
 *                Migrations issue DDL and advisory locks, which do not survive
 *                a transaction-mode connection pooler.
 *
 *   DATABASE_URL port 6543, the Supabase pooler. Used by the *application* at
 *                runtime via the driver adapter in src/lib/prisma.ts, where
 *                short-lived serverless connections need pooling.
 *
 * Prisma 7 removed `directUrl` from the datasource block, so the split is
 * expressed by pointing each consumer at the right variable rather than by
 * configuring both in one place.
 *
 * DIRECT_URL falls back to DATABASE_URL for setups with no separate pooler
 * (a local Postgres, for instance).
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
