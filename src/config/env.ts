import { z } from "zod";

/**
 * Browser-safe environment configuration.
 *
 * Only `NEXT_PUBLIC_*` values belong here. Everything in this module may end up
 * in the client bundle, so nothing secret can live in it.
 *
 * Server-only values (database URLs, service keys) live in `env.server.ts`,
 * which is guarded by `server-only`. Keeping them in separate modules means a
 * client component that reaches for a secret fails to build instead of leaking
 * one.
 */

const clientSchema = z.object({
  /** Absolute base URL of the deployment. Optional locally. */
  NEXT_PUBLIC_APP_URL: z.url().optional(),
});

/**
 * Statically referenced so Next.js can inline client values at build time.
 * Do not replace this with a dynamic `process.env` spread.
 */
const clientEnvRaw = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

const result = clientSchema.safeParse(clientEnvRaw);

if (!result.success) {
  const issues = result.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

  throw new Error(
    `Invalid client environment variables:\n${issues}\n\n` +
      "See .env.example for the expected shape.",
  );
}

export const clientEnv = result.data;
