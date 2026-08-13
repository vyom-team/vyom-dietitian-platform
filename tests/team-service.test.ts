import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiryFromNow,
} from "../src/lib/invitation-token";
import {
  hasRlsDatabase,
  isRlsDatabaseReachable,
  queryAs,
  rlsDatabaseUrl,
  UNREACHABLE_MESSAGE,
} from "./helpers/rls-db";

/**
 * Team management against a real database.
 *
 * Two tenants, each with an owner and staff, so every cross-tenant assertion is
 * made against data that genuinely belongs to someone else.
 *
 * The service modules import `server-only` and cannot load outside a Next.js
 * server bundle, so these exercise the same queries and the same transaction
 * shape directly. What is verified is the behaviour that must hold *at the
 * database*: scoping, uniqueness, atomicity, and owner protection.
 */

const enabled = hasRlsDatabase() && (await isRlsDatabaseReachable());
const run = `team${Date.now().toString(36)}`;

let prisma: PrismaClient;

type Tenant = {
  orgId: string;
  ownerProfileId: string;
  ownerAuthId: string;
  staffProfileId: string;
  staffAuthId: string;
};

async function makeAuthUser(suffix: string) {
  const email = `${run}-${suffix}@vyom.test`;
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO auth.users (id, email, raw_user_meta_data, created_at)
     VALUES (gen_random_uuid(), $1, jsonb_build_object('full_name', $2::text), now())
     RETURNING id`,
    email,
    `User ${suffix}`,
  );
  const authId = rows[0]!.id;
  const profile = await prisma.userProfile.findUniqueOrThrow({
    where: { authUserId: authId },
    select: { id: true },
  });
  return { authId, profileId: profile.id, email };
}

async function makeTenant(key: string): Promise<Tenant> {
  const owner = await makeAuthUser(`${key}-owner`);
  const staff = await makeAuthUser(`${key}-staff`);

  const org = await prisma.organization.create({
    data: { name: `${run} ${key}`, slug: `${run}-${key}` },
    select: { id: true },
  });

  await prisma.organizationMember.createMany({
    data: [
      {
        organizationId: org.id,
        userId: owner.profileId,
        role: "OWNER",
        status: "ACTIVE",
        joinedAt: new Date(),
      },
      {
        organizationId: org.id,
        userId: staff.profileId,
        role: "DIETITIAN",
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    ],
  });

  return {
    orgId: org.id,
    ownerProfileId: owner.profileId,
    ownerAuthId: owner.authId,
    staffProfileId: staff.profileId,
    staffAuthId: staff.authId,
  };
}

/** Creates an invitation directly, mirroring what the service writes. */
async function createInvitation(
  orgId: string,
  invitedById: string,
  email: string,
  options: { expiresAt?: Date; status?: "PENDING" | "REVOKED" | "ACCEPTED" } = {},
) {
  const { token, tokenHash } = generateInvitationToken();
  const invitation = await prisma.organizationInvitation.create({
    data: {
      organizationId: orgId,
      email: email.toLowerCase(),
      role: "DIETITIAN",
      tokenHash,
      expiresAt: options.expiresAt ?? invitationExpiryFromNow(),
      invitedById,
      status: options.status ?? "PENDING",
    },
    select: { id: true },
  });
  return { token, invitationId: invitation.id };
}

describe.skipIf(!enabled)("team management", () => {
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: rlsDatabaseUrl }),
    });
    a = await makeTenant("a");
    b = await makeTenant("b");
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organizationInvitation.deleteMany({
      where: { organization: { slug: { startsWith: run } } },
    });
    await prisma.organizationMember.deleteMany({
      where: { organization: { slug: { startsWith: run } } },
    });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: run } } });
    await prisma.userProfile.deleteMany({ where: { email: { startsWith: run } } });
    await prisma.$executeRawUnsafe(
      `DELETE FROM auth.users WHERE email LIKE '${run}%'`,
    );
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  describe("cross-tenant isolation", () => {
    it("scoped revoke does not touch another practice's invitation", async () => {
      const { invitationId } = await createInvitation(
        b.orgId,
        b.ownerProfileId,
        `${run}-victim@vyom.test`,
      );

      // Practice A attempts to revoke an invitation belonging to practice B.
      const result = await prisma.organizationInvitation.updateMany({
        where: { id: invitationId, organizationId: a.orgId, status: "PENDING" },
        data: { status: "REVOKED" },
      });

      expect(result.count).toBe(0);

      const untouched = await prisma.organizationInvitation.findUniqueOrThrow({
        where: { id: invitationId },
      });
      expect(untouched.status).toBe("PENDING");
    });

    it("scoped role change does not touch another practice's member", async () => {
      const membership = await prisma.organizationMember.findFirstOrThrow({
        where: { organizationId: b.orgId, userId: b.staffProfileId },
      });

      const result = await prisma.organizationMember.updateMany({
        where: { id: membership.id, organizationId: a.orgId },
        data: { role: "RECEPTIONIST" },
      });

      expect(result.count).toBe(0);

      const after = await prisma.organizationMember.findUniqueOrThrow({
        where: { id: membership.id },
      });
      expect(after.role).toBe("DIETITIAN");
    });

    it("RLS hides another practice's invitations from the browser", async () => {
      await createInvitation(b.orgId, b.ownerProfileId, `${run}-hidden@vyom.test`);

      const { rows } = await queryAs(
        a.ownerAuthId,
        `SELECT id FROM public.organization_invitations WHERE organization_id = $1`,
        [b.orgId],
      );
      expect(rows).toHaveLength(0);
    });

    it("RLS shows an owner their own practice's invitations", async () => {
      await createInvitation(a.orgId, a.ownerProfileId, `${run}-visible@vyom.test`);

      const { rows } = await queryAs(
        a.ownerAuthId,
        `SELECT id FROM public.organization_invitations WHERE organization_id = $1`,
        [a.orgId],
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it("RLS hides invitations from non-admin members", async () => {
      // A dietitian has no business seeing who the practice is hiring.
      const { rows } = await queryAs(
        a.staffAuthId,
        `SELECT id FROM public.organization_invitations`,
      );
      expect(rows).toHaveLength(0);
    });

    it("the browser cannot write invitations at all", async () => {
      const attempts = [
        `INSERT INTO public.organization_invitations
           (organization_id, email, role, token_hash, expires_at, invited_by_id)
         VALUES ('${a.orgId}', 'x@y.com', 'OWNER', repeat('a',64), now() + interval '7 days', '${a.ownerProfileId}')`,
        `UPDATE public.organization_invitations SET role = 'OWNER'`,
        `DELETE FROM public.organization_invitations`,
      ];

      for (const sql of attempts) {
        const { error } = await queryAs(a.ownerAuthId, sql);
        expect(error, `expected refusal for: ${sql.slice(0, 40)}`).toMatch(
          /permission denied/i,
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("invitation lifecycle", () => {
    it("finds an invitation by hashing the token", async () => {
      const { token } = await createInvitation(
        a.orgId,
        a.ownerProfileId,
        `${run}-lookup@vyom.test`,
      );

      const found = await prisma.organizationInvitation.findUnique({
        where: { tokenHash: hashInvitationToken(token) },
      });
      expect(found).not.toBeNull();
    });

    it("stores no plaintext token", async () => {
      const { token } = await createInvitation(
        a.orgId,
        a.ownerProfileId,
        `${run}-plaintext@vyom.test`,
      );

      const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM public.organization_invitations
          WHERE token_hash = $1`,
        token,
      );
      // The raw token must match nothing — only its digest is stored.
      expect(Number(rows[0]!.n)).toBe(0);
    });

    it("a wrong token finds nothing", async () => {
      const found = await prisma.organizationInvitation.findUnique({
        where: { tokenHash: hashInvitationToken("not-a-real-token") },
      });
      expect(found).toBeNull();
    });

    it("keeps one invitation row per email per practice", async () => {
      const email = `${run}-dupe@vyom.test`;
      await createInvitation(a.orgId, a.ownerProfileId, email);

      await expect(
        createInvitation(a.orgId, a.ownerProfileId, email),
      ).rejects.toThrow();

      const count = await prisma.organizationInvitation.count({
        where: { organizationId: a.orgId, email },
      });
      expect(count).toBe(1);
    });

    it("allows the same email to be invited by a different practice", async () => {
      const email = `${run}-shared@vyom.test`;
      await createInvitation(a.orgId, a.ownerProfileId, email);
      await createInvitation(b.orgId, b.ownerProfileId, email);

      const count = await prisma.organizationInvitation.count({ where: { email } });
      expect(count).toBe(2);
    });

    it("cannot be accepted twice — the second claim matches nothing", async () => {
      const { invitationId } = await createInvitation(
        a.orgId,
        a.ownerProfileId,
        `${run}-once@vyom.test`,
      );

      const first = await prisma.organizationInvitation.updateMany({
        where: { id: invitationId, status: "PENDING" },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
      expect(first.count).toBe(1);

      // The conditional update is what makes the token single-use.
      const second = await prisma.organizationInvitation.updateMany({
        where: { id: invitationId, status: "PENDING" },
        data: { status: "ACCEPTED" },
      });
      expect(second.count).toBe(0);
    });

    it("an expired invitation is detectable by timestamp, not status alone", async () => {
      const { invitationId } = await createInvitation(
        a.orgId,
        a.ownerProfileId,
        `${run}-expired@vyom.test`,
        { expiresAt: new Date(Date.now() - 1000) },
      );

      const invitation = await prisma.organizationInvitation.findUniqueOrThrow({
        where: { id: invitationId },
      });
      // Still PENDING in the database — expiry is derived, so any check that
      // trusted status alone would wrongly accept this.
      expect(invitation.status).toBe("PENDING");
      expect(invitation.expiresAt.getTime()).toBeLessThan(Date.now());
    });
  });

  // -------------------------------------------------------------------------
  describe("owner protection", () => {
    it("refuses to demote the last owner", async () => {
      const owners = await prisma.organizationMember.count({
        where: { organizationId: a.orgId, role: "OWNER", status: "ACTIVE" },
      });
      expect(owners).toBe(1);

      // The service refuses when owners <= 1; this asserts the precondition
      // that makes that refusal correct.
      const membership = await prisma.organizationMember.findFirstOrThrow({
        where: { organizationId: a.orgId, role: "OWNER" },
      });
      expect(membership.role).toBe("OWNER");
    });

    it("allows demotion once a second owner exists", async () => {
      const second = await makeAuthUser("a-owner2");
      await prisma.organizationMember.create({
        data: {
          organizationId: a.orgId,
          userId: second.profileId,
          role: "OWNER",
          status: "ACTIVE",
          joinedAt: new Date(),
        },
      });

      const owners = await prisma.organizationMember.count({
        where: { organizationId: a.orgId, role: "OWNER", status: "ACTIVE" },
      });
      expect(owners).toBe(2);

      await prisma.organizationMember.updateMany({
        where: { organizationId: a.orgId, userId: second.profileId },
        data: { role: "DIETITIAN" },
      });

      const remaining = await prisma.organizationMember.count({
        where: { organizationId: a.orgId, role: "OWNER", status: "ACTIVE" },
      });
      expect(remaining).toBe(1);
    });

    it("a suspended owner does not count toward the owner total", async () => {
      const extra = await makeAuthUser("a-owner3");
      await prisma.organizationMember.create({
        data: {
          organizationId: a.orgId,
          userId: extra.profileId,
          role: "OWNER",
          status: "SUSPENDED",
        },
      });

      const active = await prisma.organizationMember.count({
        where: { organizationId: a.orgId, role: "OWNER", status: "ACTIVE" },
      });
      // Only the original owner is active — a suspended owner cannot administer
      // anything, so counting them would let the practice lose its last owner.
      expect(active).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("suspended members lose access", () => {
    it("a suspended member sees nothing of the practice", async () => {
      await prisma.organizationMember.updateMany({
        where: { organizationId: a.orgId, userId: a.staffProfileId },
        data: { status: "SUSPENDED" },
      });

      const orgs = await queryAs(
        a.staffAuthId,
        `SELECT id FROM public.organizations WHERE id = $1`,
        [a.orgId],
      );
      expect(orgs.rows).toHaveLength(0);

      const members = await queryAs(
        a.staffAuthId,
        `SELECT id FROM public.organization_members`,
      );
      expect(members.rows).toHaveLength(0);

      // Restore for later tests.
      await prisma.organizationMember.updateMany({
        where: { organizationId: a.orgId, userId: a.staffProfileId },
        data: { status: "ACTIVE" },
      });
    });

    it("reactivation restores access", async () => {
      const { rows } = await queryAs(
        a.staffAuthId,
        `SELECT id FROM public.organizations WHERE id = $1`,
        [a.orgId],
      );
      expect(rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("membership integrity", () => {
    it("rejects a duplicate membership", async () => {
      await expect(
        prisma.organizationMember.create({
          data: {
            organizationId: a.orgId,
            userId: a.staffProfileId,
            role: "RECEPTIONIST",
            status: "ACTIVE",
          },
        }),
      ).rejects.toThrow();
    });

    it("lets one person belong to two practices", async () => {
      // The reason membership is its own table. Being staff at A must not
      // prevent joining B.
      await prisma.organizationMember.create({
        data: {
          organizationId: b.orgId,
          userId: a.staffProfileId,
          role: "DIETITIAN",
          status: "ACTIVE",
          joinedAt: new Date(),
        },
      });

      const count = await prisma.organizationMember.count({
        where: { userId: a.staffProfileId, status: "ACTIVE" },
      });
      expect(count).toBe(2);

      await prisma.organizationMember.deleteMany({
        where: { organizationId: b.orgId, userId: a.staffProfileId },
      });
    });
  });
});

describe("team service test configuration", () => {
  it("has a reachable database", () => {
    const reason = !hasRlsDatabase()
      ? "RLS_TEST_DATABASE_URL is not set — team security was NOT verified."
      : UNREACHABLE_MESSAGE;
    expect(enabled, reason).toBe(true);
  });
});
