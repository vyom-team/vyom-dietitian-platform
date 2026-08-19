import { describe, expect, it } from "vitest";

import { aggregateNutrition } from "../src/lib/nutrition/calculate/aggregate";
import type {
  AggregatedNutrient,
  CalculatedNutrient,
  NutritionCalculationResult,
} from "../src/lib/nutrition/calculate/types";

/**
 * Aggregation — the primitive a meal total is built from.
 *
 * The behaviour under test is mostly about honesty rather than arithmetic:
 * summing is easy, and saying truthfully how much of the meal a total actually
 * covers is the part that protects a practitioner from a number that looks
 * complete and is not.
 */

function calculated(
  code: string,
  value: string,
  overrides: Partial<CalculatedNutrient> = {},
): CalculatedNutrient {
  return {
    code,
    name: code,
    category: "MACRONUTRIENT",
    unit: "G",
    value,
    basis: { value: "0", quantity: "100", unitCode: "g" },
    displayOrder: 0,
    sourceNutrientCode: null,
    ...overrides,
  };
}

function item(
  name: string,
  nutrients: CalculatedNutrient[],
  overrides: Partial<NutritionCalculationResult> = {},
): NutritionCalculationResult {
  return {
    food: {
      id: `food-${name}`,
      name,
      category: "OTHER",
      foodType: "PREPARED",
      preparationState: "UNKNOWN",
    },
    quantity: "1",
    unit: "GRAM",
    serving: null,
    effectiveGrams: "100",
    nutrients,
    unavailableNutrients: [],
    provenance: {
      source: {
        code: "INDB",
        name: "Indian Nutrient Databank",
        permissionStatus: "DEVELOPMENT_ONLY",
        attributionRequired: true,
        attributionText: null,
      },
      version: "2024.11",
      externalFoodId: null,
    },
    ...overrides,
  };
}

function find(
  nutrients: AggregatedNutrient[],
  code: string,
): AggregatedNutrient | undefined {
  return nutrients.find((entry) => entry.code === code);
}

describe("aggregation", () => {
  it("returns a single food unchanged", () => {
    const result = aggregateNutrition([item("Rice", [calculated("PROTEIN", "4.05")])]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const protein = find(result.data.nutrients, "PROTEIN");
    expect(protein?.value).toBe("4.05");
    expect(protein?.completeness).toBe("COMPLETE");
    expect(protein?.contributingItems).toBe(1);
    expect(protein?.totalItems).toBe(1);
    expect(result.data.hasPartialTotals).toBe(false);
  });

  it("sums a nutrient two foods share", () => {
    // 4.05 + 6.2 = 10.25
    const result = aggregateNutrition([
      item("Rice", [calculated("PROTEIN", "4.05")]),
      item("Dal", [calculated("PROTEIN", "6.2")]),
    ]);

    expect(result.ok && find(result.data.nutrients, "PROTEIN")?.value).toBe("10.25");
    expect(result.ok && find(result.data.nutrients, "PROTEIN")?.completeness).toBe(
      "COMPLETE",
    );
  });

  it("sums a nutrient three foods share", () => {
    // 4.05 + 6.2 + 2.75 = 13
    const result = aggregateNutrition([
      item("Rice", [calculated("PROTEIN", "4.05")]),
      item("Dal", [calculated("PROTEIN", "6.2")]),
      item("Roti", [calculated("PROTEIN", "2.75")]),
    ]);

    expect(result.ok && find(result.data.nutrients, "PROTEIN")?.value).toBe("13");
    expect(result.ok && find(result.data.nutrients, "PROTEIN")?.contributingItems).toBe(3);
  });

  it("totals the effective weight", () => {
    const result = aggregateNutrition([
      item("Rice", [calculated("PROTEIN", "1")], { effectiveGrams: "150" }),
      item("Dal", [calculated("PROTEIN", "1")], { effectiveGrams: "120.5" }),
    ]);

    expect(result.ok && result.data.totalGrams).toBe("270.5");
  });

  it("sums decimals without floating-point drift", () => {
    // 0.1 + 0.2 = 0.3. As floats this is 0.30000000000000004.
    const result = aggregateNutrition([
      item("A", [calculated("FAT", "0.1")]),
      item("B", [calculated("FAT", "0.2")]),
    ]);

    expect(result.ok && find(result.data.nutrients, "FAT")?.value).toBe("0.3");
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("counts an explicit zero as a contribution", () => {
    // A measured zero is data. 4.05 + 0 = 4.05, and coverage is complete.
    const result = aggregateNutrition([
      item("Rice", [calculated("FIBRE", "4.05")]),
      item("Oil", [calculated("FIBRE", "0")]),
    ]);

    const fibre = result.ok ? find(result.data.nutrients, "FIBRE") : undefined;
    expect(fibre?.value).toBe("4.05");
    expect(fibre?.completeness).toBe("COMPLETE");
    expect(fibre?.contributingItems).toBe(2);
    expect(fibre?.missingFrom).toEqual([]);
  });
});

describe("aggregation completeness", () => {
  it("marks a total PARTIAL when one food lacks the nutrient", () => {
    const result = aggregateNutrition([
      item("Rice", [calculated("PROTEIN", "4.05"), calculated("IRON", "0.3")]),
      item("Oil", [calculated("PROTEIN", "0")]), // publishes no iron at all
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const iron = find(result.data.nutrients, "IRON");
    expect(iron?.value).toBe("0.3");
    expect(iron?.completeness).toBe("PARTIAL");
    expect(iron?.contributingItems).toBe(1);
    expect(iron?.totalItems).toBe(2);
    expect(iron?.missingFrom).toEqual(["Oil"]);

    // Protein is covered by both, so it stays complete in the same result.
    expect(find(result.data.nutrients, "PROTEIN")?.completeness).toBe("COMPLETE");
    expect(result.data.hasPartialTotals).toBe(true);
  });

  it("names every food a nutrient is missing from", () => {
    const result = aggregateNutrition([
      item("Rice", [calculated("IRON", "0.3")]),
      item("Oil", [calculated("PROTEIN", "0")]),
      item("Water", [calculated("PROTEIN", "0")]),
    ]);

    const iron = result.ok ? find(result.data.nutrients, "IRON") : undefined;
    expect(iron?.missingFrom).toEqual(["Oil", "Water"]);
    expect(iron?.contributingItems).toBe(1);
    expect(iron?.totalItems).toBe(3);
  });

  it("omits a nutrient no food published, rather than totalling it as zero", () => {
    const result = aggregateNutrition([
      item("Rice", [calculated("PROTEIN", "4.05")]),
      item("Dal", [calculated("PROTEIN", "6.2")]),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(find(result.data.nutrients, "VITAMIN_B12")).toBeUndefined();
    expect(result.data.unavailableNutrients).toContain("VITAMIN_B12");
    expect(result.data.unavailableNutrients).toContain("VITAMIN_D");
    expect(result.data.unavailableNutrients).not.toContain("PROTEIN");
  });

  it("aggregates an empty list to nothing rather than failing", () => {
    const result = aggregateNutrition([]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.nutrients).toEqual([]);
    expect(result.data.totalGrams).toBe("0");
    expect(result.data.hasPartialTotals).toBe(false);
    expect(result.data.unavailableNutrients).toContain("PROTEIN");
  });
});

describe("aggregation provenance", () => {
  it("keeps one entry per distinct source release", () => {
    const result = aggregateNutrition([
      item("Rice", [calculated("PROTEIN", "1")]),
      item("Dal", [calculated("PROTEIN", "1")]),
    ]);

    expect(result.ok && result.data.sources).toHaveLength(1);
    expect(result.ok && result.data.sources[0]!.source.code).toBe("INDB");
    expect(result.ok && result.data.sources[0]!.version).toBe("2024.11");
  });

  it("reports every source when a total spans two releases", () => {
    const fromIfct = item("Toor dal", [calculated("PROTEIN", "6.2")], {
      provenance: {
        source: {
          code: "IFCT",
          name: "Indian Food Composition Tables",
          permissionStatus: "DEVELOPMENT_ONLY",
          attributionRequired: true,
          attributionText: null,
        },
        version: "2017",
        externalFoodId: "A012",
      },
    });

    const result = aggregateNutrition([item("Rice", [calculated("PROTEIN", "4.05")]), fromIfct]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sources.map((entry) => entry.source.code)).toEqual([
      "INDB",
      "IFCT",
    ]);
  });

  it("keeps every calculated item for a per-food breakdown", () => {
    const result = aggregateNutrition([
      item("Rice", [calculated("PROTEIN", "4.05")]),
      item("Dal", [calculated("PROTEIN", "6.2")]),
    ]);

    expect(result.ok && result.data.items).toHaveLength(2);
    expect(result.ok && result.data.items[0]!.food.name).toBe("Rice");
  });
});

describe("aggregation safety", () => {
  it("refuses to total one nutrient recorded in two units", () => {
    // Summing milligrams into grams would be wrong by a factor of a thousand
    // and would look perfectly reasonable on screen.
    const result = aggregateNutrition([
      item("A", [calculated("CALCIUM", "120", { unit: "MG" })]),
      item("B", [calculated("CALCIUM", "0.4", { unit: "G" })]),
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NUTRIENT_VALUE_INVALID");
  });

  it("is deterministic across repeated runs", () => {
    const items = [
      item("Rice", [calculated("PROTEIN", "4.05"), calculated("IRON", "0.331496")]),
      item("Dal", [calculated("PROTEIN", "6.2")]),
    ];

    const runs = Array.from({ length: 25 }, () =>
      JSON.stringify(aggregateNutrition(items)),
    );

    expect(new Set(runs).size).toBe(1);
  });

  it("orders totals by the dictionary display order", () => {
    const result = aggregateNutrition([
      item("A", [
        calculated("C", "1", { displayOrder: 9 }),
        calculated("A", "1", { displayOrder: 1 }),
        calculated("B", "1", { displayOrder: 5 }),
      ]),
    ]);

    expect(result.ok && result.data.nutrients.map((entry) => entry.code)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
});
