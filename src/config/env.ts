import { z } from "zod";

/**
 * Validated environment access.
 *
 * Phase 0 intentionally requires no environment variables — the app runs with
 * an empty `.env.local`. This module exists so that later phases add variables
 * in one validated place instead of scattering `process.env` reads across the
 * codebase.
 *
 * Rules for future phases:
 * - Add server-only secrets to `serverSchema`. Never expose them to the client.
 * - Add browser-safe values to `clientSchema`; they must be `NEXT_PUBLIC_*`.
 * - Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only when
 *   referenced statically, so client vars are listed explicitly below.
 */

const clientSchema = z.object({
  /** Absolute base URL of the deployment. Optional locally. */
  NEXT_PUBLIC_APP_URL: z.url().optional(),
});

const serverSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

/**
 * Statically referenced so Next.js can inline client values at build time.
 * Do not replace this with a dynamic `process.env` spread.
 */
const clientEnvRaw = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown, label: string) {
  const result = schema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid ${label} environment variables:\n${issues}\n\n` +
        "See .env.example for the expected shape.",
    );
  }

  return result.data as z.infer<T>;
}

/** Browser-safe configuration. Safe to import from client components. */
export const clientEnv = parse(clientSchema, clientEnvRaw, "client");

/** Server-only configuration. Never import this from a client component. */
export const serverEnv = parse(
  serverSchema,
  { NODE_ENV: process.env.NODE_ENV },
  "server",
);

export const isProduction = serverEnv.NODE_ENV === "production";
export const isDevelopment = serverEnv.NODE_ENV === "development";
