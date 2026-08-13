import { z } from "zod";

import type { OrganizationRole } from "@/generated/prisma/enums";

/**
 * Team management schemas.
 *
 * The role field is the sensitive one. It is an enum of exactly the two roles a
 * practice may invite, so `OWNER`, `SUPER_ADMIN`, and `CLIENT` fail validation
 * before any code sees them — a request asking for them is rejected at the
 * boundary rather than being caught by a later check.
 *
 * `organizationId` is deliberately absent from every schema here. It comes from
 * the verified session, never from the request.
 */

/**
 * Roles a practice can invite.
 *
 * - `OWNER` is excluded: ownership is conferred by creating a practice, and a
 *   later transfer flow will be an explicit, separately-authorized action.
 * - `SUPER_ADMIN` is a platform role, never granted by a tenant.
 * - `CLIENT` is not staff; client accounts come from the client portal.
 *
 * `ASSISTANT` appears in the product vocabulary but is not in the database enum,
 * so it is not offered. Adding an unused role now would be speculation.
 */
export const INVITABLE_ROLES = ["DIETITIAN", "RECEPTIONIST"] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(value: string): value is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(value);
}

const teamEmail = z
  .string()
  .trim()
  .min(1, "Enter an email address")
  .max(255, "Email is too long")
  .toLowerCase()
  .refine((value) => z.email().safeParse(value).success, {
    message: "Enter a valid email address",
  });

export const inviteMemberSchema = z.object({
  email: teamEmail,
  role: z.enum(INVITABLE_ROLES, {
    message: "Select a role",
  }),
  message: z
    .string()
    .trim()
    .max(500, "Message must be 500 characters or fewer")
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/**
 * Role change for an existing member.
 *
 * Same allowlist as invitations: a member cannot be promoted to OWNER through
 * this path, and SUPER_ADMIN is unreachable entirely.
 */
export const changeRoleSchema = z.object({
  membershipId: z.uuid("Invalid member"),
  role: z.enum(INVITABLE_ROLES, { message: "Select a role" }),
});

export const membershipActionSchema = z.object({
  membershipId: z.uuid("Invalid member"),
});

export const revokeInvitationSchema = z.object({
  invitationId: z.uuid("Invalid invitation"),
});

/** Display labels. Keep in step with `ROLE_LABELS` in lib/auth/roles.ts. */
export const INVITABLE_ROLE_LABELS: Record<InvitableRole, string> = {
  DIETITIAN: "Dietitian",
  RECEPTIONIST: "Receptionist",
};

export const INVITABLE_ROLE_DESCRIPTIONS: Record<InvitableRole, string> = {
  DIETITIAN: "Works with clients, plans, and nutrition targets.",
  RECEPTIONIST: "Handles scheduling and day-to-day administration.",
};

/** Narrowing helper for values coming back from the database. */
export function asOrganizationRole(value: string): OrganizationRole {
  return value as OrganizationRole;
}
