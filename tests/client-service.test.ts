import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { formatClientNumber } from "../src/lib/clients/rules";
import {
  hasRlsDatabase,
  isRlsDatabaseReachable,
  queryAs,
  rlsDatabaseUrl,
  UNREACHABLE_MESSAGE,
} from "./helpers/rls-db";

/**
 * Client management against a real database.
 *
 * Two practices, each with an owner, a dietitian, and a receptionist, so every
 * cross-tenant assertion runs against data that genuinely belongs to someone
 * else.
 *
 * The service imports `server-only` and cannot load outside a Next.js server
 * bundle, so these exercise the same queries and transaction shape directly.
 * What is verified is what must hold *at the database*: scoping, the
 * client-number sequence under concurrency, the cross-organization assignment
 * guard, and RLS.
 *
 * All fixture data is synthetic.
 */

const enabled = hasRlsDatabase() && (await isRlsDatabaseReachable());
const run = `cl${Date.now().toString(36)}`;

let prisma: PrismaClient;

type Practice = {
  orgId: string;
  ownerMemberId: string;
  ownerAuthId: string;
  dietitianMemberId: string;
  dietitianAuthId: string;
  receptionistAuthId: string;
  ownerProfileId: string;
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

  const make = (userId: string, role: "OWNER" | "DIETITIAN" | "RECEPTIONIST") =>
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

  const ownerMember = await make(owner.profileId, "OWNER");
  const dietitianMember = await make(dietitian.profileId, "DIETITIAN");
  await make(receptionist.profileId, "RECEPTIONIST");

  return {
    orgId: org.id,
    ownerMemberId: ownerMember.id,
    ownerAuthId: owner.authId,
    ownerProfileId: owner.profileId,
    dietitianMemberId: dietitianMember.id,
    dietitianAuthId: dietitian.authId,
    receptionistAuthId: receptionist.authId,
  };
}

/** Mirrors the service's create transaction, including number reservation. */
async function createClientFor(
  orgId: string,
  createdById: string,
  firstName: string,
  assigneeMemberId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ next_client_number: number }[]>`
      UPDATE organizations
         SET next_client_number = next_client_number + 1
       WHERE id = ${orgId}::uuid
      RETURNING next_client_number
    `;
    const clientNumber = formatClientNumber(rows[0]!.next_client_number - 1);

    const client = await tx.client.create({
      data: {
        organizationId: orgId,
        clientNumber,
        firstName,
        lastName: "Testcase",
        createdById,
      },
      select: { id: true, clientNumber: true },
    });

    if (assigneeMemberId) {
      await tx.clientAssignment.create({
        data: { clientId: client.id, organizationMemberId: assigneeMemberId },
      });
    }

    return client;
  });
}

describe.skipIf(!enabled)("client management", () => {
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
  describe("client numbers", () => {
    it("starts each practice at VYM-000001", async () => {
      const client = await createClientFor(a.orgId, a.ownerProfileId, "First");
      expect(client.clientNumber).toBe("VYM-000001");
    });

    it("numbers are per-practice, not global", async () => {
      // B's first client is also 000001 — practices must not be able to infer
      // each other's client volume from a shared sequence.
      const client = await createClientFor(b.orgId, b.ownerProfileId, "First");
      expect(client.clientNumber).toBe("VYM-000001");
    });

    it("increments for subsequent clients", async () => {
      const second = await createClientFor(a.orgId, a.ownerProfileId, "Second");
      expect(second.clientNumber).toBe("VYM-000002");
    });

    it("issues unique numbers under concurrent creation", async () => {
      // The real test of the counter: `count + 1` would collide here.
      const created = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          createClientFor(a.orgId, a.ownerProfileId, `Concurrent${i}`),
        ),
      );

      const numbers = created.map((c) => c.clientNumber);
      expect(new Set(numbers).size).toBe(numbers.length);
    });

    it("does not reuse a number after a client is archived", async () => {
      const before = await createClientFor(a.orgId, a.ownerProfileId, "Archived");
      await prisma.client.update({
        where: { id: before.id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });

      const after = await createClientFor(a.orgId, a.ownerProfileId, "AfterArchive");
      expect(after.clientNumber).not.toBe(before.clientNumber);
    });

    it("rejects a duplicate number within a practice", async () => {
      await expect(
        prisma.client.create({
          data: {
            organizationId: a.orgId,
            clientNumber: "VYM-000001",
            firstName: "Dupe",
            lastName: "Testcase",
          },
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe("cross-practice isolation", () => {
    it("a scoped update cannot touch another practice's client", async () => {
      const victim = await createClientFor(b.orgId, b.ownerProfileId, "Victim");

      // Practice A attempts to rename a client belonging to practice B.
      const result = await prisma.client.updateMany({
        where: { id: victim.id, organizationId: a.orgId },
        data: { firstName: "Hijacked" },
      });

      expect(result.count).toBe(0);

      const after = await prisma.client.findUniqueOrThrow({
        where: { id: victim.id },
      });
      expect(after.firstName).toBe("Victim");
    });

    it("a scoped archive cannot touch another practice's client", async () => {
      const victim = await createClientFor(b.orgId, b.ownerProfileId, "Keep");

      const result = await prisma.client.updateMany({
        where: { id: victim.id, organizationId: a.orgId },
        data: { status: "ARCHIVED" },
      });

      expect(result.count).toBe(0);
      const after = await prisma.client.findUniqueOrThrow({
        where: { id: victim.id },
      });
      expect(after.status).toBe("ACTIVE");
    });

    it("RLS hides another practice's clients from the browser", async () => {
      const { rows } = await queryAs(
        a.ownerAuthId,
        `SELECT id FROM public.clients WHERE organization_id = $1`,
        [b.orgId],
      );
      expect(rows).toHaveLength(0);
    });

    it("RLS shows a member their own practice's clients", async () => {
      const { rows } = await queryAs(
        a.ownerAuthId,
        `SELECT id FROM public.clients WHERE organization_id = $1`,
        [a.orgId],
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it("an anonymous visitor sees no clients", async () => {
      const result = await queryAs(null, `SELECT id FROM public.clients`);
      expect(result.rows).toHaveLength(0);
    });

    it("the browser cannot write clients at all", async () => {
      const attempts = [
        `INSERT INTO public.clients (organization_id, client_number, first_name, last_name)
         VALUES ('${a.orgId}', 'VYM-999999', 'Injected', 'Row')`,
        `UPDATE public.clients SET first_name = 'Hacked'`,
        `DELETE FROM public.clients`,
      ];

      for (const sql of attempts) {
        const { error } = await queryAs(a.ownerAuthId, sql);
        expect(error, `expected refusal for: ${sql.slice(0, 40)}`).toMatch(
          /permission denied/i,
        );
      }
    });

    it("a suspended member sees no clients", async () => {
      await prisma.organizationMember.updateMany({
        where: { organizationId: a.orgId, id: a.dietitianMemberId },
        data: { status: "SUSPENDED" },
      });

      const { rows } = await queryAs(
        a.dietitianAuthId,
        `SELECT id FROM public.clients`,
      );
      expect(rows).toHaveLength(0);

      await prisma.organizationMember.updateMany({
        where: { id: a.dietitianMemberId },
        data: { status: "ACTIVE" },
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("assignment", () => {
    it("cannot assign a client to another practice's member", async () => {
      const client = await createClientFor(a.orgId, a.ownerProfileId, "Guarded");

      // The database trigger is the backstop behind the service's own check.
      await expect(
        prisma.clientAssignment.create({
          data: {
            clientId: client.id,
            organizationMemberId: b.dietitianMemberId,
          },
        }),
      ).rejects.toThrow(/one organization/i);
    });

    it("allows assignment within the same practice", async () => {
      const client = await createClientFor(a.orgId, a.ownerProfileId, "Assigned");
      const assignment = await prisma.clientAssignment.create({
        data: { clientId: client.id, organizationMemberId: a.dietitianMemberId },
      });
      expect(assignment.endedAt).toBeNull();
    });

    it("permits only one active assignment per client", async () => {
      const client = await createClientFor(a.orgId, a.ownerProfileId, "Single");
      await prisma.clientAssignment.create({
        data: { clientId: client.id, organizationMemberId: a.dietitianMemberId },
      });

      await expect(
        prisma.clientAssignment.create({
          data: { clientId: client.id, organizationMemberId: a.ownerMemberId },
        }),
      ).rejects.toThrow();
    });

    it("reassignment ends the old assignment and keeps the history", async () => {
      const client = await createClientFor(a.orgId, a.ownerProfileId, "Reassigned");
      await prisma.clientAssignment.create({
        data: { clientId: client.id, organizationMemberId: a.dietitianMemberId },
      });

      await prisma.$transaction(async (tx) => {
        await tx.clientAssignment.updateMany({
          where: { clientId: client.id, endedAt: null },
          data: { endedAt: new Date() },
        });
        await tx.clientAssignment.create({
          data: { clientId: client.id, organizationMemberId: a.ownerMemberId },
        });
      });

      const all = await prisma.clientAssignment.findMany({
        where: { clientId: client.id },
      });
      // Both rows survive: who handled a client and when is information the
      // practice may need later.
      expect(all).toHaveLength(2);
      expect(all.filter((row) => row.endedAt === null)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("dietitian visibility", () => {
    it("a dietitian's scoped query returns only their caseload", async () => {
      const mine = await createClientFor(
        a.orgId,
        a.ownerProfileId,
        "Mine",
        a.dietitianMemberId,
      );
      await createClientFor(a.orgId, a.ownerProfileId, "NotMine");

      // The same filter the service applies, expressed as SQL.
      const visible = await prisma.client.findMany({
        where: {
          organizationId: a.orgId,
          assignments: {
            some: { organizationMemberId: a.dietitianMemberId, endedAt: null },
          },
        },
        select: { id: true },
      });

      const ids = visible.map((row) => row.id);
      expect(ids).toContain(mine.id);

      const notMine = await prisma.client.findFirst({
        where: { organizationId: a.orgId, firstName: "NotMine" },
        select: { id: true },
      });
      expect(ids).not.toContain(notMine!.id);
    });
  });

  // -------------------------------------------------------------------------
  describe("archive and restore", () => {
    it("archiving sets a timestamp and keeps the row", async () => {
      const client = await createClientFor(a.orgId, a.ownerProfileId, "Lifecycle");

      await prisma.client.update({
        where: { id: client.id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });

      const archived = await prisma.client.findUniqueOrThrow({
        where: { id: client.id },
      });
      expect(archived.status).toBe("ARCHIVED");
      expect(archived.archivedAt).toBeInstanceOf(Date);
    });

    it("restoring clears the timestamp", async () => {
      const client = await createClientFor(a.orgId, a.ownerProfileId, "Restorable");
      await prisma.client.update({
        where: { id: client.id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      await prisma.client.update({
        where: { id: client.id },
        data: { status: "ACTIVE", archivedAt: null },
      });

      const restored = await prisma.client.findUniqueOrThrow({
        where: { id: client.id },
      });
      expect(restored.status).toBe("ACTIVE");
      expect(restored.archivedAt).toBeNull();
    });

    it("archiving keeps assignment history intact", async () => {
      const client = await createClientFor(
        a.orgId,
        a.ownerProfileId,
        "ArchivedAssigned",
        a.dietitianMemberId,
      );
      await prisma.client.update({
        where: { id: client.id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });

      const assignments = await prisma.clientAssignment.findMany({
        where: { clientId: client.id },
      });
      expect(assignments).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("search safety", () => {
    it("treats a SQL-injection attempt as a literal search term", async () => {
      const hostile = "'; DROP TABLE clients; --";

      const rows = await prisma.client.findMany({
        where: {
          organizationId: a.orgId,
          firstName: { contains: hostile, mode: "insensitive" },
        },
        select: { id: true },
      });
      expect(rows).toHaveLength(0);

      // The table must still exist.
      const count = await prisma.client.count({ where: { organizationId: a.orgId } });
      expect(count).toBeGreaterThan(0);
    });

    it("search stays scoped to the practice", async () => {
      // "Victim" exists only in practice B.
      const rows = await prisma.client.findMany({
        where: {
          organizationId: a.orgId,
          firstName: { contains: "Victim", mode: "insensitive" },
        },
      });
      expect(rows).toHaveLength(0);
    });
  });
});

describe("client service test configuration", () => {
  it("has a reachable database", () => {
    const reason = !hasRlsDatabase()
      ? "RLS_TEST_DATABASE_URL is not set — client isolation was NOT verified."
      : UNREACHABLE_MESSAGE;
    expect(enabled, reason).toBe(true);
  });
});
