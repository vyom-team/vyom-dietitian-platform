import "server-only";

import { z } from "zod";

/**
 * Server-only environment configuration.
 *
 * `server-only` makes importing this from a client component a build error, so
 * connection strings and service keys cannot reach the browser bundle.
 *
 * Validation is **lazy**. Parsing at module load would mean any import of this
 * file crashes the whole app when the database is not configured; instead it
 * runs on first access, so only the code paths that actually touch the database
 * fail — the Phase 1 UI keeps working with no `.env.local` at all.
 */

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /**
   * Pooled Postgres connection used by the application at runtime.
   * Supabase: the port 6543 pooler URL.
   */
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required to reach the database")
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must be a PostgreSQL connection string",
    ),

  /**
   * Direct (unpooled) connection used by the Prisma CLI for migrations.
   * Supabase: the port 5432 URL. Optional — falls back to DATABASE_URL for
   * setups without a separate pooler.
   */
  DIRECT_URL: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

/**
 * Parses and caches server environment variables on first call.
 *
 * @throws if a required variable is missing or malformed. The message names the
 * offending variables and never echoes their values.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const result = serverSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid server environment variables:\n${issues}\n\n` +
        "Copy .env.example to .env.local and fill in the database settings.\n" +
        "See docs/database.md for where to find them in Supabase.",
    );
  }

  cached = result.data;
  return cached;
}

/**
 * Whether the database is configured, without throwing.
 *
 * Lets a page render a "not configured yet" state instead of an error during
 * the phases where the database is optional.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export const isProduction = process.env.NODE_ENV === "production";
export const isDevelopment = process.env.NODE_ENV === "development";
