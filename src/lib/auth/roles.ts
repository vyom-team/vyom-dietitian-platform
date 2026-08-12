import type { OrganizationRole } from "@/generated/prisma/enums";

/**
 * Role model.
 *
 * Phase 3 is role-based, not permission-based: there is no permissions table
 * and no policy engine. Roles are sufficient for the access decisions the
 * product actually makes today, and a granular permission system can be
 * introduced later against a real requirement rather than a guessed one.
 */

/**
 * SUPER_ADMIN is a *platform* role, not an organization role.
 *
 * It is never granted through organization onboarding or team invitations. It
 * is assigned out of band by the Vyom team, and `assignableRoles` below exists
 * to make sure organization-facing code can never offer it. The Super Admin
 * product surface belongs to a much later phase.
 */
export const PLATFORM_ROLES = ["SUPER_ADMIN"] as const;

/** Roles a practitioner organization can grant to its own members. */
export const ASSIGNABLE_ORGANIZATION_ROLES = [
  "OWNER",
  "DIETITIAN",
  "RECEPTIONIST",
] as const;

/**
 * CLIENT is an organization role but is never assignable through team
 * management — it is created when a practitioner invites a client, and it
 * grants the client portal rather than practitioner functionality.
 */
export const CLIENT_ROLE = "CLIENT" as const;

/** Roles that may use the practitioner application at all. */
export const PRACTITIONER_ROLES = [
  "SUPER_ADMIN",
  "OWNER",
  "DIETITIAN",
  "RECEPTIONIST",
] as const satisfies readonly OrganizationRole[];

/** Roles that administer an organization: billing, team, practice settings. */
export const ORGANIZATION_ADMIN_ROLES = [
  "SUPER_ADMIN",
  "OWNER",
] as const satisfies readonly OrganizationRole[];

/** Roles that may work with client records and nutrition plans. */
export const CLINICAL_ROLES = [
  "SUPER_ADMIN",
  "OWNER",
  "DIETITIAN",
] as const satisfies readonly OrganizationRole[];

export function isPlatformRole(role: OrganizationRole): boolean {
  return (PLATFORM_ROLES as readonly string[]).includes(role);
}

/**
 * Whether a role may be granted by organization-facing code.
 *
 * Guards against privilege escalation: a request asking to create or change a
 * membership must pass its desired role through this before it reaches the
 * database. SUPER_ADMIN and CLIENT both fail it.
 */
export function isAssignableOrganizationRole(
  role: string,
): role is (typeof ASSIGNABLE_ORGANIZATION_ROLES)[number] {
  return (ASSIGNABLE_ORGANIZATION_ROLES as readonly string[]).includes(role);
}

export function hasRole(
  role: OrganizationRole,
  allowed: readonly OrganizationRole[],
): boolean {
  return allowed.includes(role);
}

/** Human-readable labels for UI. */
export const ROLE_LABELS: Record<OrganizationRole, string> = {
  SUPER_ADMIN: "Platform admin",
  OWNER: "Owner",
  DIETITIAN: "Dietitian",
  RECEPTIONIST: "Receptionist",
  CLIENT: "Client",
};
