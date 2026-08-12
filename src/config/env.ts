import { z } from "zod";

/**
 * Browser-safe environment configuration.
 *
 * Only `NEXT_PUBLIC_*` values belong here. Everything in this module may end up
 * in the client bundle, so nothing secret can live in it.
 *
 * The Supabase URL and publishable key are *designed* to be public: the
 * publishable key identifies the project and grants nothing on its own. Every
 * request it makes is still constrained by Row Level Security. The service-role
 * key is the dangerous one and lives in `env.server.ts`, never here.
 *
 * Server-only values live in `env.server.ts`, guarded by `server-only`. Keeping
 * them in separate modules means a client component that reaches for a secret
 * fails to build instead of leaking one.
 */

const clientSchema = z.object({
  /** Absolute base URL of the deployment. Optional locally. */
  NEXT_PUBLIC_APP_URL: z.url().optional(),

  /** Supabase project URL, e.g. https://<project-ref>.supabase.co */
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),

  /**
   * Supabase publishable key (`sb_publishable_...`), or the legacy `anon` JWT.
   * Public by design and RLS-constrained.
   */
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
});

/**
 * Statically referenced so Next.js can inline client values at build time.
 * Do not replace this with a dynamic `process.env` spread.
 */
const clientEnvRaw = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    // Older projects issue an `anon` key under this name. Accepted so an
    // existing Supabase project works without renaming anything.
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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

/**
 * Whether Supabase Auth is configured.
 *
 * Lets the UI show an honest "authentication not configured" state instead of
 * crashing when the keys are absent — the app still builds and the marketing
 * site still renders without them.
 */
export const isAuthConfigured = Boolean(
  clientEnv.NEXT_PUBLIC_SUPABASE_URL &&
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

/**
 * Supabase connection details, or `null` when unconfigured.
 * Callers must handle `null` rather than assuming configuration exists.
 */
export function getSupabaseConfig(): { url: string; key: string } | null {
  const url = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const key = clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}
