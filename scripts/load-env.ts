import { config as loadEnv } from "dotenv";

/**
 * Environment loading for standalone scripts (seed, verify).
 *
 * Next.js reads `.env.local` automatically; plain Node scripts do not. Import
 * this first so a script and the running app always read the same credentials.
 *
 * `.env.local` is loaded first and wins — dotenv never overwrites a variable
 * that is already set — and real shell environment variables take precedence
 * over both files.
 */
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

/** The connection string scripts should use. Migrations and one-off scripts
 *  prefer the direct connection; pooled works when there is no separate pooler. */
export const scriptConnectionString =
  process.env.DIRECT_URL ?? process.env.DATABASE_URL;
