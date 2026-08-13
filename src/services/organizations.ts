import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { slugCandidates } from "@/lib/slug";
import type { CreatePracticeInput } from "@/validations/onboarding";

/**
 * Organization (practice) domain service.
 *
 * Business logic lives here rather than in the Server Action or the UI, so it
 * stays testable and so authorization and persistence remain separable
 * concerns.
 *
 * SECURITY CONTRACT — the whole point of this file:
 *
 *   The caller passes `ownerProfileId`, which must come from the authenticated
 *   session via the DAL. It is never a form field. The role is hard-coded to
 *   OWNER and is not a parameter, so no request shape exists that could ask for
 *   SUPER_ADMIN. The organization id and slug are generated here.
 *
 *   In other words: of the four values an attacker would want to control —
 *   user, organization, role, slug — none is part of the input.
 */

export type CreatePracticeResult =
  | { ok: true; organizationId: string; slug: string }
  | { ok: false; reason: "already-member" | "slug-exhausted" | "failed" };

/** Postgres unique-violation code, surfaced by Prisma. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Creates a practice and makes the given profile its OWNER.
 *
 * Everything happens in one transaction: organization, membership, and the
 * initial subscription either all exist afterwards or none do. A practice
 * without an owner would be unreachable — nobody could administer it — and an
 * owner row pointing at a missing organization would break every membership
 * lookup, so a partial success is worse than a clean failure.
 *
 * @param ownerProfileId `UserProfile.id` of the authenticated caller. MUST come
 * from the session, never from the request body.
 */
export async function createPractice(
  ownerProfileId: string,
  input: CreatePracticeInput,
): Promise<CreatePracticeResult> {
  /*
   * One practice per person for now.
   *
   * This is the replay guard: without it, re-posting the final step would
   * create a second practice. The schema already supports multiple memberships
   * — that is why membership is its own table — but creating additional
   * practices is a deliberate product decision for a later phase, not something
   * that should happen by accident from a double submit.
   */
  const existing = await prisma.organizationMember.findFirst({
    where: { userId: ownerProfileId, status: { in: ["ACTIVE", "INVITED"] } },
    select: { id: true },
  });

  if (existing) return { ok: false, reason: "already-member" };

  /*
   * Slug collisions are resolved by trying candidates against the unique index
   * rather than by checking for existence first. A check-then-insert has a race
   * window; letting the constraint arbitrate does not. The database is the
   * source of truth for uniqueness.
   */
  for (const slug of slugCandidates(input.practice.name)) {
    try {
      const organizationId = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: input.practice.name,
            slug,
            country: input.practice.country,
            timezone: input.practice.timezone,
            email: input.practice.email ?? null,
            phone: input.practice.phone ?? null,
            website: input.practice.website ?? null,
            addressLine: input.practice.addressLine ?? null,
            city: input.practice.city ?? null,
            state: input.practice.state ?? null,
            postalCode: input.practice.postalCode ?? null,
            // status defaults to ACTIVE; deliberately not settable by a caller.
          },
          select: { id: true },
        });

        await tx.organizationMember.create({
          data: {
            organizationId: organization.id,
            userId: ownerProfileId,
            // Hard-coded, not a parameter. The creator of a practice is its
            // owner; there is no code path that assigns any other role here.
            role: "OWNER",
            status: "ACTIVE",
            joinedAt: new Date(),
          },
        });

        /*
         * Initial subscription, using only states the Phase 2 schema already
         * defines: FREE / TRIALING. No pricing, no limits, no payment — those
         * belong to the billing phase. This row exists so the organization has
         * a subscription to read from day one rather than a null to handle.
         */
        await tx.subscription.create({
          data: {
            organizationId: organization.id,
            plan: "FREE",
            status: "TRIALING",
            trialStartsAt: new Date(),
          },
        });

        // Professional details for the owner. The profile itself already exists
        // — created by the auth trigger — so this updates rather than inserts,
        // and is scoped to the caller's own row.
        await tx.userProfile.update({
          where: { id: ownerProfileId },
          data: {
            fullName: input.owner.fullName,
            professionalTitle: input.owner.professionalTitle ?? null,
            phone: input.owner.phone ?? null,
            bio: input.owner.bio ?? null,
          },
        });

        return organization.id;
      });

      return { ok: true, organizationId, slug };
    } catch (error) {
      // Slug taken between candidates — try the next one.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION &&
        String(error.meta?.target ?? "").includes("slug")
      ) {
        continue;
      }

      // Anything else is a genuine failure. The transaction has already rolled
      // back, so no partial practice exists.
      console.error("[organizations] createPractice failed", {
        ownerProfileId,
        error,
      });
      return { ok: false, reason: "failed" };
    }
  }

  console.error("[organizations] slug candidates exhausted", {
    name: input.practice.name,
  });
  return { ok: false, reason: "slug-exhausted" };
}
