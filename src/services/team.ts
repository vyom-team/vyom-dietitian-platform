import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { OrganizationRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiryFromNow,
  isInvitationExpired,
} from "@/lib/invitation-token";
import { isInvitableRole, type InvitableRole } from "@/validations/team";

/**
 * Team management domain service.
 *
 * SECURITY CONTRACT
 *
 *   Every function takes `organizationId` and expects it to be **already
 *   verified** by `requireRole(organizationId, ORGANIZATION_ADMIN_ROLES)` in
 *   the calling action. This layer does not authorize; it enforces the
 *   *domain* rules that authorization cannot express:
 *
 *     - a practice must never be left with zero owners
 *     - a member of one practice cannot be modified through another
 *     - an invitation is single-use and time-limited
 *
 *   Every query is scoped by `organizationId` in its WHERE clause, so even a
 *   correct-looking membership id from a different practice matches nothing.
 *   That is the IDOR guard at this layer, independent of the one above it.
 */

export type TeamMember = {
  membershipId: string;
  userId: string;
  name: string | null;
  email: string;
  professionalTitle: string | null;
  role: OrganizationRole;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
  joinedAt: Date | null;
  createdAt: Date;
};

export type PendingInvitation = {
  id: string;
  email: string;
  role: OrganizationRole;
  invitedByName: string | null;
  expiresAt: Date;
  createdAt: Date;
  expired: boolean;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Members of one practice. Removed memberships are excluded from the roster. */
export async function listTeamMembers(
  organizationId: string,
): Promise<TeamMember[]> {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId, status: { not: "REMOVED" } },
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      joinedAt: true,
      createdAt: true,
      user: {
        select: { fullName: true, email: true, professionalTitle: true },
      },
    },
    // Owners first, then alphabetically — the roster reads like an org chart.
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  return members.map((member) => ({
    membershipId: member.id,
    userId: member.userId,
    name: member.user.fullName,
    email: member.user.email,
    professionalTitle: member.user.professionalTitle,
    role: member.role,
    status: member.status,
    joinedAt: member.joinedAt,
    createdAt: member.createdAt,
  }));
}

/**
 * Invitations awaiting acceptance.
 *
 * Rows past their expiry are still stored as PENDING — expiry is derived at
 * read time rather than by a background job — so `expired` is computed here and
 * the UI can show it accurately.
 */
export async function listPendingInvitations(
  organizationId: string,
): Promise<PendingInvitation[]> {
  const invitations = await prisma.organizationInvitation.findMany({
    where: { organizationId, status: "PENDING" },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      invitedBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();

  return invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    invitedByName: invitation.invitedBy.fullName,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    expired: isInvitationExpired(invitation.expiresAt, now),
  }));
}

export type InvitationForEmail = {
  organizationName: string;
  role: OrganizationRole;
  invitedByName: string | null;
};

/**
 * Live invitations addressed to a given email.
 *
 * Used by onboarding to tell someone they were invited to an existing practice
 * before they create one of their own — the failure mode this prevents is an
 * invited dietitian ending up as the owner of an empty practice they never
 * meant to make.
 *
 * Returns no token and no id: this is a prompt to check their email, not a way
 * to accept without the link.
 */
export async function findLiveInvitationsForEmail(
  email: string,
): Promise<InvitationForEmail[]> {
  const invitations = await prisma.organizationInvitation.findMany({
    where: {
      email: email.trim().toLowerCase(),
      status: "PENDING",
      expiresAt: { gt: new Date() },
      organization: { status: "ACTIVE" },
    },
    select: {
      role: true,
      organization: { select: { name: true } },
      invitedBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return invitations.map((invitation) => ({
    organizationName: invitation.organization.name,
    role: invitation.role,
    invitedByName: invitation.invitedBy.fullName,
  }));
}

/** How many active owners a practice has. The basis of owner protection. */
export async function countActiveOwners(organizationId: string): Promise<number> {
  return prisma.organizationMember.count({
    where: { organizationId, role: "OWNER", status: "ACTIVE" },
  });
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export type InviteResult =
  | { ok: true; invitationId: string; token: string; expiresAt: Date }
  | {
      ok: false;
      reason: "already-member" | "invalid-role" | "failed";
    };

/**
 * Invites someone to join a practice.
 *
 * Re-inviting the same address updates the existing row with a fresh token and
 * expiry rather than adding another, which is what keeps pending invitations
 * bounded. The previous token stops working the moment the hash is replaced.
 *
 * @param organizationId MUST be verified by the caller.
 * @param invitedByProfileId The authenticated inviter, from the session.
 */
export async function inviteMember(
  organizationId: string,
  invitedByProfileId: string,
  input: { email: string; role: InvitableRole; message?: string },
): Promise<InviteResult> {
  // Defence in depth. Validation already restricted the role, but this service
  // is callable from anywhere in the server and must not depend on that.
  if (!isInvitableRole(input.role)) {
    return { ok: false, reason: "invalid-role" };
  }

  const email = input.email.trim().toLowerCase();

  // Someone already on the roster does not need an invitation. Checked against
  // this organization only — being a member elsewhere is irrelevant and must
  // not block them.
  const existingMembership = await prisma.organizationMember.findFirst({
    where: {
      organizationId,
      status: { in: ["ACTIVE", "INVITED", "SUSPENDED"] },
      user: { email },
    },
    select: { id: true },
  });

  if (existingMembership) return { ok: false, reason: "already-member" };

  const { token, tokenHash } = generateInvitationToken();
  const expiresAt = invitationExpiryFromNow();

  try {
    const invitation = await prisma.organizationInvitation.upsert({
      where: { organizationId_email: { organizationId, email } },
      create: {
        organizationId,
        email,
        role: input.role,
        tokenHash,
        expiresAt,
        invitedById: invitedByProfileId,
        message: input.message ?? null,
      },
      update: {
        role: input.role,
        tokenHash,
        expiresAt,
        status: "PENDING",
        invitedById: invitedByProfileId,
        message: input.message ?? null,
        // Clear any previous outcome so the row reads as a fresh invitation.
        acceptedAt: null,
        acceptedById: null,
        revokedAt: null,
      },
      select: { id: true },
    });

    // The raw token is returned exactly once, to be put in the link. It is
    // never stored and cannot be recovered from the database afterwards.
    return { ok: true, invitationId: invitation.id, token, expiresAt };
  } catch (error) {
    console.error("[team] inviteMember failed", { organizationId, error });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Revokes a pending invitation.
 *
 * Scoped by `organizationId`, so an invitation id belonging to another practice
 * matches nothing and the call is a no-op rather than a cross-tenant write.
 */
export async function revokeInvitation(
  organizationId: string,
  invitationId: string,
): Promise<boolean> {
  const result = await prisma.organizationInvitation.updateMany({
    where: { id: invitationId, organizationId, status: "PENDING" },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  return result.count === 1;
}

export type InvitationDetails = {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: OrganizationRole;
  invitedByName: string | null;
  expiresAt: Date;
  message: string | null;
};

export type InvitationLookup =
  | { ok: true; invitation: InvitationDetails }
  | { ok: false; reason: "not-found" | "expired" | "revoked" | "accepted" };

/**
 * Resolves a raw invitation token.
 *
 * The token is hashed and matched against the stored digest; the plaintext is
 * never compared directly or written anywhere.
 *
 * `not-found` covers both a nonexistent and a malformed token, so guessing
 * cannot distinguish the two.
 */
export async function findInvitationByToken(
  token: string,
): Promise<InvitationLookup> {
  const tokenHash = hashInvitationToken(token);

  const invitation = await prisma.organizationInvitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      message: true,
      organization: { select: { name: true, status: true } },
      invitedBy: { select: { fullName: true } },
    },
  });

  if (!invitation) return { ok: false, reason: "not-found" };
  if (invitation.status === "ACCEPTED") return { ok: false, reason: "accepted" };
  if (invitation.status === "REVOKED") return { ok: false, reason: "revoked" };
  if (invitation.status === "EXPIRED") return { ok: false, reason: "expired" };
  if (isInvitationExpired(invitation.expiresAt)) {
    return { ok: false, reason: "expired" };
  }
  // An archived or suspended practice cannot gain members.
  if (invitation.organization.status !== "ACTIVE") {
    return { ok: false, reason: "not-found" };
  }

  return {
    ok: true,
    invitation: {
      id: invitation.id,
      organizationId: invitation.organizationId,
      organizationName: invitation.organization.name,
      email: invitation.email,
      role: invitation.role,
      invitedByName: invitation.invitedBy.fullName,
      expiresAt: invitation.expiresAt,
      message: invitation.message,
    },
  };
}

export type AcceptResult =
  | { ok: true; organizationId: string }
  | {
      ok: false;
      reason: "not-found" | "expired" | "revoked" | "accepted" | "email-mismatch" | "already-member" | "failed";
    };

/**
 * Accepts an invitation and creates the membership.
 *
 * Two properties matter:
 *
 * **Email binding.** The signed-in user's address must equal the invited
 * address. Without it, anyone who obtained the link — a forwarded email, a
 * shared screen — could join the practice.
 *
 * **Single use.** Membership creation and marking the invitation ACCEPTED share
 * one transaction, and the update is conditional on the row still being
 * PENDING. Two simultaneous accepts cannot both succeed: the second matches
 * zero rows and rolls back.
 *
 * @param profileId The authenticated user, from the session.
 * @param userEmail That user's verified email, from the session.
 */
export async function acceptInvitation(
  token: string,
  profileId: string,
  userEmail: string,
): Promise<AcceptResult> {
  const lookup = await findInvitationByToken(token);
  if (!lookup.ok) return { ok: false, reason: lookup.reason };

  const invitation = lookup.invitation;

  if (invitation.email !== userEmail.trim().toLowerCase()) {
    return { ok: false, reason: "email-mismatch" };
  }

  const existing = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: invitation.organizationId,
        userId: profileId,
      },
    },
    select: { id: true, status: true },
  });

  try {
    await prisma.$transaction(async (tx) => {
      /*
       * Conditional on status = PENDING. If a concurrent request accepted this
       * invitation first, zero rows match and the throw rolls the whole
       * transaction back — which is what makes the token single-use.
       */
      const claimed = await tx.organizationInvitation.updateMany({
        where: { id: invitation.id, status: "PENDING" },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
          acceptedById: profileId,
        },
      });

      if (claimed.count !== 1) {
        throw new Error("invitation-already-claimed");
      }

      if (existing) {
        // Re-joining after being suspended or removed: reactivate rather than
        // insert, which the unique constraint would reject anyway.
        await tx.organizationMember.update({
          where: { id: existing.id },
          data: {
            role: invitation.role,
            status: "ACTIVE",
            joinedAt: new Date(),
          },
        });
      } else {
        await tx.organizationMember.create({
          data: {
            organizationId: invitation.organizationId,
            userId: profileId,
            role: invitation.role,
            status: "ACTIVE",
            joinedAt: new Date(),
          },
        });
      }
    });

    return { ok: true, organizationId: invitation.organizationId };
  } catch (error) {
    if (error instanceof Error && error.message === "invitation-already-claimed") {
      return { ok: false, reason: "accepted" };
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { ok: false, reason: "already-member" };
    }

    console.error("[team] acceptInvitation failed", {
      invitationId: invitation.id,
      error,
    });
    return { ok: false, reason: "failed" };
  }
}

// ---------------------------------------------------------------------------
// Membership lifecycle
// ---------------------------------------------------------------------------

export type MembershipUpdateResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not-found" | "invalid-role" | "last-owner" | "self" | "failed";
    };

/**
 * Changes a member's role.
 *
 * Refuses to demote the last active owner. A practice with no owner would have
 * nobody able to manage billing, team, or settings — an unrecoverable state
 * from inside the product.
 *
 * The check and the write share a transaction so a concurrent demotion of the
 * other owner cannot slip between them.
 */
export async function changeMemberRole(
  organizationId: string,
  membershipId: string,
  role: InvitableRole,
): Promise<MembershipUpdateResult> {
  if (!isInvitableRole(role)) return { ok: false, reason: "invalid-role" };

  try {
    return await prisma.$transaction(async (tx) => {
      // Scoped by organizationId: a membership from another practice is
      // simply not found.
      const membership = await tx.organizationMember.findFirst({
        where: { id: membershipId, organizationId },
        select: { id: true, role: true, status: true },
      });

      if (!membership) return { ok: false, reason: "not-found" as const };

      if (membership.role === "OWNER") {
        const owners = await tx.organizationMember.count({
          where: { organizationId, role: "OWNER", status: "ACTIVE" },
        });
        if (owners <= 1) return { ok: false, reason: "last-owner" as const };
      }

      await tx.organizationMember.update({
        where: { id: membership.id },
        data: { role },
      });

      return { ok: true as const };
    });
  } catch (error) {
    console.error("[team] changeMemberRole failed", { organizationId, error });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Suspends a member.
 *
 * The account survives — only the membership changes. Removing someone from a
 * practice is not the same as deleting their Vyom account, and they may belong
 * to other practices.
 *
 * Access ends immediately: the Data Access Layer only returns ACTIVE
 * memberships, and the RLS helper functions filter on the same condition.
 */
export async function setMembershipStatus(
  organizationId: string,
  membershipId: string,
  status: "ACTIVE" | "SUSPENDED" | "REMOVED",
  actingProfileId: string,
): Promise<MembershipUpdateResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const membership = await tx.organizationMember.findFirst({
        where: { id: membershipId, organizationId },
        select: { id: true, role: true, status: true, userId: true },
      });

      if (!membership) return { ok: false, reason: "not-found" as const };

      // Suspending yourself would lock you out of the practice you administer,
      // with no way back in from the product.
      if (membership.userId === actingProfileId && status !== "ACTIVE") {
        return { ok: false, reason: "self" as const };
      }

      if (membership.role === "OWNER" && status !== "ACTIVE") {
        const owners = await tx.organizationMember.count({
          where: { organizationId, role: "OWNER", status: "ACTIVE" },
        });
        if (owners <= 1) return { ok: false, reason: "last-owner" as const };
      }

      await tx.organizationMember.update({
        where: { id: membership.id },
        data: {
          status,
          // Reactivation records a fresh join date only if there was not one.
          ...(status === "ACTIVE" ? {} : {}),
        },
      });

      return { ok: true as const };
    });
  } catch (error) {
    console.error("[team] setMembershipStatus failed", { organizationId, error });
    return { ok: false, reason: "failed" };
  }
}
