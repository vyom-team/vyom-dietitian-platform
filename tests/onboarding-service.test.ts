import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { slugCandidates } from "../src/lib/slug";
import { createPracticeSchema } from "../src/validations/onboarding";
import {
  hasRlsDatabase,
  isRlsDatabaseReachable,
  rlsDatabaseUrl,
  UNREACHABLE_MESSAGE,
} from "./helpers/rls-db";

/**
 * Practice creation against a real database.
 *
 * The service itself imports `server-only`, which cannot be loaded outside a
 * Next.js server bundle, so these tests exercise the same transaction and the
 * same slug sequence directly. What is being verified is the *behaviour that
 * must hold at the database*: atomicity, OWNER assignment, slug uniqueness, and
 * the impossibility of a partial practice.
 *
 * Requires RLS_TEST_DATABASE_URL. Skipped when unset; the guard at the bottom
 * fails loudly so a green run never hides an unverified transaction.
 */

const enabled = hasRlsDatabase() && (await isRlsDatabaseReachable());
const run = `svc${Date.now().toString(36)}`;

let prisma: PrismaClient;

/** Mirrors the service's transaction so the test exercises the real sequence. */
async function createPracticeFor(
  ownerProfileId: string,
  name: string,
): Promise<{ organizationId: string; slug: string } | { error: string }> {
  const existing = await prisma.organizationMember.findFirst({
    where: { userId: ownerProfileId, status: { in: ["ACTIVE", "INVITED"] } },
    select: { id: true },
  });
  if (existing) return { error: "already-member" };

  for (const slug of slugCandidates(name)) {
    try {
      const organizationId = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: { name, slug, country: "IN", timezone: "Asia/Kolkata" },
          select: { id: true },
        });
        await tx.organizationMember.create({
          data: {
            organizationId: organization.id,
            userId: ownerProfileId,
            role: "OWNER",
            status: "ACTIVE",
            joinedAt: new Date(),
          },
        });
        await tx.subscription.create({
          data: {
            organizationId: organization.id,
            plan: "FREE",
            status: "TRIALING",
            trialStartsAt: new Date(),
          },
        });
        return organization.id;
      });
      return { organizationId, slug };
    } catch (error) {
      if (String(error).includes("Unique constraint")) continue;
      throw error;
    }
  }
  return { error: "slug-exhausted" };
}

async function makeProfile(suffix: string) {
  return prisma.userProfile.create({
    data: { email: `${run}-${suffix}@vyom.test`, fullName: `Owner ${suffix}` },
    select: { id: true },
  });
}

describe.skipIf(!enabled)("practice creation", () => {
  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: rlsDatabaseUrl }),
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organizationMember.deleteMany({
      where: { organization: { slug: { startsWith: run } } },
    });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: run } } });
    await prisma.userProfile.deleteMany({ where: { email: { startsWith: run } } });
    await prisma.$disconnect();
  });

  it("creates organization, OWNER membership, and subscription together", async () => {
    const owner = await makeProfile("a");
    const result = await createPracticeFor(owner.id, `${run} Alpha Practice`);
    expect("organizationId" in result).toBe(true);
    if (!("organizationId" in result)) return;

    const org = await prisma.organization.findUnique({
      where: { id: result.organizationId },
      include: { members: true, subscription: true },
    });

    expect(org?.status).toBe("ACTIVE");
    expect(org?.members).toHaveLength(1);
    expect(org?.members[0]?.role).toBe("OWNER");
    expect(org?.members[0]?.status).toBe("ACTIVE");
    expect(org?.members[0]?.userId).toBe(owner.id);
    expect(org?.subscription?.plan).toBe("FREE");
    expect(org?.subscription?.status).toBe("TRIALING");
  });

  it("assigns OWNER, never SUPER_ADMIN", async () => {
    const owner = await makeProfile("b");
    const result = await createPracticeFor(owner.id, `${run} Beta Practice`);
    if (!("organizationId" in result)) throw new Error("creation failed");

    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId: result.organizationId },
    });
    expect(membership?.role).toBe("OWNER");
    expect(membership?.role).not.toBe("SUPER_ADMIN");
  });

  it("refuses a second practice for the same owner", async () => {
    const owner = await makeProfile("c");
    const first = await createPracticeFor(owner.id, `${run} Gamma Practice`);
    expect("organizationId" in first).toBe(true);

    const second = await createPracticeFor(owner.id, `${run} Delta Practice`);
    expect(second).toEqual({ error: "already-member" });

    const count = await prisma.organizationMember.count({
      where: { userId: owner.id },
    });
    expect(count).toBe(1);
  });

  it("resolves slug collisions with a numeric suffix", async () => {
    const first = await makeProfile("d");
    const second = await makeProfile("e");
    const name = `${run} Shared Name`;

    const a = await createPracticeFor(first.id, name);
    const b = await createPracticeFor(second.id, name);

    if (!("slug" in a) || !("slug" in b)) throw new Error("creation failed");
    expect(a.slug).not.toBe(b.slug);
    expect(b.slug).toBe(`${a.slug}-2`);
  });

  it("leaves no partial practice when the transaction fails", async () => {
    const owner = await makeProfile("f");
    const name = `${run} Rollback Practice`;
    const [slug] = [...slugCandidates(name)];

    // A membership referencing a non-existent profile violates the foreign key,
    // so the transaction must abort after the organization row was written.
    await expect(
      prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name, slug: slug!, country: "IN", timezone: "Asia/Kolkata" },
          select: { id: true },
        });
        await tx.organizationMember.create({
          data: {
            organizationId: org.id,
            userId: "00000000-0000-0000-0000-000000000000",
            role: "OWNER",
            status: "ACTIVE",
          },
        });
        return org.id;
      }),
    ).rejects.toThrow();

    // The critical assertion: the organization must not survive the rollback.
    const orphan = await prisma.organization.findUnique({ where: { slug: slug! } });
    expect(orphan, "a practice with no owner must never exist").toBeNull();

    expect(
      await prisma.organizationMember.count({ where: { userId: owner.id } }),
    ).toBe(0);
  });

  it("cannot create a membership for another user via the payload", () => {
    // The schema has no userId field at all, so a crafted payload carrying one
    // is dropped before it reaches the service.
    const parsed = createPracticeSchema.parse({
      practice: { name: "Attacker Practice", country: "IN", timezone: "Asia/Kolkata" },
      owner: { fullName: "Attacker", userId: "victim-id", role: "SUPER_ADMIN" },
    });
    expect(JSON.stringify(parsed)).not.toContain("victim-id");
    expect(JSON.stringify(parsed)).not.toContain("SUPER_ADMIN");
  });

  it("enforces one subscription per organization at the database", async () => {
    const owner = await makeProfile("g");
    const result = await createPracticeFor(owner.id, `${run} Sub Practice`);
    if (!("organizationId" in result)) throw new Error("creation failed");

    await expect(
      prisma.subscription.create({
        data: { organizationId: result.organizationId },
      }),
    ).rejects.toThrow();
  });
});

describe("onboarding service test configuration", () => {
  it("has a reachable database", () => {
    const reason = !hasRlsDatabase()
      ? "RLS_TEST_DATABASE_URL is not set — practice creation was NOT verified " +
        "against a database. See docs/security.md."
      : UNREACHABLE_MESSAGE;

    expect(enabled, reason).toBe(true);
  });
});
