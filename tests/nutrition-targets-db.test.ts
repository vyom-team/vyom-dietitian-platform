import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  getNutritionTargets,
  referenceRuleCoverage,
} from "../src/services/nutrition/targets";
import { syncNutritionRegistry } from "../src/services/nutrition/registry";
import {
  hasRlsDatabase,
  isRlsDatabaseReachable,
  queryAs,
  rlsDatabaseUrl,
  UNREACHABLE_MESSAGE,
} from "./helpers/rls-db";

/**
 * The target service against a real database.
 *
 * Three properties are proved here:
 *
 *   1. **Tenant isolation.** Targets derive from client health data, so unlike
 *      the food calculator this is tenant-scoped. One practice must not reach
 *      another's client by id.
 *   2. **The reference table is empty, and behaves correctly when empty.** That
 *      is the shipped state rather than a test artefact — no requirement dataset
 *      has been licensed — and the engine must report REFERENCE_REQUIRED rather
 *      than substituting a plausible figure.
 *   3. **Reference rules are global, read-only reference data**, gated on the
 *      clinical role by RLS, with no organization column.
 *
 * EVERY REFERENCE VALUE IN THIS FILE IS TEST SCAFFOLDING, deliberately round
 * and implausible so it can never be mistaken for clinical guidance.
 */

const enabled = hasRlsDatabase() && (await isRlsDatabaseReachable());
const run = `tgt${Date.now().toString(36)}`;

let prisma: PrismaClient;

type Practice = {
  orgId: string;
  ownerMemberId: string;
  ownerAuthId: string;
  receptionistAuthId: string;
  /** Female, 30, with a completed assessment carrying height and weight. */
  clientId: string;
  /** No date of birth and no gender recorded. */
  sparseClientId: string;
};

let practiceA: Practice;
let practiceB: Practice;

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
  const receptionist = await makeAuthUser(`${key}-recep`);

  const org = await prisma.organization.create({
    data: { name: `${run} ${key}`, slug: `${run}-${key}` },
    select: { id: true },
  });

  const member = (userId: string, role: "OWNER" | "RECEPTIONIST") =>
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
  await member(receptionist.profileId, "RECEPTIONIST");

  const client = await prisma.client.create({
    data: {
      organizationId: org.id,
      clientNumber: `VYM-${key}00001`,
      firstName: "Target",
      lastName: "Testcase",
      dateOfBirth: new Date("1996-01-01"),
      gender: "FEMALE",
    },
    select: { id: true },
  });

  const sparse = await prisma.client.create({
    data: {
      organizationId: org.id,
      clientNumber: `VYM-${key}00002`,
      firstName: "Sparse",
      lastName: "Testcase",
    },
    select: { id: true },
  });

  for (const id of [client.id, sparse.id]) {
    await prisma.nutritionAssessment.create({
      data: {
        organizationId: org.id,
        clientId: id,
        createdByMemberId: ownerMember.id,
        assessmentType: "INITIAL",
        status: "COMPLETED",
        assessmentDate: new Date("2025-12-01"),
        heightCm: "160.0",
        weightKg: "60.0",
        activityLevel: "MODERATELY_ACTIVE",
        primaryGoal: "WEIGHT_LOSS",
        completedAt: new Date("2025-12-01"),
      },
    });
  }

  return {
    orgId: org.id,
    ownerMemberId: ownerMember.id,
    ownerAuthId: owner.authId,
    receptionistAuthId: receptionist.authId,
    clientId: client.id,
    sparseClientId: sparse.id,
  };
}

/** Creates a synthetic reference rule and returns a cleanup function. */
async function withRule(
  data: { ruleType: "PROTEIN_PER_KG"; value: string },
  body: () => Promise<void>,
) {
  const source = await prisma.nutritionSource.findUniqueOrThrow({
    where: { code: "ICMR_NIN_RDA" },
    select: { id: true },
  });
  const version = await prisma.nutritionSourceVersion.create({
    data: { sourceId: source.id, version: `test-${run}-${Math.random().toString(36).slice(2, 8)}` },
    select: { id: true },
  });

  await prisma.referenceRule.create({
    data: {
      sourceVersionId: version.id,
      ruleType: data.ruleType,
      valueType: "RDA",
      value: data.value,
      unit: "G_PER_KG_PER_DAY",
      notes: "Synthetic test value. Not a published recommendation.",
    },
  });

  try {
    await body();
  } finally {
    await prisma.referenceRule.deleteMany({ where: { sourceVersionId: version.id } });
    await prisma.nutritionSourceVersion.delete({ where: { id: version.id } });
  }
}

beforeAll(async () => {
  if (!enabled) return;

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: rlsDatabaseUrl! }),
  });

  await syncNutritionRegistry(prisma);
  practiceA = await makePractice("a");
  practiceB = await makePractice("b");
}, 120_000);

afterAll(async () => {
  if (!enabled || !prisma) return;

  await prisma.referenceRule.deleteMany({
    where: { sourceVersion: { version: { startsWith: `test-${run}` } } },
  });
  await prisma.nutritionSourceVersion.deleteMany({
    where: { version: { startsWith: `test-${run}` } },
  });
  await prisma.nutritionAssessment.deleteMany({
    where: { organization: { slug: { startsWith: run } } },
  });
  await prisma.client.deleteMany({
    where: { organization: { slug: { startsWith: run } } },
  });
  await prisma.organizationMember.deleteMany({
    where: { organization: { slug: { startsWith: run } } },
  });
  await prisma.subscription.deleteMany({
    where: { organization: { slug: { startsWith: run } } },
  });
  await prisma.organization.deleteMany({ where: { slug: { startsWith: run } } });
  await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE email LIKE '${run}-%'`);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe.skipIf(!enabled)("reference coverage", () => {
  it("ships with no reference rules", async () => {
    /*
     * The assertion that keeps this project honest. If it ever fails, somebody
     * has seeded clinical values — and every one of them must trace to a
     * licensed publication before it belongs in this repository.
     */
    const coverage = await referenceRuleCoverage(prisma);
    expect(coverage).toEqual([]);
  });
});

describe.skipIf(!enabled)("target calculation against a database", () => {
  it("calculates resting energy from client and assessment data", async () => {
    const result = await getNutritionTargets(
      practiceA.orgId,
      practiceA.clientId,
      new Date("2026-01-01"),
      prisma,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Client born 1996-01-01, as of 2026-01-01 → 30. Female, 160 cm, 60 kg.
    // 10×60 + 6.25×160 − 5×30 − 161 = 600 + 1000 − 150 − 161 = 1289
    expect(result.data.inputs.ageYears).toBe(30);
    const bmr = result.data.basalMetabolicRate;
    expect(bmr.status).toBe("CALCULATED");
    if (bmr.status !== "CALCULATED" || bmr.kind !== "POINT") return;
    expect(bmr.value).toBe("1289");
  });

  it("reads Decimal measurements without turning them into floats", async () => {
    await prisma.nutritionAssessment.updateMany({
      where: { clientId: practiceA.clientId },
      data: { weightKg: "60.1", heightCm: "160.5" },
    });

    const result = await getNutritionTargets(
      practiceA.orgId,
      practiceA.clientId,
      new Date("2026-01-01"),
      prisma,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 10×60.1 + 6.25×160.5 − 5×30 − 161 = 601 + 1003.125 − 150 − 161 = 1293.125
    const bmr = result.data.basalMetabolicRate;
    if (bmr.status !== "CALCULATED" || bmr.kind !== "POINT") throw new Error("expected a value");
    expect(bmr.value).toBe("1293.125");

    await prisma.nutritionAssessment.updateMany({
      where: { clientId: practiceA.clientId },
      data: { weightKg: "60.0", heightCm: "160.0" },
    });
  });

  it("declines resting energy when the client has no age or sex recorded", async () => {
    const result = await getNutritionTargets(
      practiceA.orgId,
      practiceA.sparseClientId,
      new Date("2026-01-01"),
      prisma,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bmr = result.data.basalMetabolicRate;
    expect(bmr.status).toBe("UNAVAILABLE");
    if (bmr.status !== "UNAVAILABLE") return;
    expect(bmr.reason).toBe("INPUT_MISSING");
  });

  it("reports every reference-dependent target as unavailable, never zero", async () => {
    const result = await getNutritionTargets(
      practiceA.orgId,
      practiceA.clientId,
      new Date("2026-01-01"),
      prisma,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const target of [
      result.data.energyExpenditure,
      result.data.energy,
      result.data.protein,
      result.data.fat,
      result.data.carbohydrate,
      result.data.fibre,
    ]) {
      expect(target.status).toBe("UNAVAILABLE");
      expect(target).not.toHaveProperty("value");
      expect(target).not.toHaveProperty("min");
    }

    expect(result.data.micronutrients.length).toBeGreaterThan(0);
    for (const entry of result.data.micronutrients) {
      expect(entry.target.status).toBe("UNAVAILABLE");
      expect(entry.target).not.toHaveProperty("value");
    }
  });

  it("uses a rule once one exists, and carries its provenance", async () => {
    await withRule({ ruleType: "PROTEIN_PER_KG", value: "2" }, async () => {
      const result = await getNutritionTargets(
        practiceA.orgId,
        practiceA.clientId,
        new Date("2026-01-01"),
        prisma,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const protein = result.data.protein;
      expect(protein.status).toBe("CALCULATED");
      if (protein.status !== "CALCULATED" || protein.kind !== "POINT") return;

      // 60 kg × 2 g/kg = 120 g, worked out independently of the engine.
      expect(protein.value).toBe("120");

      const dataset = protein.references.find((ref) => ref.kind === "DATASET");
      expect(dataset).toBeDefined();
      if (dataset?.kind !== "DATASET") return;
      expect(dataset.sourceCode).toBe("ICMR_NIN_RDA");
      expect(dataset.permissionStatus).toBe("DEVELOPMENT_ONLY");
      expect(dataset.permissionStatus).not.toBe("APPROVED");
    });
  });

  it("keeps decimal precision through a database round trip", async () => {
    /*
     * 0.13 is chosen for its floating-point behaviour, not its plausibility —
     * it is synthetic scaffolding, like every reference value in this file.
     */
    await withRule({ ruleType: "PROTEIN_PER_KG", value: "0.13" }, async () => {
      const result = await getNutritionTargets(
        practiceA.orgId,
        practiceA.clientId,
        new Date("2026-01-01"),
        prisma,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const protein = result.data.protein;
      if (protein.status !== "CALCULATED" || protein.kind !== "POINT") {
        throw new Error("expected a calculated protein target");
      }

      // 60 × 0.13 = 7.8 exactly. The float product is 7.800000000000001.
      expect(protein.value).toBe("7.8");
      expect(60 * 0.13).not.toBe(7.8);
    });
  });

  it("ignores a draft assessment", async () => {
    const draftOnly = await prisma.client.create({
      data: {
        organizationId: practiceA.orgId,
        clientNumber: `VYM-a00003`,
        firstName: "Draft",
        lastName: "Only",
      },
      select: { id: true },
    });

    await prisma.nutritionAssessment.create({
      data: {
        organizationId: practiceA.orgId,
        clientId: draftOnly.id,
        createdByMemberId: practiceA.ownerMemberId,
        assessmentType: "INITIAL",
        status: "DRAFT",
        assessmentDate: new Date("2025-12-05"),
        heightCm: "170.0",
        weightKg: "70.0",
      },
    });

    const result = await getNutritionTargets(
      practiceA.orgId,
      draftOnly.id,
      new Date("2026-01-01"),
      prisma,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no-assessment");
  });
});

describe.skipIf(!enabled)("tenant isolation", () => {
  it("refuses a client belonging to another practice", async () => {
    const result = await getNutritionTargets(
      practiceA.orgId,
      practiceB.clientId,
      new Date("2026-01-01"),
      prisma,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("client-not-found");
  });

  it("answers identically for a foreign client and one that does not exist", async () => {
    const foreign = await getNutritionTargets(
      practiceA.orgId,
      practiceB.clientId,
      new Date("2026-01-01"),
      prisma,
    );
    const missing = await getNutritionTargets(
      practiceA.orgId,
      "00000000-0000-4000-8000-000000000000",
      new Date("2026-01-01"),
      prisma,
    );

    // Indistinguishable, so the route cannot be used to discover real ids.
    expect(foreign).toEqual(missing);
  });

  it("leaks nothing about the other practice's client in the response", async () => {
    const result = await getNutritionTargets(
      practiceA.orgId,
      practiceB.clientId,
      new Date("2026-01-01"),
      prisma,
    );

    expect(JSON.stringify(result)).not.toContain(practiceB.clientId);
    expect(JSON.stringify(result)).not.toContain(practiceB.orgId);
  });
});

describe.skipIf(!enabled)("reference rules are global, read-only reference data", () => {
  it("has no organization_id column", async () => {
    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'reference_rules'`,
    );

    expect(columns.map((row) => row.column_name)).not.toContain("organization_id");
  });

  it("has row level security enabled", async () => {
    const rows = await prisma.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'reference_rules'`,
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it("is readable by a clinical user", async () => {
    const result = await queryAs(
      practiceA.ownerAuthId,
      "SELECT id FROM public.reference_rules LIMIT 1",
    );
    expect(result.error).toBeUndefined();
  });

  it("returns nothing to a receptionist", async () => {
    const result = await queryAs(
      practiceA.receptionistAuthId,
      "SELECT id FROM public.reference_rules LIMIT 1",
    );
    expect(result.rows.length).toBe(0);
  });

  it("cannot be written by a clinical user", async () => {
    const result = await queryAs(
      practiceA.ownerAuthId,
      `INSERT INTO public.reference_rules
         (source_version_id, rule_type, value_type, value, unit)
       VALUES (gen_random_uuid(), 'PROTEIN_PER_KG', 'RDA', 999, 'G_PER_KG_PER_DAY')`,
    );

    expect(result.error).toBeDefined();
  });

  it("cannot be read anonymously", async () => {
    const result = await queryAs(null, "SELECT id FROM public.reference_rules LIMIT 1");
    expect(result.rows.length).toBe(0);
  });
});

describe.skipIf(!enabled)("database refuses malformed reference rules", () => {
  it("rejects a micronutrient rule with no nutrient", async () => {
    const source = await prisma.nutritionSource.findUniqueOrThrow({
      where: { code: "ICMR_NIN_RDA" },
      select: { id: true },
    });
    const version = await prisma.nutritionSourceVersion.create({
      data: { sourceId: source.id, version: `test-${run}-bad1` },
      select: { id: true },
    });

    await expect(
      prisma.referenceRule.create({
        data: {
          sourceVersionId: version.id,
          ruleType: "MICRONUTRIENT_INTAKE",
          valueType: "RDA",
          value: "10",
          unit: "MG_PER_DAY",
        },
      }),
    ).rejects.toThrow();

    await prisma.nutritionSourceVersion.delete({ where: { id: version.id } });
  });

  it("rejects a RANGE with only one bound", async () => {
    const source = await prisma.nutritionSource.findUniqueOrThrow({
      where: { code: "ICMR_NIN_RDA" },
      select: { id: true },
    });
    const version = await prisma.nutritionSourceVersion.create({
      data: { sourceId: source.id, version: `test-${run}-bad2` },
      select: { id: true },
    });

    await expect(
      prisma.referenceRule.create({
        data: {
          sourceVersionId: version.id,
          ruleType: "FIBRE_INTAKE",
          valueType: "RANGE",
          valueMin: "25",
          unit: "G_PER_DAY",
        },
      }),
    ).rejects.toThrow();

    await prisma.nutritionSourceVersion.delete({ where: { id: version.id } });
  });

  it("rejects a negative requirement", async () => {
    const source = await prisma.nutritionSource.findUniqueOrThrow({
      where: { code: "ICMR_NIN_RDA" },
      select: { id: true },
    });
    const version = await prisma.nutritionSourceVersion.create({
      data: { sourceId: source.id, version: `test-${run}-bad3` },
      select: { id: true },
    });

    await expect(
      prisma.referenceRule.create({
        data: {
          sourceVersionId: version.id,
          ruleType: "PROTEIN_PER_KG",
          valueType: "RDA",
          value: "-1",
          unit: "G_PER_KG_PER_DAY",
        },
      }),
    ).rejects.toThrow();

    await prisma.nutritionSourceVersion.delete({ where: { id: version.id } });
  });
});

describe("target database test configuration", () => {
  it("has a reachable database", () => {
    const reason = hasRlsDatabase()
      ? UNREACHABLE_MESSAGE
      : "RLS_TEST_DATABASE_URL is not set — target isolation was NOT verified.";
    expect(enabled, reason).toBe(true);
  });
});
