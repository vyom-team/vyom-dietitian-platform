/**
 * Slug generation.
 *
 * Slugs are always derived on the server from the practice name. A
 * client-supplied slug is never accepted: it ends up in URLs and in unique
 * constraints, so letting the browser choose it invites collisions, spoofed
 * paths, and traversal attempts.
 *
 * The output alphabet is deliberately narrow — `[a-z0-9-]` only — which makes
 * path traversal (`../`), scheme injection (`javascript:`), and query smuggling
 * (`?`, `#`) structurally impossible rather than filtered case by case.
 */

/** Slug column is VARCHAR(80); leave room for a numeric suffix. */
const MAX_BASE_LENGTH = 72;

/**
 * Reserved words that must never become a practice slug.
 *
 * A practice slugged `admin` or `api` would collide with application routes
 * once slugs appear in URLs, and one slugged `login` could be used to make a
 * convincing phishing path.
 */
const RESERVED = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "billing",
  "clients",
  "dashboard",
  "foods",
  "help",
  "internal",
  "login",
  "logout",
  "new",
  "onboarding",
  "plans",
  "pricing",
  "register",
  "reports",
  "settings",
  "signin",
  "signup",
  "subscription",
  "super-admin",
  "support",
  "system",
  "team",
  "vyom",
  "www",
]);

/**
 * Converts a practice name into a URL-safe base slug.
 *
 * Unicode is decomposed first so accented Latin characters keep their base
 * letter — "Café Nutrición" becomes "cafe-nutricion" rather than losing them.
 * Scripts with no Latin equivalent (Devanagari, for instance) legitimately
 * reduce to nothing; the caller must handle an empty result.
 */
export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    // Strip combining marks left behind by the decomposition.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Anything outside the safe alphabet becomes a separator.
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_LENGTH)
    // A trailing hyphen can reappear after the slice.
    .replace(/-+$/g, "");

  return base;
}

/**
 * A guaranteed-usable base slug.
 *
 * Falls back to a generic stem when the name yields nothing usable — a
 * practice named entirely in Devanagari, say — so onboarding never fails over
 * an unromanisable name. Uniqueness is then handled by the candidate sequence.
 */
export function toBaseSlug(name: string): string {
  const slug = slugify(name);
  if (!slug || RESERVED.has(slug)) return `practice-${slug || "new"}`.slice(0, MAX_BASE_LENGTH);
  return slug;
}

/**
 * Deterministic candidate sequence for a name: `base`, `base-2`, `base-3`, …
 *
 * The caller tries each in order against the unique index. Determinism keeps
 * the result predictable and testable; the database constraint — not this
 * function — is what ultimately guarantees uniqueness, so two simultaneous
 * signups racing for the same name resolve correctly.
 */
export function* slugCandidates(name: string, limit = 50): Generator<string> {
  const base = toBaseSlug(name);
  yield base;

  for (let suffix = 2; suffix <= limit; suffix += 1) {
    const tail = `-${suffix}`;
    yield `${base.slice(0, MAX_BASE_LENGTH - tail.length)}${tail}`;
  }
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug);
}
