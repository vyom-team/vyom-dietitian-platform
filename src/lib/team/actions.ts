"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireAuth, requireRole } from "@/lib/auth/dal";
import { ORGANIZATION_ADMIN_ROLES, ROLE_LABELS } from "@/lib/auth/roles";
import { buildInvitationUrl } from "@/lib/invitation-token";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/auth/routes";
import { buildInvitationEmail, sendEmail } from "@/services/email";
import {
  acceptInvitation,
  changeMemberRole,
  inviteMember,
  revokeInvitation,
  setMembershipStatus,
} from "@/services/team";
import {
  changeRoleSchema,
  inviteMemberSchema,
  membershipActionSchema,
  revokeInvitationSchema,
} from "@/validations/team";

/**
 * Team management Server Actions.
 *
 * Every action follows the same shape:
 *
 *   requireAuth() → resolve the caller's own organization → requireRole(OWNER)
 *   → validate input → delegate to the service
 *
 * The organization id is **never** taken from the form. It comes from the
 * caller's session-derived membership, so a request cannot name a practice its
 * sender does not belong to. That single decision removes the entire class of
 * cross-tenant attacks these actions would otherwise be exposed to.
 */

export type TeamActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
  /**
   * Invitation link, returned only when email delivery is unavailable so the
   * owner can share it directly. Never persisted, never logged.
   */
  inviteUrl?: string;
};

/**
 * Resolves the caller's organization and asserts they administer it.
 *
 * The organization comes from the session rather than the request, which is
 * what makes every action below tenant-safe by construction.
 */
async function requireAdminOrganization() {
  const user = await requireAuth();
  const membership = user.memberships[0];

  if (!membership) redirect(DEFAULT_SIGNED_IN_PATH);

  // Throws ForbiddenError for a non-admin. Re-verifies membership against the
  // database rather than trusting the summary.
  await requireRole(membership.organizationId, ORGANIZATION_ADMIN_ROLES);

  return { user, membership };
}

async function getOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const protocol = headerList.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

function fieldErrorsFrom(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !result[key]) result[key] = issue.message;
  }
  return result;
}

// ---------------------------------------------------------------------------

export async function inviteMemberAction(
  _previous: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const { user, membership } = await requireAdminOrganization();

  const parsed = inviteMemberSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
    message: formData.get("message"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const result = await inviteMember(
    membership.organizationId,
    user.profileId,
    parsed.data,
  );

  if (!result.ok) {
    const message =
      result.reason === "already-member"
        ? "That person is already part of your team."
        : result.reason === "invalid-role"
          ? "That role cannot be invited."
          : "Unable to send invitation. Please try again.";
    return { status: "error", message };
  }

  const acceptUrl = buildInvitationUrl(await getOrigin(), result.token);

  const delivery = await sendEmail(
    buildInvitationEmail({
      to: parsed.data.email,
      practiceName: membership.organizationName,
      roleLabel: ROLE_LABELS[parsed.data.role],
      inviterName: user.fullName ?? user.email,
      acceptUrl,
      expiresAt: result.expiresAt,
      message: parsed.data.message,
    }),
  );

  revalidatePath("/team");

  /*
   * When no mail provider is configured, say so and hand the owner the link
   * rather than claiming an email was sent. Reporting success for a message
   * that never left the building would be a lie the owner only discovers when
   * the invitee never arrives.
   */
  if (!delivery.delivered) {
    return {
      status: "success",
      message:
        `Invitation created for ${parsed.data.email}. Email delivery is not ` +
        "configured yet, so share this link with them directly.",
      inviteUrl: acceptUrl,
    };
  }

  return {
    status: "success",
    message: `Invitation sent to ${parsed.data.email}.`,
  };
}

// ---------------------------------------------------------------------------

export async function revokeInvitationAction(
  _previous: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const { membership } = await requireAdminOrganization();

  const parsed = revokeInvitationSchema.safeParse({
    invitationId: formData.get("invitationId"),
  });

  if (!parsed.success) {
    return { status: "error", message: "That invitation is no longer valid." };
  }

  // Scoped by organization inside the service, so an id from another practice
  // simply matches nothing.
  const revoked = await revokeInvitation(
    membership.organizationId,
    parsed.data.invitationId,
  );

  revalidatePath("/team");

  return revoked
    ? { status: "success", message: "Invitation revoked." }
    : { status: "error", message: "That invitation is no longer valid." };
}

// ---------------------------------------------------------------------------

export async function changeRoleAction(
  _previous: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const { membership } = await requireAdminOrganization();

  const parsed = changeRoleSchema.safeParse({
    membershipId: formData.get("membershipId"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { status: "error", message: "Select a valid role." };
  }

  const result = await changeMemberRole(
    membership.organizationId,
    parsed.data.membershipId,
    parsed.data.role,
  );

  revalidatePath("/team");

  if (!result.ok) {
    const message =
      result.reason === "last-owner"
        ? "Assign another owner before changing this role."
        : result.reason === "not-found"
          ? "That team member could not be found."
          : "Unable to change role. Please try again.";
    return { status: "error", message };
  }

  return { status: "success", message: "Role updated." };
}

// ---------------------------------------------------------------------------

export async function suspendMemberAction(
  _previous: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  return setStatus(formData, "SUSPENDED", "Team member suspended.");
}

export async function reactivateMemberAction(
  _previous: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  return setStatus(formData, "ACTIVE", "Team member reactivated.");
}

export async function removeMemberAction(
  _previous: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  return setStatus(formData, "REMOVED", "Team member removed from the practice.");
}

async function setStatus(
  formData: FormData,
  status: "ACTIVE" | "SUSPENDED" | "REMOVED",
  successMessage: string,
): Promise<TeamActionState> {
  const { user, membership } = await requireAdminOrganization();

  const parsed = membershipActionSchema.safeParse({
    membershipId: formData.get("membershipId"),
  });

  if (!parsed.success) {
    return { status: "error", message: "That team member could not be found." };
  }

  const result = await setMembershipStatus(
    membership.organizationId,
    parsed.data.membershipId,
    status,
    user.profileId,
  );

  revalidatePath("/team");

  if (!result.ok) {
    const message =
      result.reason === "last-owner"
        ? "Assign another owner before removing this one."
        : result.reason === "self"
          ? "You can't suspend or remove yourself."
          : result.reason === "not-found"
            ? "That team member could not be found."
            : "Unable to update this team member. Please try again.";
    return { status: "error", message };
  }

  return { status: "success", message: successMessage };
}

// ---------------------------------------------------------------------------

export type AcceptInvitationState = {
  status: "idle" | "error";
  message?: string;
};

/**
 * Accepts an invitation.
 *
 * Not admin-gated — the caller is joining, not managing. It requires a signed-in
 * user, and the service enforces that their email matches the invited address.
 */
export async function acceptInvitationAction(
  _previous: AcceptInvitationState,
  formData: FormData,
): Promise<AcceptInvitationState> {
  const user = await requireAuth();

  const token = formData.get("token");
  if (typeof token !== "string" || !token) {
    return { status: "error", message: "This invitation is no longer valid." };
  }

  const result = await acceptInvitation(token, user.profileId, user.email);

  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      "not-found": "This invitation is no longer valid.",
      expired: "This invitation has expired. Ask for a new one.",
      revoked: "This invitation has been revoked.",
      accepted: "This invitation has already been used.",
      "email-mismatch":
        "This invitation was sent to a different email address. Sign in with that address to accept it.",
      "already-member": "You're already part of this practice.",
      failed: "We couldn't accept this invitation. Please try again.",
    };
    return { status: "error", message: messages[result.reason] };
  }

  revalidatePath("/", "layout");
  redirect(DEFAULT_SIGNED_IN_PATH);
}
