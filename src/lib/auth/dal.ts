import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import type { MembershipStatus, OrganizationRole } from "@/generated/prisma/enums";
import { isAuthConfigured } from "@/config/env";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_SIGNED_IN_PATH,
  ONBOARDING_PATH,
  SIGN_IN_PATH,
} from "@/lib/auth/routes";
import { ForbiddenError, NoOrganizationError } from "@/lib/auth/errors";

/**
 * Data Access Layer — the authoritative authorization boundary.
 *
 * WHY THIS EXISTS, AND WHY IT MATTERS MORE THAN RLS HERE
 * -----------------------------------------------------
 * Prisma connects to Postgres as the project's database user, which is *not*
 * the `authenticated` Postgres role and therefore **bypasses Row Level
 * Security entirely**. RLS still protects everything reached through the
 * Supabase client (PostgREST, browser, realtime), but it will not save a
 * careless Prisma query.
 *
 * So for server code the rule is absolute: never query a tenant-owned table
 * without an `organizationId` that came from `requireOrganizationAccess()`.
 * Never take an organization id from a request body, query string, or form
 * field and trust it. `assertOrganizationAccess` is what turns an untrusted id
 * into a verified one.
 *
 * Every read here is wrapped in React's `cache()` so a request that checks
 * authorization in a layout, a page, and an action still hits the database
 * once.
 */

export type AuthenticatedUser = {
  authUserId: string;
  email: string;
  profileId: string;
  fullName: string | null;
  memberships: MembershipSummary[];
};

export type MembershipSummary = {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrganizationRole;
  status: MembershipStatus;
};

/**
 * The verified Supabase auth user, or null.
 *
 * Uses `getUser()`, which revalidates the token against Supabase's auth
 * server. `getSession()` only decodes the cookie and would trust a forged one,
 * so it must never be used for an authorization decision.
 */
export const getAuthUser = cache(async (): Promise<User | null> => {
  // Pure environment check, deliberately before any request API is touched.
  if (!isAuthConfigured) return null;

  /*
   * `createClient()` reads cookies(), and that call is also how Next.js learns
   * the route is dynamic. It must NOT be wrapped in a try/catch: swallowing it
   * hides the signal, and Next then statically prerenders the page — baking one
   * request's auth outcome into a cached response served to everyone.
   */
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    // Auth server unreachable. Fail closed: no user.
    return null;
  }
});

/**
 * The signed-in user with their profile and memberships, or null.
 *
 * Only ACTIVE memberships are returned. INVITED, SUSPENDED, and REMOVED
 * memberships confer no access, so they never reach an authorization decision.
 */
export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const authUser = await getAuthUser();
  if (!authUser) return null;

  const profile = await prisma.userProfile.findUnique({
    where: { authUserId: authUser.id },
    select: {
      id: true,
      email: true,
      fullName: true,
      memberships: {
        where: { status: "ACTIVE" },
        select: {
          id: true,
          organizationId: true,
          role: true,
          status: true,
          organization: { select: { name: true, slug: true, status: true } },
        },
      },
    },
  });

  if (!profile) return null;

  return {
    authUserId: authUser.id,
    email: profile.email,
    profileId: profile.id,
    fullName: profile.fullName,
    memberships: profile.memberships
      // A suspended or archived organization grants nothing, regardless of the
      // membership's own status.
      .filter((membership) => membership.organization.status === "ACTIVE")
      .map((membership) => ({
        membershipId: membership.id,
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        organizationSlug: membership.organization.slug,
        role: membership.role,
        status: membership.status,
      })),
  };
});

/**
 * Requires a signed-in user, redirecting to sign-in otherwise.
 *
 * Use in Server Components and layouts. In Server Actions and Route Handlers
 * prefer `getCurrentUser()` and return an error, since redirecting mid-action
 * produces a confusing result.
 */
export async function requireAuth(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) redirect(SIGN_IN_PATH);
  return user;
}

/**
 * Requires a user who belongs to at least one organization.
 *
 * @throws {NoOrganizationError} when authenticated but unaffiliated — the state
 * organization onboarding will resolve in a later phase.
 */
export async function requireOrganization(): Promise<{
  user: AuthenticatedUser;
  membership: MembershipSummary;
}> {
  const user = await requireAuth();
  const membership = user.memberships[0];

  if (!membership) throw new NoOrganizationError();

  return { user, membership };
}

/**
 * Turns an untrusted organization id into a verified one.
 *
 * This is the IDOR guard. Any handler receiving an organization id from the
 * client must pass it through here before it touches a query.
 *
 * @throws {ForbiddenError} when the user has no active membership there. The
 * message is deliberately identical whether the organization does not exist or
 * the user simply lacks access, so it cannot be used to probe for valid ids.
 */
export async function requireOrganizationAccess(
  organizationId: string,
): Promise<MembershipSummary> {
  const user = await requireAuth();
  const membership = user.memberships.find(
    (candidate) => candidate.organizationId === organizationId,
  );

  if (!membership) throw new ForbiddenError();

  return membership;
}

/**
 * Requires one of `allowed` roles within a specific organization.
 *
 * @throws {ForbiddenError} when the membership's role is not permitted.
 */
export async function requireRole(
  organizationId: string,
  allowed: readonly OrganizationRole[],
): Promise<MembershipSummary> {
  const membership = await requireOrganizationAccess(organizationId);

  if (!allowed.includes(membership.role)) throw new ForbiddenError();

  return membership;
}

/**
 * Gate for the onboarding routes: requires a signed-in user with **no**
 * practice yet.
 *
 * Someone who already belongs to a practice is sent to the application instead,
 * which is what stops a completed user from re-entering onboarding and creating
 * a second practice by accident.
 *
 * Membership is read from the database on every call — never from a cookie, a
 * client flag, or `localStorage`. The presence of a membership row *is* the
 * definition of "onboarded", so there is no second source of truth to drift.
 */
export async function requireOnboardingAccess(): Promise<AuthenticatedUser> {
  const user = await requireAuth();
  if (user.memberships.length > 0) redirect(DEFAULT_SIGNED_IN_PATH);
  return user;
}

/**
 * Gate for the application routes: requires a signed-in user who has a practice.
 *
 * The mirror image of `requireOnboardingAccess`. Together the two are total and
 * disjoint — a signed-in user satisfies exactly one — which is what makes a
 * redirect loop impossible: each guard sends the user to a route governed by
 * the other, and that route accepts them.
 */
export async function requireMembership(): Promise<{
  user: AuthenticatedUser;
  membership: MembershipSummary;
}> {
  const user = await requireAuth();
  const membership = user.memberships[0];

  if (!membership) redirect(ONBOARDING_PATH);

  return { user, membership };
}

/**
 * The caller's practice context for client work.
 *
 * Bundles the three values every client query needs — organization, membership,
 * and role — so callers cannot accidentally build a query with an organization
 * id from somewhere else. There is no variant of this that accepts an
 * organization id as an argument, which is deliberate.
 *
 * @throws redirects to onboarding when the user has no practice.
 */
export async function requireClientContext(): Promise<{
  user: AuthenticatedUser;
  viewer: {
    organizationId: string;
    membershipId: string;
    role: OrganizationRole;
  };
}> {
  const { user, membership } = await requireMembership();

  /*
   * A CLIENT-role member belongs to the practice but is not staff. The client
   * portal is a later phase with much narrower access; letting them reach the
   * staff module would expose every other client of the practice.
   */
  if (membership.role === "CLIENT") throw new ForbiddenError();

  return {
    user,
    viewer: {
      organizationId: membership.organizationId,
      membershipId: membership.membershipId,
      role: membership.role,
    },
  };
}

/**
 * The user's membership in a given organization, or null. Non-throwing variant
 * for conditionally rendering UI.
 *
 * Hiding a control is a usability affordance, never an authorization control —
 * the action behind it must still call `requireRole`.
 */
export async function getMembership(
  organizationId: string,
): Promise<MembershipSummary | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    user.memberships.find(
      (membership) => membership.organizationId === organizationId,
    ) ?? null
  );
}
