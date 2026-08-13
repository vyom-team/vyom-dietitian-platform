import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invitation token handling.
 *
 * A valid token grants membership of a practice, so it is a credential and is
 * treated like one:
 *
 *   - **Cryptographically random.** 32 bytes from the OS CSPRNG. Never a UUID,
 *     a database id, or anything derived from the invitation's contents — those
 *     are guessable or enumerable.
 *   - **Stored hashed.** Only the SHA-256 digest reaches the database, so a
 *     leaked backup yields no usable invitation links.
 *   - **Compared in constant time**, so response timing cannot be used to
 *     recover a token digit by digit.
 *
 * SHA-256 without a salt or work factor is deliberate and correct here, unlike
 * for passwords: the input is 256 bits of uniform randomness, so there is no
 * dictionary to attack and nothing for a slow hash to protect against.
 */

/** 32 bytes → 256 bits of entropy, well beyond brute force. */
const TOKEN_BYTES = 32;

/**
 * How long an invitation stays valid.
 *
 * Seven days: long enough to survive a weekend and a missed inbox, short enough
 * that a forgotten invitation in an old email does not remain a way into a
 * practice months later.
 */
export const INVITATION_TTL_DAYS = 7;

export function generateInvitationToken(): { token: string; tokenHash: string } {
  // base64url: URL-safe with no percent-encoding, so the token survives being
  // pasted, wrapped by a mail client, or copied out of a browser bar.
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time comparison of two token hashes.
 *
 * Lookup is by hash equality in the database, but any in-process comparison
 * uses this so no code path leaks timing information.
 */
export function tokenHashesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  // timingSafeEqual throws on length mismatch, which would itself be a signal.
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function invitationExpiryFromNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function isInvitationExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Builds the acceptance link.
 *
 * The origin comes from configuration or the request, never from a
 * caller-supplied value: an attacker-controlled host would turn every
 * invitation email into a credential-harvesting link pointing at their server.
 */
export function buildInvitationUrl(origin: string, token: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/invite/${encodeURIComponent(token)}`;
}
