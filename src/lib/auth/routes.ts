/**
 * Route policy — the single source of truth for which paths require a session.
 *
 * Kept free of server-only imports so `proxy.ts` and the Data Access Layer can
 * share it and never disagree about what is protected.
 */

/** Where a signed-in user lands by default. */
export const DEFAULT_SIGNED_IN_PATH = "/dashboard";

export const SIGN_IN_PATH = "/login";

/**
 * Where a signed-in user without a practice is sent.
 *
 * Protected like any application route: onboarding requires a session. It is
 * deliberately *not* in `AUTH_PREFIXES`, because a signed-in user without a
 * practice belongs here rather than being bounced to the dashboard.
 */
export const ONBOARDING_PATH = "/onboarding";

/**
 * Prefixes requiring an authenticated session.
 *
 * Anything not listed is public. That is deliberate: the marketing site must
 * stay reachable, and a default-deny list would silently break it whenever a
 * public page is added.
 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/clients",
  "/plans",
  "/foods",
  "/reports",
  "/team",
  "/subscription",
  "/settings",
  "/support",
  "/onboarding",
] as const;

/** Auth screens a signed-in user should be bounced away from. */
const AUTH_PREFIXES = ["/login", "/register", "/forgot-password"] as const;

function matches(pathname: string, prefixes: readonly string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isProtectedPath(pathname: string): boolean {
  return matches(pathname, PROTECTED_PREFIXES);
}

export function isAuthPath(pathname: string): boolean {
  // `/reset-password` is intentionally excluded: the user arrives there from an
  // email link *while* holding a recovery session, so redirecting signed-in
  // users away would break the flow it exists to serve.
  return matches(pathname, AUTH_PREFIXES);
}

/**
 * Validates a post-sign-in redirect target.
 *
 * Open-redirect defence. Only same-site absolute paths are allowed, so
 * `?next=https://evil.example` or `?next=//evil.example` cannot bounce a
 * freshly-authenticated user off-site.
 *
 * @returns the path when safe, otherwise the default landing path.
 */
export function safeRedirectPath(
  candidate: string | null | undefined,
  fallback: string = DEFAULT_SIGNED_IN_PATH,
): string {
  if (!candidate) return fallback;

  // Must be a rooted path, and must not be protocol-relative ("//host") or
  // contain a backslash, which some browsers normalise into a slash.
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;
  if (candidate.includes("\\")) return fallback;
  if (candidate.includes("://")) return fallback;

  return candidate;
}
