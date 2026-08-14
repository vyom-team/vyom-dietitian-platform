import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  hasRlsDatabase,
  isRlsDatabaseReachable,
  queryAs,
  rlsDatabaseUrl,
  UNREACHABLE_MESSAGE,
} from "./helpers/rls-db";

/**
 * Nutrition assessments against a real database.
 *
 * This table holds health information, so it carries the narrowest access
 * boundary in the product: RECEPTIONIST is excluded even though they may manage
 * the client record itself. That exclusion is asserted at the database, not
 * only in the UI.
 *
 * All fixture data is synthetic.
 */

const enabled = hasRlsDatabase() && (await isRlsDatabaseReachable());
const run = `as${Date.now().toString(36)}`;

let prisma: PrismaClient;

type Practice = {
  orgId: string;
  ownerMemberId: string;
  ownerAuthId: string;
  dietitianMemberId: string;
  dietitianAuthId: string;
  receptionistMemberId: string;
  receptionistAuthId: string;
  clientId: string;
  /** Assigned to the dietitian. */
  assignedClientId: string;
};

async function makeAuthUser(suffix: string) {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO auth.users (id, email, raw_user_meta_data, created_at)
     VALUES (gen_random_uuid(), $1, jsonb_build_object('full_name', $2::text), now())
     RETURNING id`,
    `${run}-${suffix}@vyom.test`,
    `Staff ${suffix}`,
  );
  const authId = rows[0]!.id;
  const profile = await prisma.userProfile.findUniqueOrThrow({
    where: { authUserId: authId },
    select: { id: true },
  });
  return { authId, profileId: profile.id };
}

async function makePractice(key: string): Promise<Practice> {
  const owner = await makeAuthUser(`${key}-owner`);
  const dietitian = await makeAuthUser(`${key}-diet`);
  const receptionist = await makeAuthUser(`${key}-recep`);

  const org = await prisma.organization.create({
    data: { name: `${run} ${key}`, slug: `${run}-${key}` },
    select: { id: true },
  });

  const member = (userId: string, role: "OWNER" | "DIETITIAN" | "RECEPTIONIST") =>
    prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId,
        role,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
      select: { id: true },
    });

  const ownerMember = await member(owner.profileId, "OWNER");
  const dietitianMember = await member(dietitian.profileId, "DIETITIAN");
  const receptionistMember = await member(receptionist.profileId, "RECEPTIONIST");

  const client = await prisma.client.create({
    data: {
      organizationId: org.id,
      clientNumber: `VYM-${key}00001`,
      firstName: "Unassigned",
      lastName: "Testcase",
    },
    select: { id: true },
  });

  const assigned = await prisma.client.create({
    data: {
      organizationId: org.id,
      clientNumber: `VYM-${key}00002`,
      firstName: "Assigned",
      lastName: "Testcase",
    },
    select: { id: true },
  });

  await prisma.clientAssignment.create({
    data: { clientId: assigned.id, organizationMemberId: dietitianMember.id },
  });

  return {
    orgId: org.id,
    ownerMemberId: ownerMember.id,
    ownerAuthId: owner.authId,
    dietitianMemberId: dietitianMember.id,
    dietitianAuthId: dietitian.authId,
    receptionistMemberId: receptionistMember.id,
    receptionistAuthId: receptionist.authId,
    clientId: client.id,
    assignedClientId: assigned.id,
  };
}

async function makeAssessment(
  practice: Practice,
  clientId: string,
  overrides: Record<string, unknown> = {},
) {
  return prisma.nutritionAssessment.create({
    data: {
      organizationId: practice.orgId,
      clientId,
      createdByMemberId: practice.ownerMemberId,
      assessmentType: "INITIAL",
      assessmentDate: new Date("2026-08-14T00:00:00Z"),
      heightCm: 170,
      weightKg: 70,
      // Synthetic clinical text — nothing here resembles a real person.
      healthConditions: "Synthetic condition for testing",
      ...overrides,
    },
    select: { id: true },
  });
}

describe.skipIf(!enabled)("nutrition assessments", () => {
  let a: Practice;
  let b: Practice;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: rlsDatabaseUrl }),
    });
    a = await makePractice("a");
    b = await makePractice("b");
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.nutritionAssessment.deleteMany({
      where: { organization: { slug: { startsWith: run } } },
    });
    await prisma.clientAssignment.deleteMany({
      where: { client: { organization: { slug: { startsWith: run } } } },
    });
    await prisma.client.deleteMany({
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
  describe("the receptionist boundary", () => {
    it("a receptionist cannot read any assessment", async () => {
      await makeAssessment(a, a.clientId);

      // The point of this phase's narrower RLS helper. A receptionist manages
      // the client record and must not see a single health field.
      const { rows } = await queryAs(
        a.receptionistAuthId,
        `SELECT id FROM public.nutrition_assessments`,
      );
      expect(rows).toHaveLength(0);
    });

    it("a receptionist can still read the client record", async () => {
      // Confirms the boundary is precise rather than blunt — Phase 6 access is
      // untouched.
      const { rows } = await queryAs(
        a.receptionistAuthId,
        `SELECT id FROM public.clients WHERE organization_id = $1`,
        [a.orgId],
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it("an owner can read assessments", async () => {
      const { rows } = await queryAs(
        a.ownerAuthId,
        `SELECT id FROM public.nutrition_assessments WHERE organization_id = $1`,
        [a.orgId],
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it("a dietitian can read assessments", async () => {
      const { rows } = await queryAs(
        a.dietitianAuthId,
        `SELECT id FROM public.nutrition_assessments WHERE organization_id = $1`,
        [a.orgId],
      );
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("cross-practice isolation", () => {
    it("practice A cannot read practice B's assessments", async () => {
      await makeAssessment(b, b.clientId);

      const { rows } = await queryAs(
        a.ownerAuthId,
        `SELECT id FROM public.nutrition_assessments WHERE organization_id = $1`,
        [b.orgId],
      );
      expect(rows).toHaveLength(0);
    });

    it("practice B cannot read practice A's assessments", async () => {
      const { rows } = await queryAs(
        b.ownerAuthId,
        `SELECT id FROM public.nutrition_assessments WHERE organization_id = $1`,
        [a.orgId],
      );
      expect(rows).toHaveLength(0);
    });

    it("an anonymous visitor reads nothing", async () => {
      const result = await queryAs(
        null,
        `SELECT id FROM public.nutrition_assessments`,
      );
      expect(result.rows).toHaveLength(0);
    });

    it("a suspended member reads nothing", async () => {
      await prisma.organizationMember.update({
        where: { id: a.dietitianMemberId },
        data: { status: "SUSPENDED" },
      });

      const { rows } = await queryAs(
        a.dietitianAuthId,
        `SELECT id FROM public.nutrition_assessments`,
      );
      expect(rows).toHaveLength(0);

      await prisma.organizationMember.update({
        where: { id: a.dietitianMemberId },
        data: { status: "ACTIVE" },
      });
    });

    it("the browser cannot write assessments at all", async () => {
      const attempts = [
        `INSERT INTO public.nutrition_assessments
           (organization_id, client_id, created_by_member_id, assessment_type, assessment_date)
         VALUES ('${a.orgId}', '${a.clientId}', '${a.ownerMemberId}', 'INITIAL', CURRENT_DATE)`,
        `UPDATE public.nutrition_assessments SET weight_kg = 1`,
        `DELETE FROM public.nutrition_assessments`,
      ];

      for (const sql of attempts) {
        const { error } = await queryAs(a.ownerAuthId, sql);
        expect(error, `expected refusal for: ${sql.slice(0, 40)}`).toMatch(
          /permission denied/i,
        );
      }
    });

    it("a scoped update cannot touch another practice's assessment", async () => {
      const victim = await makeAssessment(b, b.clientId);

      const result = await prisma.nutritionAssessment.updateMany({
        where: { id: victim.id, organizationId: a.orgId },
        data: { weightKg: 1 },
      });

      expect(result.count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("organization consistency trigger", () => {
    it("rejects an assessment filed against another practice's client", async () => {
      // Without this, an assessment could be filed under practice A while
      // belonging to a client of practice B — and RLS, which scopes on
      // organization_id, would show it to the wrong practice.
      await expect(
        prisma.nutritionAssessment.create({
          data: {
            organizationId: a.orgId,
            clientId: b.clientId,
            createdByMemberId: a.ownerMemberId,
            assessmentType: "INITIAL",
            assessmentDate: new Date(),
          },
        }),
      ).rejects.toThrow(/organization/i);
    });

    it("rejects an author from another practice", async () => {
      await expect(
        prisma.nutritionAssessment.create({
          data: {
            organizationId: a.orgId,
            clientId: a.clientId,
            createdByMemberId: b.ownerMemberId,
            assessmentType: "INITIAL",
            assessmentDate: new Date(),
          },
        }),
      ).rejects.toThrow(/organization/i);
    });
  });

  // -------------------------------------------------------------------------
  describe("dietitian caseload scoping", () => {
    it("a dietitian's scoped query returns only assessments for their clients", async () => {
      const mine = await makeAssessment(a, a.assignedClientId);
      const notMine = await makeAssessment(a, a.clientId);

      // The filter the service applies, expressed directly.
      const visible = await prisma.nutritionAssessment.findMany({
        where: {
          organizationId: a.orgId,
          client: {
            assignments: {
              some: { organizationMemberId: a.dietitianMemberId, endedAt: null },
            },
          },
        },
        select: { id: true },
      });

      const ids = visible.map((row) => row.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(notMine.id);
    });
  });

  // -------------------------------------------------------------------------
  describe("history is preserved", () => {
    it("keeps every assessment as a separate record", async () => {
      const client = await prisma.client.create({
        data: {
          organizationId: a.orgId,
          clientNumber: `VYM-hist001`,
          firstName: "History",
          lastName: "Testcase",
        },
        select: { id: true },
      });

      await makeAssessment(a, client.id, {
        assessmentType: "INITIAL",
        assessmentDate: new Date("2026-08-14T00:00:00Z"),
        weightKg: 80,
      });
      await makeAssessment(a, client.id, {
        assessmentType: "FOLLOW_UP",
        assessmentDate: new Date("2026-09-20T00:00:00Z"),
        weightKg: 77,
      });

      const history = await prisma.nutritionAssessment.findMany({
        where: { clientId: client.id },
        orderBy: { assessmentDate: "desc" },
      });

      // A follow-up creates a row; it never overwrites the previous one.
      expect(history).toHaveLength(2);
      expect(history[0]?.assessmentType).toBe("FOLLOW_UP");
      expect(history[1]?.assessmentType).toBe("INITIAL");
      expect(Number(history[1]?.weightKg)).toBe(80);
    });

    it("survives the client being archived", async () => {
      const client = await prisma.client.create({
        data: {
          organizationId: a.orgId,
          clientNumber: `VYM-arch001`,
          firstName: "Archived",
          lastName: "Testcase",
        },
        select: { id: true },
      });
      await makeAssessment(a, client.id);

      await prisma.client.update({
        where: { id: client.id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });

      const after = await prisma.nutritionAssessment.count({
        where: { clientId: client.id },
      });
      expect(after).toBe(1);

      await prisma.client.update({
        where: { id: client.id },
        data: { status: "ACTIVE", archivedAt: null },
      });

      expect(
        await prisma.nutritionAssessment.count({ where: { clientId: client.id } }),
      ).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("database constraints", () => {
    it("rejects impossible measurements", async () => {
      for (const [field, value] of [
        ["heightCm", 0],
        ["heightCm", 300],
        ["weightKg", 0],
        ["weightKg", 900],
      ] as const) {
        await expect(
          makeAssessment(a, a.clientId, { [field]: value }),
        ).rejects.toThrow();
      }
    });

    it("refuses a completed assessment with no completion time", async () => {
      await expect(
        makeAssessment(a, a.clientId, { status: "COMPLETED", completedAt: null }),
      ).rejects.toThrow();
    });

    it("refuses a draft that claims to be completed", async () => {
      await expect(
        makeAssessment(a, a.clientId, { status: "DRAFT", completedAt: new Date() }),
      ).rejects.toThrow();
    });

    it("accepts a properly completed assessment", async () => {
      const created = await makeAssessment(a, a.clientId, {
        status: "COMPLETED",
        completedAt: new Date(),
        clientId: a.assignedClientId,
      });
      expect(created.id).toBeTruthy();
    });

    it("preserves one decimal place exactly", async () => {
      // The reason the column is NUMERIC rather than double precision.
      const created = await makeAssessment(a, a.clientId, { weightKg: 70.1 });
      const stored = await prisma.nutritionAssessment.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(String(stored.weightKg)).toBe("70.1");
    });
  });
});

describe("assessment service test configuration", () => {
  it("has a reachable database", () => {
    const reason = !hasRlsDatabase()
      ? "RLS_TEST_DATABASE_URL is not set — assessment isolation was NOT verified."
      : UNREACHABLE_MESSAGE;
    expect(enabled, reason).toBe(true);
  });
});
