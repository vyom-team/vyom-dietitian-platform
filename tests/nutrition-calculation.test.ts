import { describe, expect, it } from "vitest";

import {
  calculateNutrientsFromGrams,
  unavailableNutrientCodes,
} from "../src/lib/nutrition/calculate/nutrients";
import {
  parseQuantity,
  resolveEffectiveGrams,
} from "../src/lib/nutrition/calculate/grams";
import {
  formatGrams,
  formatNutrient,
  formatNutrientValue,
} from "../src/lib/nutrition/calculate/format";
import {
  MAX_EFFECTIVE_GRAMS,
  MAX_QUANTITY,
  type NutrientComposition,
  type ServingComposition,
} from "../src/lib/nutrition/calculate/types";
import {
  foodCalculationQuerySchema,
  foodSearchQuerySchema,
} from "../src/validations/nutrition";

/**
 * The pure calculation engine.
 *
 * Every expected value here is derived independently — by hand from the
 * published figure, the weight, and the basis — never by running the function
 * and recording what it said. A test that copies its subject's output proves
 * only that the code is consistent with itself.
 */

const FOOD_ID = "food-1";

function nutrient(
  code: string,
  value: string,
  overrides: Partial<NutrientComposition> = {},
): NutrientComposition {
  return {
    code,
    name: code,
    category: "MACRONUTRIENT",
    unit: "G",
    value,
    basisQuantity: "100",
    basisUnitCode: "g",
    displayOrder: 0,
    sourceNutrientCode: null,
    ...overrides,
  };
}

function serving(overrides: Partial<ServingComposition> = {}): ServingComposition {
  return {
    id: "serving-1",
    foodId: FOOD_ID,
    label: "bowl",
    weightGrams: "150",
    weightMethod: "PUBLISHED",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Gram normalisation
// ---------------------------------------------------------------------------

describe("gram normalisation", () => {
  it.each([
    ["100", "100"],
    ["50", "50"],
    ["150", "150"],
    ["137.5", "137.5"],
  ])("passes %s g through unchanged", (quantity, expected) => {
    const result = resolveEffectiveGrams({
      quantity,
      unit: "GRAM",
      foodId: FOOD_ID,
      serving: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.effectiveGrams.toString()).toBe(expected);
    expect(result.data.serving).toBeNull();
  });

  it("multiplies a serving weight by the quantity", () => {
    // 2 bowls × 150 g = 300 g
    const result = resolveEffectiveGrams({
      quantity: "2",
      unit: "SERVING",
      foodId: FOOD_ID,
      serving: serving(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.effectiveGrams.toString()).toBe("300");
    expect(result.data.serving?.label).toBe("bowl");
  });

  it("handles a decimal quantity of servings", () => {
    // 1.5 × 150 g = 225 g
    const result = resolveEffectiveGrams({
      quantity: "1.5",
      unit: "SERVING",
      foodId: FOOD_ID,
      serving: serving(),
    });

    expect(result.ok && result.data.effectiveGrams.toString()).toBe("225");
  });

  it("handles a decimal serving weight", () => {
    // 2 × 190.5 g = 381 g — the shape of a real DERIVED_FROM_SOURCE weight
    const result = resolveEffectiveGrams({
      quantity: "2",
      unit: "SERVING",
      foodId: FOOD_ID,
      serving: serving({ weightGrams: "190.5" }),
    });

    expect(result.ok && result.data.effectiveGrams.toString()).toBe("381");
  });

  it("multiplies decimal quantity by decimal weight without float error", () => {
    // 3 × 1.15 = 3.45 exactly. In binary floating point it is 3.4499999999999997.
    const result = resolveEffectiveGrams({
      quantity: "3",
      unit: "SERVING",
      foodId: FOOD_ID,
      serving: serving({ weightGrams: "1.15" }),
    });

    expect(result.ok && result.data.effectiveGrams.toString()).toBe("3.45");
    expect(1.15 * 3).not.toBe(3.45); // the error this avoids
  });
});

// ---------------------------------------------------------------------------
// Quantity validation
// ---------------------------------------------------------------------------

describe("quantity validation", () => {
  it.each([
    ["zero", "0"],
    ["negative", "-1"],
    ["negative decimal", "-0.5"],
    ["empty", ""],
    ["whitespace", "   "],
    ["non-numeric", "two"],
    ["NaN text", "NaN"],
    ["Infinity text", "Infinity"],
    ["-Infinity text", "-Infinity"],
    ["thousands separator", "1,000"],
    ["trailing unit", "2g"],
  ])("rejects %s", (_label, quantity) => {
    const result = parseQuantity(quantity);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_QUANTITY");
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["zero", 0],
    ["negative", -2],
  ])("rejects the number %s", (_label, quantity) => {
    const result = parseQuantity(quantity);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_QUANTITY");
  });

  it("accepts a positive number", () => {
    const result = parseQuantity(2.5);
    expect(result.ok && result.data.toString()).toBe("2.5");
  });

  it("rejects a quantity beyond the technical bound", () => {
    const result = parseQuantity(String(MAX_QUANTITY + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_QUANTITY");
  });

  it("accepts the technical bound itself", () => {
    expect(parseQuantity(String(MAX_QUANTITY)).ok).toBe(true);
  });

  it("rejects an effective weight beyond the technical bound", () => {
    // 1,000 servings × 200 g = 200,000 g, past MAX_EFFECTIVE_GRAMS
    const result = resolveEffectiveGrams({
      quantity: "1000",
      unit: "SERVING",
      foodId: FOOD_ID,
      serving: serving({ weightGrams: "200" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_QUANTITY");
    expect(1000 * 200).toBeGreaterThan(MAX_EFFECTIVE_GRAMS);
  });
});

// ---------------------------------------------------------------------------
// Unit and serving errors
// ---------------------------------------------------------------------------

describe("unit and serving validation", () => {
  it.each(["KATORI", "CUP", "ML", "gram", "", "PIECE"])(
    "rejects the unsupported unit %s",
    (unit) => {
      const result = resolveEffectiveGrams({
        quantity: "1",
        unit,
        foodId: FOOD_ID,
        serving: serving(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("UNSUPPORTED_UNIT");
    },
  );

  it("requires a serving when the unit is SERVING", () => {
    const result = resolveEffectiveGrams({
      quantity: "1",
      unit: "SERVING",
      foodId: FOOD_ID,
      serving: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SERVING_REQUIRED");
  });

  it("rejects a serving belonging to another food", () => {
    const result = resolveEffectiveGrams({
      quantity: "1",
      unit: "SERVING",
      foodId: FOOD_ID,
      serving: serving({ foodId: "a-different-food" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FOOD_SERVING_MISMATCH");
  });

  it("refuses to guess when a serving has no published weight", () => {
    const result = resolveEffectiveGrams({
      quantity: "1",
      unit: "SERVING",
      foodId: FOOD_ID,
      serving: serving({ weightGrams: null, weightMethod: "UNKNOWN" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SERVING_WEIGHT_UNAVAILABLE");
      // The message must not contain a number that could read as a weight.
      expect(result.error.message).not.toMatch(/\d+\s*g\b/);
    }
  });

  it.each(["0", "-5"])("rejects a stored serving weight of %s", (weightGrams) => {
    const result = resolveEffectiveGrams({
      quantity: "1",
      unit: "SERVING",
      foodId: FOOD_ID,
      serving: serving({ weightGrams }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NUTRIENT_VALUE_INVALID");
  });

  it("ignores a serving when the unit is GRAM", () => {
    const result = resolveEffectiveGrams({
      quantity: "100",
      unit: "GRAM",
      foodId: FOOD_ID,
      serving: serving({ foodId: "a-different-food" }),
    });

    expect(result.ok && result.data.effectiveGrams.toString()).toBe("100");
  });
});

// ---------------------------------------------------------------------------
// Nutrient arithmetic
// ---------------------------------------------------------------------------

describe("nutrient calculation", () => {
  it("computes the documented example", () => {
    // 7.5 g protein per 100 g × 300 g / 100 = 22.5 g
    const result = calculateNutrientsFromGrams([nutrient("PROTEIN", "7.5")], "300");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.value).toBe("22.5");
    expect(result.data[0]!.code).toBe("PROTEIN");
  });

  it.each([
    // [per 100 g, grams, expected] — each worked out independently
    ["7.5", "100", "7.5"],
    ["7.5", "50", "3.75"],
    ["7.5", "150", "11.25"],
    ["7.35", "137.5", "10.10625"], // 7.35 × 137.5 = 1010.625, / 100
    ["130", "300", "390"],
    ["0.331496", "190.5", "0.63149988"], // 0.331496 × 190.5 = 63.149988
  ])("computes %s per 100 g over %s g as %s", (per100, grams, expected) => {
    const result = calculateNutrientsFromGrams([nutrient("X", per100)], grams);
    expect(result.ok && result.data[0]!.value).toBe(expected);
  });

  it("preserves precision that binary floating point loses", () => {
    // 0.1 × 300 / 100 = 0.3 exactly. As a float, 0.1 × 3 is 0.30000000000000004.
    const result = calculateNutrientsFromGrams([nutrient("X", "0.1")], "300");
    expect(result.ok && result.data[0]!.value).toBe("0.3");
    expect(0.1 * 3).not.toBe(0.3);
  });

  it("keeps a very small value rather than rounding it away", () => {
    // 0.000001 mg per 100 g over 1 g = 0.00000001
    const result = calculateNutrientsFromGrams([nutrient("X", "0.000001")], "1");
    expect(result.ok && result.data[0]!.value).toBe("1e-8");
  });

  it("handles a large value without loss", () => {
    // 900 kcal per 100 g over 10,000 g = 90,000
    const result = calculateNutrientsFromGrams([nutrient("X", "900")], "10000");
    expect(result.ok && result.data[0]!.value).toBe("90000");
  });

  it("calculates an explicit zero as zero", () => {
    // A source that measured zero says zero. That is a value, not an absence.
    const result = calculateNutrientsFromGrams([nutrient("FIBRE", "0")], "300");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]!.value).toBe("0");
    expect(result.data).toHaveLength(1);
  });

  it("omits a nutrient the source did not publish — never zero", () => {
    const composition = [
      nutrient("PROTEIN", "7.5", { displayOrder: 1 }),
      nutrient("FAT", "0.4", { displayOrder: 2 }),
    ];
    const result = calculateNutrientsFromGrams(composition, "100");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const codes = result.data.map((entry) => entry.code);
    expect(codes).toEqual(["PROTEIN", "FAT"]);
    expect(codes).not.toContain("VITAMIN_B12");
    expect(result.data.find((entry) => entry.code === "VITAMIN_B12")).toBeUndefined();
  });

  it("reads the basis from the row instead of assuming 100", () => {
    // 12 g per 30 g × 60 g = 24 g. Assuming a 100 g basis would give 7.2.
    const result = calculateNutrientsFromGrams(
      [nutrient("PROTEIN", "12", { basisQuantity: "30" })],
      "60",
    );

    expect(result.ok && result.data[0]!.value).toBe("24");
  });

  it("applies one formula to macronutrients and micronutrients alike", () => {
    const composition = [
      nutrient("ENERGY", "130", { unit: "KCAL", category: "ENERGY", displayOrder: 0 }),
      nutrient("PROTEIN", "2.7", { displayOrder: 1 }),
      nutrient("CARBOHYDRATE", "28.2", { displayOrder: 2 }),
      nutrient("FAT", "0.3", { displayOrder: 3 }),
      nutrient("FIBRE", "0.4", { displayOrder: 4 }),
      nutrient("IRON", "0.2", { unit: "MG", category: "MINERAL", displayOrder: 5 }),
      nutrient("VITAMIN_C", "0", { unit: "MG", category: "VITAMIN", displayOrder: 6 }),
      nutrient("FOLATE", "58", { unit: "UG", category: "VITAMIN", displayOrder: 7 }),
    ];

    const result = calculateNutrientsFromGrams(composition, "150");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Each expected value is per-100 × 1.5, computed by hand.
    expect(byCode(result.data, "ENERGY")).toBe("195");
    expect(byCode(result.data, "PROTEIN")).toBe("4.05");
    expect(byCode(result.data, "CARBOHYDRATE")).toBe("42.3");
    expect(byCode(result.data, "FAT")).toBe("0.45");
    expect(byCode(result.data, "FIBRE")).toBe("0.6");
    expect(byCode(result.data, "IRON")).toBe("0.3");
    expect(byCode(result.data, "VITAMIN_C")).toBe("0");
    expect(byCode(result.data, "FOLATE")).toBe("87");
  });

  it("does not derive energy from macronutrients", () => {
    // protein 2.7 × 4 + carb 28.2 × 4 + fat 0.3 × 9 = 126.3, not the published 130.
    const composition = [
      nutrient("ENERGY", "130", { unit: "KCAL", category: "ENERGY" }),
      nutrient("PROTEIN", "2.7"),
      nutrient("CARBOHYDRATE", "28.2"),
      nutrient("FAT", "0.3"),
    ];

    const result = calculateNutrientsFromGrams(composition, "100");
    expect(result.ok && byCode(result.data, "ENERGY")).toBe("130");
    expect(result.ok && byCode(result.data, "ENERGY")).not.toBe("126.3");
  });

  it("orders results by the dictionary display order", () => {
    const composition = [
      nutrient("C", "1", { displayOrder: 9 }),
      nutrient("A", "1", { displayOrder: 1 }),
      nutrient("B", "1", { displayOrder: 5 }),
    ];

    const result = calculateNutrientsFromGrams(composition, "100");
    expect(result.ok && result.data.map((entry) => entry.code)).toEqual(["A", "B", "C"]);
  });

  it("is deterministic across repeated runs", () => {
    const composition = [
      nutrient("PROTEIN", "7.35"),
      nutrient("IRON", "0.331496", { unit: "MG", category: "MINERAL" }),
    ];

    const runs = Array.from({ length: 25 }, () =>
      JSON.stringify(calculateNutrientsFromGrams(composition, "137.5")),
    );

    expect(new Set(runs).size).toBe(1);
  });

  it("reports no nutrition data for an empty composition", () => {
    const result = calculateNutrientsFromGrams([], "100");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NUTRITION_DATA_UNAVAILABLE");
  });

  it.each([
    ["unreadable value", { value: "not a number" }],
    ["unreadable basis", { basisQuantity: "n/a" }],
    ["zero basis", { basisQuantity: "0" }],
    ["negative basis", { basisQuantity: "-100" }],
  ])("rejects a %s", (_label, overrides) => {
    const result = calculateNutrientsFromGrams(
      [nutrient("PROTEIN", "7.5", overrides as Partial<NutrientComposition>)],
      "100",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NUTRIENT_VALUE_INVALID");
  });

  it("rejects a non-positive weight", () => {
    const result = calculateNutrientsFromGrams([nutrient("PROTEIN", "7.5")], "0");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_QUANTITY");
  });

  it("carries the source figure through for auditability", () => {
    const result = calculateNutrientsFromGrams(
      [nutrient("PROTEIN", "7.5", { sourceNutrientCode: "protein_g" })],
      "300",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const protein = result.data[0]!;
    expect(protein.basis).toEqual({ value: "7.5", quantity: "100", unitCode: "g" });
    expect(protein.sourceNutrientCode).toBe("protein_g");
    // Everything needed to re-derive the number: 7.5 × 300 / 100 = 22.5
    expect(protein.value).toBe("22.5");
  });
});

// ---------------------------------------------------------------------------
// Raw / cooked separation
// ---------------------------------------------------------------------------

describe("raw and cooked stay separate", () => {
  it("never converts between preparation states", () => {
    // Two different Food records with different published energy. The engine
    // calculates whichever it is handed and has no notion that they are related.
    const raw = calculateNutrientsFromGrams(
      [nutrient("ENERGY", "345", { unit: "KCAL", category: "ENERGY" })],
      "100",
    );
    const cooked = calculateNutrientsFromGrams(
      [nutrient("ENERGY", "130", { unit: "KCAL", category: "ENERGY" })],
      "100",
    );

    expect(raw.ok && raw.data[0]!.value).toBe("345");
    expect(cooked.ok && cooked.data[0]!.value).toBe("130");
  });
});

// ---------------------------------------------------------------------------
// Coverage reporting
// ---------------------------------------------------------------------------

describe("nutrient coverage", () => {
  it("names the nutrients a composition does not carry", () => {
    const missing = unavailableNutrientCodes([nutrient("PROTEIN", "7.5")]);

    expect(missing).toContain("VITAMIN_B12");
    expect(missing).toContain("ENERGY");
    expect(missing).not.toContain("PROTEIN");
  });

  it("reports nothing missing when every dictionary nutrient is present", () => {
    // Built from the dictionary itself rather than a hand-written list.
    const everything = unavailableNutrientCodes([]).map((code) => nutrient(code, "1"));
    expect(unavailableNutrientCodes(everything)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

describe("display formatting", () => {
  it("rounds for display without changing the calculated value", () => {
    const result = calculateNutrientsFromGrams([nutrient("PROTEIN", "7.5125")], "300");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 7.5125 × 300 / 100 = 22.5375
    expect(result.data[0]!.value).toBe("22.5375");
    expect(formatNutrientValue(result.data[0]!.value, "G")).toBe("22.54");
  });

  it.each([
    ["1247.4", "KCAL", "1247"],
    ["0.5", "KCAL", "1"],
    ["123.456", "G", "123"],
    ["22.5375", "G", "22.54"],
    ["4.056", "G", "4.06"],
    ["0.331", "MG", "0.33"],
    ["87.5", "UG", "87.50"],
  ] as const)("formats %s %s as %s", (value, unit, expected) => {
    expect(formatNutrientValue(value, unit)).toBe(expected);
  });

  it("appends the unit label", () => {
    expect(formatNutrient("22.5375", "G")).toBe("22.54 g");
    expect(formatNutrient("87.5", "UG")).toBe("87.50 µg");
  });

  it.each([
    ["300", "300"],
    ["190.5", "191"],
    ["9.44", "9.4"],
    ["52.02", "52"],
  ])("formats %s grams as %s", (value, expected) => {
    expect(formatGrams(value)).toBe(expected);
  });
});

function byCode(
  nutrients: { code: string; value: string }[],
  code: string,
): string | undefined {
  return nutrients.find((entry) => entry.code === code)?.value;
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * The calculator page calls `.parse()` on its search params, so anything the
 * schema rejects becomes an unhandled error rather than a sensible default. A
 * URL is user input and may be hand-edited, repeated, or malformed.
 */
describe("calculator URL parsing", () => {
  it("reads a well-formed query", () => {
    expect(
      foodCalculationQuerySchema.parse({
        unit: "SERVING",
        quantity: "2",
        serving: "abc",
      }),
    ).toEqual({ unit: "SERVING", quantity: "2", serving: "abc" });
  });

  it("collapses a repeated parameter instead of throwing", () => {
    // ?unit=GRAM&unit=SERVING arrives as an array. The last value wins.
    expect(
      foodCalculationQuerySchema.parse({ unit: ["GRAM", "SERVING"] }).unit,
    ).toBe("SERVING");
  });

  it.each([
    ["repeated quantity", { quantity: ["1", "2"] }],
    ["repeated serving", { serving: ["a", "b"] }],
    ["numeric quantity", { quantity: 5 }],
    ["null unit", { unit: null }],
    ["nested object", { unit: { a: 1 } }],
    ["empty", {}],
    ["unrelated keys", { q: "rice", page: "3" }],
  ])("does not throw on %s", (_label, input) => {
    expect(() => foodCalculationQuerySchema.parse(input)).not.toThrow();
  });

  it("drops an unsupported unit rather than passing it through", () => {
    expect(foodCalculationQuerySchema.parse({ unit: "KATORI" }).unit).toBeUndefined();
  });

  it("leaves an invalid quantity for the engine to reject", () => {
    // The schema is not the place to decide what a valid quantity is — the
    // engine owns that rule and reports it as a typed, displayable error.
    expect(foodCalculationQuerySchema.parse({ quantity: "abc" }).quantity).toBe("abc");
  });

  it("drops an over-long serving id", () => {
    expect(
      foodCalculationQuerySchema.parse({ serving: "x".repeat(200) }).serving,
    ).toBeUndefined();
  });
});

describe("food search URL parsing", () => {
  it.each([
    ["repeated q", { q: ["a", "b"] }],
    ["repeated page", { page: ["1", "2"] }],
    ["nonsense page", { page: "abc" }],
    ["repeated category", { category: ["GRAINS", "PULSES"] }],
  ])("does not throw on %s", (_label, input) => {
    expect(() => foodSearchQuerySchema.parse(input)).not.toThrow();
  });

  it("still defaults the page to 1", () => {
    expect(foodSearchQuerySchema.parse({ page: "abc" }).page).toBe(1);
    expect(foodSearchQuerySchema.parse({ page: "3" }).page).toBe(3);
  });
});
