import { describe, expect, it } from "vitest";

import { compareNutrient, unitsAreComparable } from "../src/lib/nutrition/analysis/compare";
import type { AggregatedNutrient } from "../src/lib/nutrition/calculate/types";
import type { Target } from "../src/lib/nutrition/targets/types";

/**
 * The comparison engine.
 *
 * It relates two numbers that other engines produced. What is under test is
 * mostly what it refuses to do: compare incompatible units, divide by zero,
 * invent a tolerance band, or turn an absence into a zero.
 *
 * Every expected figure is worked out by hand.
 */

const DEFINITION = {
  code: "PROTEIN",
  name: "Protein",
  category: "MACRONUTRIENT" as const,
  displayOrder: 2,
};

function total(overrides: Partial<AggregatedNutrient> = {}): AggregatedNutrient {
  return {
    code: "PROTEIN",
    name: "Protein",
    category: "MACRONUTRIENT",
    unit: "G",
    value: "84",
    completeness: "COMPLETE",
    contributingItems: 3,
    totalItems: 3,
    missingFrom: [],
    displayOrder: 2,
    ...overrides,
  };
}

function pointTarget(value: string, overrides: Partial<Target> = {}): Target {
  return {
    status: "CALCULATED",
    kind: "POINT",
    value,
    unit: "G_PER_DAY",
    valueType: "RDA",
    explanation: [],
    references: [],
    ...overrides,
  } as Target;
}

const NO_TARGET: Target = {
  status: "UNAVAILABLE",
  reason: "REFERENCE_REQUIRED",
  detail: "No licensed reference.",
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

describe("target comparison", () => {
  it("reports below target with the gap and percentage", () => {
    // 84 of 90 g → remaining 6, 84/90 × 100 = 93.333...
    const result = compareNutrient(total({ value: "84" }), pointTarget("90"), DEFINITION);

    expect(result.status).toBe("BELOW_TARGET");
    expect(result.actual).toBe("84");
    expect(result.target).toBe("90");
    expect(result.remaining).toBe("6");
    expect(result.percentage).toMatch(/^93\.333/);
    expect(result.percentageBasis).toBe("TARGET");
  });

  it("reports target met on exact equality", () => {
    const result = compareNutrient(total({ value: "90" }), pointTarget("90"), DEFINITION);

    expect(result.status).toBe("TARGET_MET");
    expect(result.remaining).toBe("0");
    expect(result.percentage).toBe("100");
  });

  it("reports above target with a negative remaining", () => {
    // 100 of 90 → remaining −10, 111.111...%
    const result = compareNutrient(total({ value: "100" }), pointTarget("90"), DEFINITION);

    expect(result.status).toBe("ABOVE_TARGET");
    expect(result.remaining).toBe("-10");
    expect(result.percentage).toMatch(/^111\.111/);
  });

  it("has no tolerance band — 99.9% is still below target", () => {
    /*
     * Deliberate. Deciding that "close enough" is ±5% is a clinical judgement,
     * and the percentage carries the nuance a band would have hidden.
     */
    const result = compareNutrient(total({ value: "89.91" }), pointTarget("90"), DEFINITION);
    expect(result.status).toBe("BELOW_TARGET");
    expect(result.percentage).toMatch(/^99\.9/);
  });

  it("preserves the reference's own semantic label", () => {
    const asAdequateIntake = compareNutrient(
      total(),
      pointTarget("90", { valueType: "AI" } as Partial<Target>),
      DEFINITION,
    );
    expect(asAdequateIntake.targetType).toBe("AI");

    const asUpperLimit = compareNutrient(
      total(),
      pointTarget("90", { valueType: "UL" } as Partial<Target>),
      DEFINITION,
    );
    // An upper limit exceeded is not the same event as an RDA exceeded, and the
    // engine hands the distinction on rather than interpreting it.
    expect(asUpperLimit.targetType).toBe("UL");
  });
});

describe("range targets", () => {
  const range: Target = {
    status: "CALCULATED",
    kind: "RANGE",
    min: "50",
    max: "70",
    unit: "G_PER_DAY",
    valueType: "RANGE",
    explanation: [],
    references: [],
  };

  it("treats a value inside the band as met", () => {
    const result = compareNutrient(total({ value: "60" }), range, DEFINITION);

    expect(result.status).toBe("TARGET_MET");
    expect(result.targetRange).toEqual({ min: "50", max: "70" });
    expect(result.remaining).toBe("0");
  });

  it("measures a shortfall against the floor", () => {
    const result = compareNutrient(total({ value: "40" }), range, DEFINITION);

    expect(result.status).toBe("BELOW_TARGET");
    expect(result.remaining).toBe("10");
    expect(result.percentage).toBe("80"); // 40/50
    expect(result.percentageBasis).toBe("RANGE_MINIMUM");
  });

  it("measures an excess against the ceiling", () => {
    const result = compareNutrient(total({ value: "80" }), range, DEFINITION);

    expect(result.status).toBe("ABOVE_TARGET");
    expect(result.remaining).toBe("-10");
  });

  it("never collapses a range to a single target value", () => {
    const result = compareNutrient(total({ value: "60" }), range, DEFINITION);
    expect(result.target).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Absence
// ---------------------------------------------------------------------------

describe("missing data is never zero", () => {
  it("reports DATA_UNAVAILABLE with no actual value when no food published it", () => {
    const result = compareNutrient(null, pointTarget("2.4"), {
      ...DEFINITION,
      code: "VITAMIN_B12",
      name: "Vitamin B12",
    });

    expect(result.status).toBe("DATA_UNAVAILABLE");
    expect(result).not.toHaveProperty("actual");
    expect(result.remaining).toBeUndefined();
    expect(result.percentage).toBeUndefined();
    // The target is still shown — the client still needs it.
    expect(result.target).toBe("2.4");
  });

  it("reports TARGET_UNAVAILABLE but keeps the planned amount", () => {
    const result = compareNutrient(total({ value: "84" }), NO_TARGET, DEFINITION);

    expect(result.status).toBe("TARGET_UNAVAILABLE");
    expect(result.actual).toBe("84");
    expect(result.target).toBeUndefined();
    expect(result.remaining).toBeUndefined();
  });

  it("reports TARGET_UNAVAILABLE when both sides are missing", () => {
    const result = compareNutrient(null, NO_TARGET, DEFINITION);

    expect(result.status).toBe("TARGET_UNAVAILABLE");
    expect(result).not.toHaveProperty("actual");
    expect(result.target).toBeUndefined();
  });

  it("never emits a zero for an absent nutrient anywhere in the result", () => {
    const result = compareNutrient(null, NO_TARGET, DEFINITION);
    const serialised = JSON.stringify(result);

    expect(serialised).not.toContain('"actual":0');
    expect(serialised).not.toContain('"actual":"0"');
    expect(serialised).not.toContain('"percentage":0');
  });
});

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe("partial coverage", () => {
  it("carries PARTIAL alongside a real comparison rather than replacing it", () => {
    const result = compareNutrient(
      total({
        value: "84",
        completeness: "PARTIAL",
        contributingItems: 2,
        totalItems: 3,
        missingFrom: ["Hot chocolate"],
      }),
      pointTarget("90"),
      DEFINITION,
    );

    // The comparison still happens — a partial total can still be below target.
    expect(result.status).toBe("BELOW_TARGET");
    expect(result.coverage).toBe("PARTIAL");
    expect(result.contributingItems).toBe(2);
    expect(result.totalItems).toBe(3);
    expect(result.missingFrom).toEqual(["Hot chocolate"]);
  });

  it("marks a fully covered total as COMPLETE", () => {
    const result = compareNutrient(total(), pointTarget("90"), DEFINITION);
    expect(result.coverage).toBe("COMPLETE");
    expect(result.missingFrom).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

describe("unit safety", () => {
  it.each([
    ["KCAL_PER_DAY", "KCAL", true],
    ["G_PER_DAY", "G", true],
    ["MG_PER_DAY", "MG", true],
    ["UG_PER_DAY", "UG", true],
    ["MG_PER_DAY", "G", false],
    ["G_PER_DAY", "MG", false],
    ["UG_PER_DAY", "MG", false],
    ["KCAL_PER_DAY", "KJ", false],
    ["PERCENT_OF_ENERGY", "G", false],
    ["FACTOR", "KCAL", false],
    ["G_PER_KG_PER_DAY", "G", false],
  ] as const)("%s vs %s comparable = %s", (targetUnit, actualUnit, expected) => {
    expect(unitsAreComparable(targetUnit, actualUnit)).toBe(expected);
  });

  it("refuses to compare milligrams against grams rather than converting", () => {
    /*
     * The factor-of-1000 error class. Silently treating 850 mg as 850 g would
     * look entirely reasonable on screen and be catastrophically wrong.
     */
    const result = compareNutrient(
      total({ code: "CALCIUM", name: "Calcium", unit: "MG", value: "850" }),
      pointTarget("1", { unit: "G_PER_DAY" } as Partial<Target>),
      { ...DEFINITION, code: "CALCIUM", name: "Calcium" },
    );

    expect(result.status).toBe("INCOMPARABLE_UNITS");
    expect(result.remaining).toBeUndefined();
    expect(result.percentage).toBeUndefined();
    // Both sides are still reported, so a reader can see the mismatch.
    expect(result.actual).toBe("850");
    expect(result.target).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

describe("precision", () => {
  it("does not introduce floating-point error in the gap", () => {
    // 0.3 − 0.1 = 0.2 exactly. As floats this is 0.19999999999999998.
    const result = compareNutrient(
      total({ value: "0.1" }),
      pointTarget("0.3"),
      DEFINITION,
    );

    expect(result.remaining).toBe("0.2");
    expect(0.3 - 0.1).not.toBe(0.2);
  });

  it("does not round the percentage", () => {
    // 1 / 3 × 100 = 33.333… and must not arrive pre-rounded.
    const result = compareNutrient(total({ value: "1" }), pointTarget("3"), DEFINITION);

    expect(result.percentage!.startsWith("33.3333")).toBe(true);
    expect(result.percentage).not.toBe("33.33");
  });

  it("keeps a large percentage exact", () => {
    // 1650 of 1800 kcal = 91.666…%
    const result = compareNutrient(
      total({ code: "ENERGY", name: "Energy", unit: "KCAL", value: "1650" }),
      pointTarget("1800", { unit: "KCAL_PER_DAY" } as Partial<Target>),
      { ...DEFINITION, code: "ENERGY", name: "Energy" },
    );

    expect(result.remaining).toBe("150");
    expect(result.percentage).toMatch(/^91\.666/);
  });

  it("is deterministic", () => {
    const runs = Array.from({ length: 20 }, () =>
      JSON.stringify(compareNutrient(total(), pointTarget("90"), DEFINITION)),
    );
    expect(new Set(runs).size).toBe(1);
  });
});

describe("division by zero", () => {
  it("gives no percentage when the target is zero", () => {
    const result = compareNutrient(total({ value: "5" }), pointTarget("0"), DEFINITION);

    expect(result.percentage).toBeUndefined();
    expect(result.percentageBasis).toBeUndefined();
    expect(result.status).toBe("ABOVE_TARGET");
    expect(result.remaining).toBe("-5");
  });

  it("reports target met when both sides are zero", () => {
    const result = compareNutrient(total({ value: "0" }), pointTarget("0"), DEFINITION);

    expect(result.status).toBe("TARGET_MET");
    expect(result.percentage).toBeUndefined();
  });

  it("handles a zero planned amount against a real target", () => {
    // An explicit zero is data: the plan contains a food that measured zero.
    const result = compareNutrient(total({ value: "0" }), pointTarget("90"), DEFINITION);

    expect(result.status).toBe("BELOW_TARGET");
    expect(result.actual).toBe("0");
    expect(result.remaining).toBe("90");
    expect(result.percentage).toBe("0");
  });
});
