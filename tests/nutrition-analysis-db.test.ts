import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { Prisma } from "../src/generated/prisma/browser";
import { getPlanAnalysis } from "../src/services/nutrition/analysis";
import {
  addPlanItem,
  createPlan,
  listPlans,
  removePlanItem,
  updatePlanItemQuantity,
} from "../src/services/nutrition/plans";
import { calculateFoodNutritionBatch } from "../src/services/nutrition/calculate";
import { syncNutritionRegistry } from "../src/services/nutrition/registry";
import {
  hasRlsDatabase,
  isRlsDatabaseReachable,
  queryAs,
  rlsDatabaseUrl,
  UNREACHABLE_MESSAGE,
} from "./helpers/rls-db";

/**
 * The analysis service against a real database.
 *
 * What is proved here is that the composition works end to end — plan items →
 * Phase 8C → aggregate → Phase 8D targets → comparison — and that the tenant
 * boundary holds around it.
 *
 * ALL FOOD AND REFERENCE DATA IN THIS FILE IS SYNTHETIC, with deliberately
 * round and implausible figures so nothing can be mistaken for a published
 * value.
 */

const enabled = hasRlsDatabase() && (await isRlsDatabaseReachable());
const run = `an${Date.now().toString(36)}`;
const VERSION = `test-${run}`;

let prisma: PrismaClient;

type Practice = {
  orgId: string;
  ownerMemberId: string;
  ownerAuthId: string;
  receptionistAuthId: string;
  clientId: string;
};

let practiceA: Practice;
let practiceB: Practice;

/** Two synthetic foods with round per-100 g values, and one weighed serving. */
let riceId = "";
let riceServingId = "";
let dalId = "";
/** Publishes protein but no energy — the partial-coverage case. */
let sparseFoodId = "";

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
      data: { organizationId: org.id, userId, role, status: "ACTIVE", joinedAt: new Date() },
      select: { id: true },
    });

  const ownerMember = await member(owner.profileId, "OWNER");
  await member(receptionist.profileId, "RECEPTIONIST");

  const person = await prisma.client.create({
    data: {
      organizationId: org.id,
      clientNumber: `VYM-${key}00001`,
      firstName: "Plan",
      lastName: "Testcase",
      dateOfBirth: new Date("1996-01-01"),
      gender: "FEMALE",
    },
    select: { id: true },
  });

  await prisma.nutritionAssessment.create({
    data: {
      organizationId: org.id,
      clientId: person.id,
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

  return {
    orgId: org.id,
    ownerMemberId: ownerMember.id,
    ownerAuthId: owner.authId,
    receptionistAuthId: receptionist.authId,
    clientId: person.id,
  };
}

beforeAll(async () => {
  if (!enabled) return;

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: rlsDatabaseUrl! }),
  });

  await syncNutritionRegistry(prisma);

  const source = await prisma.nutritionSource.findUniqueOrThrow({
    where: { code: "IFCT" },
    select: { id: true },
  });
  const version = await prisma.nutritionSourceVersion.create({
    data: { sourceId: source.id, version: VERSION },
    select: { id: true },
  });

  const nutrients = await prisma.nutrient.findMany({
    where: { code: { in: ["ENERGY", "PROTEIN", "CARBOHYDRATE", "FAT", "FIBRE", "IRON"] } },
    select: { id: true, code: true, unit: true },
  });
  const byCode = new Map(nutrients.map((entry) => [entry.code, entry]));

  const makeFood = async (
    name: string,
    values: Record<string, string>,
    withServing: boolean,
  ) => {
    const food = await prisma.food.create({
      data: {
        canonicalName: `${name} ${run}`,
        normalizedName: `${name.toLowerCase()} ${run}`,
        category: "OTHER",
        foodType: "PREPARED",
        originSourceVersionId: version.id,
        originSourceFoodId: `${name}-${run}`,
        nutrients: {
          create: Object.entries(values).map(([code, value]) => ({
            nutrientId: byCode.get(code)!.id,
            sourceVersionId: version.id,
            value,
            unit: byCode.get(code)!.unit,
            basisQuantity: "100",
            basisUnitCode: "g",
          })),
        },
        ...(withServing
          ? {
              servings: {
                create: [
                  {
                    sourceVersionId: version.id,
                    label: "bowl",
                    weightGrams: "150",
                    weightMethod: "PUBLISHED",
                    isDefault: true,
                  },
                ],
              },
            }
          : {}),
      },
      select: { id: true, servings: { select: { id: true } } },
    });
    return food;
  };

  // Round synthetic values: 100 kcal, 10 g protein, 20 g carb, 5 g fat per 100 g.
  const rice = await makeFood(
    "SynthRice",
    { ENERGY: "100", PROTEIN: "10", CARBOHYDRATE: "20", FAT: "5", FIBRE: "2", IRON: "1" },
    true,
  );
  riceId = rice.id;
  riceServingId = rice.servings[0]!.id;

  const dal = await makeFood(
    "SynthDal",
    { ENERGY: "200", PROTEIN: "20", CARBOHYDRATE: "30", FAT: "10", FIBRE: "4", IRON: "2" },
    false,
  );
  dalId = dal.id;

  // Protein only — no energy at all, so energy coverage becomes PARTIAL.
  const sparse = await makeFood("SynthSparse", { PROTEIN: "5" }, false);
  sparseFoodId = sparse.id;

  practiceA = await makePractice("a");
  practiceB = await makePractice("b");
}, 180_000);

afterAll(async () => {
  if (!enabled || !prisma) return;

  await prisma.nutritionPlanItem.deleteMany({
    where: { plan: { organization: { slug: { startsWith: run } } } },
  });
  await prisma.nutritionPlan.deleteMany({
    where: { organization: { slug: { startsWith: run } } },
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
  await prisma.food.deleteMany({ where: { originSourceFoodId: { endsWith: run } } });
  await prisma.nutritionSourceVersion.deleteMany({ where: { version: VERSION } });
  await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE email LIKE '${run}-%'`);
  await prisma.$disconnect();
});

/** Builds a plan with the given items and returns its analysis. */
async function analyse(
  practice: Practice,
  items: { slot: "BREAKFAST" | "LUNCH" | "DINNER"; foodId: string; quantity: string; servingId?: string }[],
) {
  const plan = await createPlan(
    practice.orgId,
    practice.clientId,
    practice.ownerMemberId,
    { name: `Plan ${Math.random().toString(36).slice(2, 8)}`, planDate: new Date("2026-01-05") },
    prisma,
  );

  if (!plan.ok) throw new Error("plan creation failed");

  for (const item of items) {
    const added = await addPlanItem(
      practice.orgId,
      plan.data.id,
      {
        mealSlot: item.slot,
        foodId: item.foodId,
        quantity: item.quantity,
        unit: item.servingId ? "SERVING" : "GRAM",
        servingId: item.servingId ?? null,
      },
      prisma,
    );
    if (!added.ok) throw new Error(`add item failed: ${added.reason}`);
  }

  const result = await getPlanAnalysis(
    practice.orgId,
    practice.clientId,
    plan.data.id,
    new Date("2026-01-05"),
    prisma,
  );

  if (!result.ok) throw new Error("analysis failed");
  return { planId: plan.data.id, analysis: result.data };
}

// ---------------------------------------------------------------------------

describe.skipIf(!enabled)("plan aggregation", () => {
  it("totals a single food", async () => {
    // 200 g of SynthRice at 100 kcal/100 g = 200 kcal, 20 g protein
    const { analysis } = await analyse(practiceA, [
      { slot: "BREAKFAST", foodId: riceId, quantity: "200" },
    ]);

    expect(analysis.summary.energy.actual).toBe("200");
    expect(analysis.summary.protein.actual).toBe("20");
    expect(analysis.summary.carbohydrate.actual).toBe("40");
    expect(analysis.summary.fat.actual).toBe("10");
  });

  it("totals foods across several meals", async () => {
    /*
     * Breakfast 100 g rice  → 100 kcal, 10 g protein
     * Lunch     200 g dal   → 400 kcal, 40 g protein
     * Dinner    100 g rice  → 100 kcal, 10 g protein
     * Day total             → 600 kcal, 60 g protein
     */
    const { analysis } = await analyse(practiceA, [
      { slot: "BREAKFAST", foodId: riceId, quantity: "100" },
      { slot: "LUNCH", foodId: dalId, quantity: "200" },
      { slot: "DINNER", foodId: riceId, quantity: "100" },
    ]);

    expect(analysis.summary.energy.actual).toBe("600");
    expect(analysis.summary.protein.actual).toBe("60");
  });

  it("breaks the day down by meal", async () => {
    const { analysis } = await analyse(practiceA, [
      { slot: "BREAKFAST", foodId: riceId, quantity: "100" },
      { slot: "LUNCH", foodId: dalId, quantity: "200" },
    ]);

    const breakfast = analysis.meals.find((meal) => meal.slot === "BREAKFAST")!;
    const lunch = analysis.meals.find((meal) => meal.slot === "LUNCH")!;
    const dinner = analysis.meals.find((meal) => meal.slot === "DINNER")!;

    expect(breakfast.energy).toBe("100");
    expect(lunch.energy).toBe("400");
    expect(dinner.itemCount).toBe(0);
    expect(dinner.energy).toBeUndefined();
  });

  it("converts a serving to grams via Phase 8C", async () => {
    // 2 bowls × 150 g = 300 g → 300 kcal, 30 g protein
    const { analysis } = await analyse(practiceA, [
      { slot: "LUNCH", foodId: riceId, quantity: "2", servingId: riceServingId },
    ]);

    expect(analysis.items[0]!.calculation.ok).toBe(true);
    expect(analysis.summary.energy.actual).toBe("300");
    expect(analysis.summary.protein.actual).toBe("30");
  });

  it("totals an empty plan to nothing rather than failing", async () => {
    const { analysis } = await analyse(practiceA, []);

    expect(analysis.items).toEqual([]);
    expect(analysis.summary.energy.actual).toBeUndefined();
    expect(analysis.summary.energy.status).not.toBe("BELOW_TARGET");
    expect(analysis.summary.coverage.itemCount).toBe(0);
  });

  it("preserves decimal precision through the whole chain", async () => {
    // 0.1 × 150 g serving = 15 g → 15 kcal, 1.5 g protein
    const { analysis } = await analyse(practiceA, [
      { slot: "BREAKFAST", foodId: riceId, quantity: "0.1", servingId: riceServingId },
    ]);

    expect(analysis.summary.energy.actual).toBe("15");
    expect(analysis.summary.protein.actual).toBe("1.5");

    // And the sum of two decimals that floats get wrong: 0.1 + 0.2 = 0.3
    const two = await analyse(practiceA, [
      { slot: "BREAKFAST", foodId: sparseFoodId, quantity: "2" },
      { slot: "LUNCH", foodId: sparseFoodId, quantity: "4" },
    ]);
    // 5 g/100 g × 2 g = 0.1 ; × 4 g = 0.2 ; total 0.3
    expect(two.analysis.summary.protein.actual).toBe("0.3");
    expect(0.1 + 0.2).not.toBe(0.3);
  });
});

describe.skipIf(!enabled)("missing and partial data", () => {
  it("marks a nutrient PARTIAL when only some foods publish it", async () => {
    const { analysis } = await analyse(practiceA, [
      { slot: "BREAKFAST", foodId: riceId, quantity: "100" },
      { slot: "LUNCH", foodId: sparseFoodId, quantity: "100" },
    ]);

    // Energy: only rice published it → 100 kcal, from 1 of 2 foods.
    expect(analysis.summary.energy.actual).toBe("100");
    expect(analysis.summary.energy.coverage).toBe("PARTIAL");
    expect(analysis.summary.energy.contributingItems).toBe(1);
    expect(analysis.summary.energy.totalItems).toBe(2);
    expect(analysis.summary.energy.missingFrom.length).toBe(1);

    // Protein: both published it → complete.
    expect(analysis.summary.protein.coverage).toBe("COMPLETE");
  });

  it("never reports an unpublished nutrient as zero", async () => {
    const { analysis } = await analyse(practiceA, [
      { slot: "BREAKFAST", foodId: sparseFoodId, quantity: "100" },
    ]);

    // The synthetic sparse food publishes protein only.
    expect(analysis.summary.energy.actual).toBeUndefined();
    expect(analysis.summary.energy).not.toHaveProperty("actual");
    expect(analysis.summary.carbohydrate).not.toHaveProperty("actual");

    const b12 = analysis.summary.micronutrients.find(
      (entry) => entry.code === "VITAMIN_B12",
    );
    expect(b12?.actual).toBeUndefined();
    expect(b12?.status).toBe("TARGET_UNAVAILABLE");
  });

  it("reports TARGET_UNAVAILABLE while still totalling the food", async () => {
    /*
     * The current shipped state: Phase 8D has no licensed reference for any
     * nutrient, so every comparison is target-unavailable — and the plan totals
     * are still real and useful.
     */
    const { analysis } = await analyse(practiceA, [
      { slot: "BREAKFAST", foodId: riceId, quantity: "100" },
    ]);

    expect(analysis.summary.energy.status).toBe("TARGET_UNAVAILABLE");
    expect(analysis.summary.energy.actual).toBe("100");
    expect(analysis.summary.coverage.targetsUnavailable).toBeGreaterThan(0);
  });
});

describe.skipIf(!enabled)("automatic recalculation", () => {
  it("changes the totals when a quantity changes, with no recalculate step", async () => {
    const { planId, analysis } = await analyse(practiceA, [
      { slot: "LUNCH", foodId: riceId, quantity: "100" },
    ]);

    expect(analysis.summary.energy.actual).toBe("100");

    await updatePlanItemQuantity(
      practiceA.orgId,
      planId,
      analysis.items[0]!.id,
      "150",
      prisma,
    );

    const after = await getPlanAnalysis(
      practiceA.orgId,
      practiceA.clientId,
      planId,
      new Date("2026-01-05"),
      prisma,
    );

    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.data.summary.energy.actual).toBe("150");
    expect(after.data.summary.protein.actual).toBe("15");
  });

  it("changes the totals when an item is removed", async () => {
    const { planId, analysis } = await analyse(practiceA, [
      { slot: "LUNCH", foodId: riceId, quantity: "100" },
      { slot: "DINNER", foodId: dalId, quantity: "100" },
    ]);

    expect(analysis.summary.energy.actual).toBe("300");

    const dalItem = analysis.items.find((item) => item.foodId === dalId)!;
    await removePlanItem(practiceA.orgId, planId, dalItem.id, prisma);

    const after = await getPlanAnalysis(
      practiceA.orgId,
      practiceA.clientId,
      planId,
      new Date("2026-01-05"),
      prisma,
    );

    expect(after.ok && after.data.summary.energy.actual).toBe("100");
  });

  it("stores no calculated total anywhere", async () => {
    const { planId } = await analyse(practiceA, [
      { slot: "LUNCH", foodId: riceId, quantity: "100" },
    ]);

    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('nutrition_plans', 'nutrition_plan_items')`,
    );

    const names = columns.map((row) => row.column_name);
    for (const forbidden of ["calories", "energy", "protein", "fat", "carbohydrate", "total_kcal"]) {
      expect(names).not.toContain(forbidden);
    }

    expect(planId).toBeTruthy();
  });
});

describe.skipIf(!enabled)("provenance", () => {
  it("names the source release behind the totals", async () => {
    const { analysis } = await analyse(practiceA, [
      { slot: "BREAKFAST", foodId: riceId, quantity: "100" },
    ]);

    expect(analysis.summary.provenance.foodSources).toHaveLength(1);
    expect(analysis.summary.provenance.foodSources[0]).toMatchObject({
      code: "IFCT",
      version: VERSION,
      permissionStatus: "DEVELOPMENT_ONLY",
    });
  });

  it("pins the source release on every item when it is added", async () => {
    const { planId } = await analyse(practiceA, [
      { slot: "BREAKFAST", foodId: riceId, quantity: "100" },
    ]);

    const items = await prisma.nutritionPlanItem.findMany({
      where: { planId },
      select: { sourceVersionId: true },
    });

    expect(items[0]!.sourceVersionId).toBeTruthy();
  });

  it("pins the assessment the targets came from", async () => {
    const plan = await createPlan(
      practiceA.orgId,
      practiceA.clientId,
      practiceA.ownerMemberId,
      { name: "Pinned", planDate: new Date("2026-01-06") },
      prisma,
    );

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const stored = await prisma.nutritionPlan.findUniqueOrThrow({
      where: { id: plan.data.id },
      select: { assessmentId: true },
    });

    expect(stored.assessmentId).toBeTruthy();
  });
});

describe.skipIf(!enabled)("batch calculation avoids N+1", () => {
  it("calculates many items from one food query", async () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      key: `k${index}`,
      foodId: index % 2 === 0 ? riceId : dalId,
      quantity: "100",
      unit: "GRAM",
    }));

    const results = await calculateFoodNutritionBatch(items, prisma);

    expect(results).toHaveLength(8);
    expect(results.every((entry) => entry.result.ok)).toBe(true);

    // Same food at several quantities is fetched once and reused.
    const riceResults = results.filter((_, index) => index % 2 === 0);
    expect(riceResults).toHaveLength(4);
  });

  it("fails only the item that is unusable, not the batch", async () => {
    const results = await calculateFoodNutritionBatch(
      [
        { key: "good", foodId: riceId, quantity: "100", unit: "GRAM" },
        {
          key: "missing",
          foodId: "00000000-0000-4000-8000-000000000000",
          quantity: "100",
          unit: "GRAM",
        },
        { key: "bad-quantity", foodId: riceId, quantity: "-5", unit: "GRAM" },
      ],
      prisma,
    );

    const byKey = new Map(results.map((entry) => [entry.key, entry.result]));
    expect(byKey.get("good")!.ok).toBe(true);
    expect(byKey.get("missing")!.ok).toBe(false);
    expect(byKey.get("bad-quantity")!.ok).toBe(false);
  });

  it("returns nothing for an empty batch without querying", async () => {
    expect(await calculateFoodNutritionBatch([], prisma)).toEqual([]);
  });
});

describe.skipIf(!enabled)("tenant isolation", () => {
  it("refuses a plan belonging to another practice", async () => {
    const { planId } = await analyse(practiceB, [
      { slot: "LUNCH", foodId: riceId, quantity: "100" },
    ]);

    const result = await getPlanAnalysis(
      practiceA.orgId,
      practiceA.clientId,
      planId,
      new Date("2026-01-05"),
      prisma,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PLAN_NOT_FOUND");
  });

  it("refuses to add an item to another practice's plan", async () => {
    const { planId } = await analyse(practiceB, []);

    const result = await addPlanItem(
      practiceA.orgId,
      planId,
      { mealSlot: "LUNCH", foodId: riceId, quantity: "100", unit: "GRAM" },
      prisma,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("plan-not-found");
  });

  it("does not list another practice's plans", async () => {
    await analyse(practiceB, []);
    const plans = await listPlans(practiceA.orgId, practiceB.clientId, prisma);
    expect(plans).toEqual([]);
  });

  it("refuses a plan filed against a client of another practice", async () => {
    // The database trigger is the backstop if a bug ever reaches it.
    await expect(
      prisma.nutritionPlan.create({
        data: {
          organizationId: practiceA.orgId,
          clientId: practiceB.clientId,
          createdByMemberId: practiceA.ownerMemberId,
          name: "Cross tenant",
          planDate: new Date("2026-01-05"),
        },
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!enabled)("plan tables are clinical, not public", () => {
  it("has row level security enabled on both tables", async () => {
    const rows = await prisma.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relname IN ('nutrition_plans', 'nutrition_plan_items')`,
    );

    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.relrowsecurity).toBe(true);
  });

  it("is readable by a clinical user of the owning practice", async () => {
    await analyse(practiceA, [{ slot: "LUNCH", foodId: riceId, quantity: "100" }]);

    const result = await queryAs(
      practiceA.ownerAuthId,
      "SELECT id FROM public.nutrition_plans",
    );

    expect(result.error).toBeUndefined();
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("returns nothing to a receptionist of the same practice", async () => {
    const plans = await queryAs(
      practiceA.receptionistAuthId,
      "SELECT id FROM public.nutrition_plans",
    );
    const items = await queryAs(
      practiceA.receptionistAuthId,
      "SELECT id FROM public.nutrition_plan_items",
    );

    expect(plans.rows.length).toBe(0);
    expect(items.rows.length).toBe(0);
  });

  it("returns nothing to a clinical user of another practice", async () => {
    const result = await queryAs(
      practiceB.ownerAuthId,
      `SELECT p.id FROM public.nutrition_plans p
       WHERE p.organization_id = '${practiceA.orgId}'`,
    );

    expect(result.rows.length).toBe(0);
  });

  it("cannot be written from the browser role", async () => {
    const result = await queryAs(
      practiceA.ownerAuthId,
      `INSERT INTO public.nutrition_plans (organization_id, client_id, created_by_member_id, name, plan_date)
       VALUES ('${practiceA.orgId}', '${practiceA.clientId}', '${practiceA.ownerMemberId}', 'Direct', '2026-01-05')`,
    );

    expect(result.error).toBeDefined();
  });

  it("cannot be read anonymously", async () => {
    const result = await queryAs(null, "SELECT id FROM public.nutrition_plans");
    expect(result.rows.length).toBe(0);
  });
});

describe.skipIf(!enabled)("database refuses malformed plan items", () => {
  it("rejects a non-positive quantity", async () => {
    const { planId } = await analyse(practiceA, []);

    await expect(
      prisma.nutritionPlanItem.create({
        data: {
          planId,
          mealSlot: "LUNCH",
          foodId: riceId,
          quantity: new Prisma.Decimal("0"),
          unit: "GRAM",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects an unsupported unit", async () => {
    const { planId } = await analyse(practiceA, []);

    await expect(
      prisma.nutritionPlanItem.create({
        data: {
          planId,
          mealSlot: "LUNCH",
          foodId: riceId,
          quantity: new Prisma.Decimal("1"),
          unit: "KATORI",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a serving quantity with no serving", async () => {
    const { planId } = await analyse(practiceA, []);

    await expect(
      prisma.nutritionPlanItem.create({
        data: {
          planId,
          mealSlot: "LUNCH",
          foodId: riceId,
          quantity: new Prisma.Decimal("1"),
          unit: "SERVING",
        },
      }),
    ).rejects.toThrow();
  });
});

describe("analysis database test configuration", () => {
  it("has a reachable database", () => {
    const reason = hasRlsDatabase()
      ? UNREACHABLE_MESSAGE
      : "RLS_TEST_DATABASE_URL is not set — plan isolation was NOT verified.";
    expect(enabled, reason).toBe(true);
  });
});
