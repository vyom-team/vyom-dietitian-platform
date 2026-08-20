import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { Prisma } from "../src/generated/prisma/browser";
import { calculateFoodNutrition } from "../src/services/nutrition/calculate";
import { syncNutritionRegistry } from "../src/services/nutrition/registry";
import {
  hasRlsDatabase,
  isRlsDatabaseReachable,
  rlsDatabaseUrl,
  UNREACHABLE_MESSAGE,
} from "./helpers/rls-db";

/**
 * The calculation service against a real PostgreSQL.
 *
 * The pure engine is covered exhaustively in `nutrition-calculation.test.ts`.
 * What is proved here is everything the pure functions cannot see: that the
 * right rows are loaded, that Decimal columns survive the trip without becoming
 * floats, that one source release is chosen and honoured, and that provenance
 * arrives intact.
 *
 * ALL FIXTURE DATA IS SYNTHETIC. The nutrient figures are deliberately
 * implausible so they can never be mistaken for published values, and the
 * source version label is unique per run so a test can never collide with, or
 * overwrite, a real import.
 *
 * A second suite at the bottom runs read-only against the real INDB dataset
 * when one is configured. It only ever SELECTs.
 */

const enabled = hasRlsDatabase() && (await isRlsDatabaseReachable());
const run = `calc${Date.now().toString(36)}`;
const VERSION = `test-${run}`;

let prisma: PrismaClient;
let foodId = "";
let servingId = "";
let servingNoWeightId = "";
let emptyFoodId = "";
let otherFoodId = "";
let otherFoodServingId = "";

/**
 * Synthetic composition. Round numbers with an awkward decimal among them, so
 * an expected value can be worked out by hand and a float error would show.
 */
const COMPOSITION: { code: string; value: string }[] = [
  { code: "ENERGY", value: "1111" },
  { code: "PROTEIN", value: "22.25" },
  { code: "FAT", value: "0.1" },
  { code: "CARBOHYDRATE", value: "33.333333" },
  { code: "FIBRE", value: "0" },
  { code: "IRON", value: "7.5" },
];

/** 1 synthetic portion = 137.5 g. Not a published figure for anything. */
const SERVING_WEIGHT = "137.5";

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
    where: { code: { in: COMPOSITION.map((entry) => entry.code) } },
    select: { id: true, code: true, unit: true },
  });
  const byCode = new Map(nutrients.map((entry) => [entry.code, entry]));

  const food = await prisma.food.create({
    data: {
      canonicalName: `Synthetic Food ${run}`,
      normalizedName: `synthetic food ${run}`,
      category: "OTHER",
      foodType: "PREPARED",
      preparationState: "COOKED",
      originSourceVersionId: version.id,
      originSourceFoodId: `SYN-${run}`,
      nutrients: {
        create: COMPOSITION.map((entry) => ({
          nutrientId: byCode.get(entry.code)!.id,
          sourceVersionId: version.id,
          value: entry.value,
          unit: byCode.get(entry.code)!.unit,
          basisQuantity: "100",
          basisUnitCode: "g",
          sourceNutrientCode: `syn_${entry.code.toLowerCase()}`,
        })),
      },
      servings: {
        create: [
          {
            sourceVersionId: version.id,
            label: "synthetic portion",
            weightGrams: SERVING_WEIGHT,
            weightMethod: "PUBLISHED",
            isDefault: true,
          },
          {
            sourceVersionId: version.id,
            label: "unweighed portion",
            weightMethod: "UNKNOWN",
          },
        ],
      },
    },
    select: { id: true, servings: { select: { id: true, label: true } } },
  });

  foodId = food.id;
  servingId = food.servings.find((s) => s.label === "synthetic portion")!.id;
  servingNoWeightId = food.servings.find((s) => s.label === "unweighed portion")!.id;

  // A food with no nutrient rows at all.
  const empty = await prisma.food.create({
    data: {
      canonicalName: `Empty Food ${run}`,
      normalizedName: `empty food ${run}`,
      category: "OTHER",
      foodType: "PREPARED",
      originSourceVersionId: version.id,
      originSourceFoodId: `EMPTY-${run}`,
    },
    select: { id: true },
  });
  emptyFoodId = empty.id;

  // A second food, to prove a serving cannot be borrowed across foods.
  const other = await prisma.food.create({
    data: {
      canonicalName: `Other Food ${run}`,
      normalizedName: `other food ${run}`,
      category: "OTHER",
      foodType: "PREPARED",
      originSourceVersionId: version.id,
      originSourceFoodId: `OTHER-${run}`,
      nutrients: {
        create: [
          {
            nutrientId: byCode.get("PROTEIN")!.id,
            sourceVersionId: version.id,
            value: "1",
            unit: "G",
            basisQuantity: "100",
            basisUnitCode: "g",
          },
        ],
      },
      servings: {
        create: [
          {
            sourceVersionId: version.id,
            label: "other portion",
            weightGrams: "50",
            weightMethod: "PUBLISHED",
            isDefault: true,
          },
        ],
      },
    },
    select: { id: true, servings: { select: { id: true } } },
  });
  otherFoodId = other.id;
  otherFoodServingId = other.servings[0]!.id;
}, 120_000);

afterAll(async () => {
  if (!enabled || !prisma) return;

  // Cascades remove nutrients and servings with the food.
  await prisma.food.deleteMany({
    where: { id: { in: [foodId, emptyFoodId, otherFoodId].filter(Boolean) } },
  });
  await prisma.nutritionSourceVersion.deleteMany({ where: { version: VERSION } });
  await prisma.$disconnect();
});

describe.skipIf(!enabled)("calculation service against a database", () => {
  it("calculates by gram", async () => {
    const result = await calculateFoodNutrition(
      { foodId, quantity: "250", unit: "GRAM" },
      prisma,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.effectiveGrams).toBe("250");
    expect(result.data.serving).toBeNull();

    // Worked out independently: value × 250 / 100 = value × 2.5
    expect(value(result.data.nutrients, "PROTEIN")).toBe("55.625");
    expect(value(result.data.nutrients, "ENERGY")).toBe("2777.5");
    expect(value(result.data.nutrients, "CARBOHYDRATE")).toBe("83.3333325");
  });

  it("calculates by serving, taking the weight from the database", async () => {
    const result = await calculateFoodNutrition(
      { foodId, quantity: "2", unit: "SERVING", servingId },
      prisma,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 2 × 137.5 g = 275 g
    expect(result.data.effectiveGrams).toBe("275");
    expect(result.data.serving?.label).toBe("synthetic portion");
    expect(result.data.serving?.weightGrams).toBe("137.5");

    // 22.25 × 275 / 100 = 61.1875, computed here rather than copied from the engine
    const expected = new Prisma.Decimal("22.25")
      .mul(new Prisma.Decimal("275"))
      .div(100)
      .toString();
    expect(expected).toBe("61.1875");
    expect(value(result.data.nutrients, "PROTEIN")).toBe(expected);
  });

  it("handles a decimal quantity of servings", async () => {
    const result = await calculateFoodNutrition(
      { foodId, quantity: "0.5", unit: "SERVING", servingId },
      prisma,
    );

    // 0.5 × 137.5 = 68.75 g; 22.25 × 68.75 / 100 = 15.296875
    expect(result.ok && result.data.effectiveGrams).toBe("68.75");
    expect(result.ok && value(result.data.nutrients, "PROTEIN")).toBe("15.296875");
  });

  it("keeps an explicit zero and omits what was never published", async () => {
    const result = await calculateFoodNutrition(
      { foodId, quantity: "100", unit: "GRAM" },
      prisma,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // FIBRE was stored as an explicit 0 and is calculated like any other value.
    expect(value(result.data.nutrients, "FIBRE")).toBe("0");

    // VITAMIN_B12 was never stored. It must be absent, not zero.
    expect(value(result.data.nutrients, "VITAMIN_B12")).toBeUndefined();
    expect(result.data.unavailableNutrients).toContain("VITAMIN_B12");
  });

  it("does not lose Decimal precision on the way out of PostgreSQL", async () => {
    const result = await calculateFoodNutrition(
      { foodId, quantity: "300", unit: "GRAM" },
      prisma,
    );

    // FAT is stored as 0.1. 0.1 × 300 / 100 = 0.3, which a float would miss.
    expect(result.ok && value(result.data.nutrients, "FAT")).toBe("0.3");
  });

  it("preserves provenance all the way to the result", async () => {
    const result = await calculateFoodNutrition(
      { foodId, quantity: "100", unit: "GRAM" },
      prisma,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.provenance.source.code).toBe("IFCT");
    expect(result.data.provenance.version).toBe(VERSION);
    expect(result.data.provenance.externalFoodId).toBe(`SYN-${run}`);
    // Nothing in this codebase may mark a source as licence-approved.
    expect(result.data.provenance.source.permissionStatus).toBe("DEVELOPMENT_ONLY");

    const protein = result.data.nutrients.find((entry) => entry.code === "PROTEIN");
    expect(protein?.sourceNutrientCode).toBe("syn_protein");
    expect(protein?.basis).toEqual({ value: "22.25", quantity: "100", unitCode: "g" });
  });

  it("keeps the preparation state on the result", async () => {
    const result = await calculateFoodNutrition(
      { foodId, quantity: "100", unit: "GRAM" },
      prisma,
    );

    expect(result.ok && result.data.food.preparationState).toBe("COOKED");
  });

  it("is deterministic across repeated calls", async () => {
    const runs = await Promise.all(
      Array.from({ length: 5 }, () =>
        calculateFoodNutrition({ foodId, quantity: "137.5", unit: "GRAM" }, prisma),
      ),
    );

    const serialised = runs.map((entry) => JSON.stringify(entry));
    expect(new Set(serialised).size).toBe(1);
  });
});

describe.skipIf(!enabled)("calculation service error contract", () => {
  it("reports FOOD_NOT_FOUND for an unknown food", async () => {
    const result = await calculateFoodNutrition(
      {
        foodId: "00000000-0000-4000-8000-000000000000",
        quantity: "100",
        unit: "GRAM",
      },
      prisma,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FOOD_NOT_FOUND");
  });

  it("reports NUTRITION_DATA_UNAVAILABLE for a food with no values", async () => {
    const result = await calculateFoodNutrition(
      { foodId: emptyFoodId, quantity: "100", unit: "GRAM" },
      prisma,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NUTRITION_DATA_UNAVAILABLE");
  });

  it("reports SERVING_NOT_FOUND for an unknown serving", async () => {
    const result = await calculateFoodNutrition(
      {
        foodId,
        quantity: "1",
        unit: "SERVING",
        servingId: "00000000-0000-4000-8000-000000000000",
      },
      prisma,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SERVING_NOT_FOUND");
  });

  it("refuses a serving belonging to another food", async () => {
    const result = await calculateFoodNutrition(
      { foodId, quantity: "1", unit: "SERVING", servingId: otherFoodServingId },
      prisma,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FOOD_SERVING_MISMATCH");
  });

  it("refuses to guess a missing serving weight", async () => {
    const result = await calculateFoodNutrition(
      { foodId, quantity: "1", unit: "SERVING", servingId: servingNoWeightId },
      prisma,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SERVING_WEIGHT_UNAVAILABLE");
  });

  it.each([
    ["0", "INVALID_QUANTITY"],
    ["-1", "INVALID_QUANTITY"],
    ["abc", "INVALID_QUANTITY"],
  ])("rejects the quantity %s", async (quantity, code) => {
    const result = await calculateFoodNutrition(
      { foodId, quantity, unit: "GRAM" },
      prisma,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it("rejects an unsupported unit rather than converting it", async () => {
    const result = await calculateFoodNutrition(
      { foodId, quantity: "1", unit: "KATORI" },
      prisma,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNSUPPORTED_UNIT");
  });

  it("requires a serving id when the unit is SERVING", async () => {
    const result = await calculateFoodNutrition(
      { foodId, quantity: "1", unit: "SERVING" },
      prisma,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SERVING_REQUIRED");
  });

  it("never leaks an identifier or a driver detail in an error message", async () => {
    const result = await calculateFoodNutrition(
      { foodId: otherFoodId, quantity: "1", unit: "SERVING", servingId },
      prisma,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).not.toContain(servingId);
    expect(result.error.message).not.toContain(otherFoodId);
    expect(result.error.message.toLowerCase()).not.toContain("prisma");
    expect(result.error.message.toLowerCase()).not.toContain("food_servings");
  });
});

describe.skipIf(!enabled)("global reference data is not writable through calculation", () => {
  it("performs no writes", async () => {
    const before = await prisma.foodNutrient.count({ where: { food: { id: foodId } } });

    await calculateFoodNutrition({ foodId, quantity: "250", unit: "GRAM" }, prisma);

    const after = await prisma.foodNutrient.count({ where: { food: { id: foodId } } });
    expect(after).toBe(before);
  });

  it("takes no organization id", () => {
    // Reference data is global. If this ever gains a tenant parameter, the
    // signature change should break here first.
    expect(calculateFoodNutrition.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// The real dataset
// ---------------------------------------------------------------------------

/**
 * Read-only checks against the actually imported Phase 8B data.
 *
 * Opt-in, because it needs a database with a real import in it and the
 * disposable test database has none. Every query here is a SELECT: this suite
 * creates, updates, and deletes nothing.
 *
 *   NUTRITION_REAL_DATA_URL="postgresql://…" npx vitest run tests/nutrition-calculation-db.test.ts
 */
const realDataUrl = process.env.NUTRITION_REAL_DATA_URL;
let realPrisma: PrismaClient | undefined;

describe.skipIf(!realDataUrl)("calculation against the real imported dataset", () => {
  beforeAll(() => {
    realPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: realDataUrl! }),
    });
  });

  afterAll(async () => {
    await realPrisma?.$disconnect();
  });

  it("calculates a real food by its real serving", async () => {
    // Pick a real food deterministically: the first with a weighted serving.
    const food = await realPrisma!.food.findFirst({
      where: { isActive: true, servings: { some: { weightGrams: { not: null } } } },
      orderBy: [{ canonicalName: "asc" }, { id: "asc" }],
      select: {
        id: true,
        canonicalName: true,
        servings: {
          where: { weightGrams: { not: null } },
          orderBy: [{ isDefault: "desc" }, { label: "asc" }],
          select: { id: true, label: true, weightGrams: true },
        },
        nutrients: {
          where: { nutrient: { code: "PROTEIN" } },
          select: { value: true, basisQuantity: true },
        },
      },
    });

    expect(food, "no imported food with a weighted serving").toBeTruthy();
    if (!food || food.nutrients.length === 0) return;

    const serving = food.servings[0]!;
    const published = food.nutrients[0]!;

    const result = await calculateFoodNutrition(
      { foodId: food.id, quantity: "2", unit: "SERVING", servingId: serving.id },
      realPrisma!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    /*
     * Expected values are derived here from the raw stored columns, by a
     * separate query and separate arithmetic — not read back from the engine.
     */
    const expectedGrams = new Prisma.Decimal(serving.weightGrams!.toString()).mul(2);
    expect(result.data.effectiveGrams).toBe(expectedGrams.toString());

    const expectedProtein = new Prisma.Decimal(published.value.toString())
      .mul(expectedGrams)
      .div(new Prisma.Decimal(published.basisQuantity.toString()));
    expect(value(result.data.nutrients, "PROTEIN")).toBe(expectedProtein.toString());
  });

  it("reports the B12 and vitamin D gaps rather than zeroing them, in every source", async () => {
    /*
     * Neither imported publication measures B12, and neither states a vitamin D
     * total — they publish D2 and D3 separately, and nothing sums them. Checked
     * across every source rather than on one arbitrary food, so importing a
     * third dataset that does publish B12 makes this fail loudly rather than
     * passing by accident.
     */
    const sources = await realPrisma!.nutritionSource.findMany({
      where: { versions: { some: { foodsOriginated: { some: {} } } } },
      select: { code: true },
      orderBy: { code: "asc" },
    });

    expect(sources.length).toBeGreaterThan(0);

    for (const source of sources) {
      const food = await realPrisma!.food.findFirst({
        where: {
          isActive: true,
          nutrients: { some: {} },
          originSourceVersion: { source: { code: source.code } },
        },
        orderBy: [{ canonicalName: "asc" }, { id: "asc" }],
        select: { id: true },
      });

      if (!food) continue;

      const result = await calculateFoodNutrition(
        { foodId: food.id, quantity: "100", unit: "GRAM" },
        realPrisma!,
      );

      expect(result.ok, `${source.code} food failed to calculate`).toBe(true);
      if (!result.ok) continue;

      expect(value(result.data.nutrients, "VITAMIN_B12"), source.code).toBeUndefined();
      expect(value(result.data.nutrients, "VITAMIN_D"), source.code).toBeUndefined();
      expect(result.data.unavailableNutrients).toContain("VITAMIN_B12");
      expect(result.data.unavailableNutrients).toContain("VITAMIN_D");
    }
  });

  it("carries INDB's separately published vitamin D fractions", async () => {
    // INDB publishes D2 and D3 for every food. IFCT publishes them for only
    // some, so this is asserted against the source that actually makes the
    // claim rather than against whichever food sorts first.
    const food = await realPrisma!.food.findFirst({
      where: {
        isActive: true,
        nutrients: { some: {} },
        originSourceVersion: { source: { code: "INDB" } },
      },
      orderBy: [{ canonicalName: "asc" }, { id: "asc" }],
      select: { id: true },
    });

    if (!food) return;

    const result = await calculateFoodNutrition(
      { foodId: food.id, quantity: "100", unit: "GRAM" },
      realPrisma!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(value(result.data.nutrients, "VITAMIN_D2")).toBeDefined();
    expect(value(result.data.nutrients, "VITAMIN_D3")).toBeDefined();
  });

  it("names a single source release on the result", async () => {
    const food = await realPrisma!.food.findFirst({
      where: { isActive: true, nutrients: { some: {} } },
      orderBy: [{ canonicalName: "asc" }, { id: "asc" }],
      select: { id: true },
    });

    if (!food) return;

    const result = await calculateFoodNutrition(
      { foodId: food.id, quantity: "100", unit: "GRAM" },
      realPrisma!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.provenance.source.code).toBeTruthy();
    expect(result.data.provenance.version).toBeTruthy();
    expect(result.data.provenance.source.permissionStatus).toBe("DEVELOPMENT_ONLY");
  });
});

describe("calculation database test configuration", () => {
  it("has a reachable database", () => {
    const reason = hasRlsDatabase()
      ? UNREACHABLE_MESSAGE
      : "RLS_TEST_DATABASE_URL is not set — the calculation service was NOT verified against a database.";
    expect(enabled, reason).toBe(true);
  });
});

function value(
  nutrients: { code: string; value: string }[],
  code: string,
): string | undefined {
  return nutrients.find((entry) => entry.code === code)?.value;
}
