/**
 * Authorization error types.
 *
 * Distinct classes so callers can respond correctly:
 *   - unauthenticated  → redirect to sign-in (handled by `requireAuth`)
 *   - forbidden        → 403, do not redirect; the user is signed in but the
 *                        answer is no, and bouncing them to sign-in would be a
 *                        confusing loop
 *   - no organization  → an onboarding state, not a failure
 *
 * Messages are user-facing and deliberately vague. They never say whether a
 * resource exists, which would let someone probe for valid organization ids.
 */

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";

  constructor(message = "You do not have access to this resource.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NoOrganizationError extends Error {
  readonly code = "NO_ORGANIZATION";

  constructor(message = "Your account is not linked to a practice yet.") {
    super(message);
    this.name = "NoOrganizationError";
  }
}

export function isForbiddenError(error: unknown): error is ForbiddenError {
  return error instanceof ForbiddenError;
}

export function isNoOrganizationError(error: unknown): error is NoOrganizationError {
  return error instanceof NoOrganizationError;
}
