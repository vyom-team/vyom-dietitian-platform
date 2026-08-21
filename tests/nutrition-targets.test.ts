import { describe, expect, it } from "vitest";

import { ageInYears, calculateBmr, MIFFLIN_ST_JEOR } from "../src/lib/nutrition/targets/bmr";
import { buildTargetProfile } from "../src/lib/nutrition/targets/engine";
import { referenceSexFor, resolveRule } from "../src/lib/nutrition/targets/resolve";
import type {
  ReferenceRuleData,
  Target,
  TargetInputs,
} from "../src/lib/nutrition/targets/types";

/**
 * The nutrition target engine.
 *
 * Two things are under test and they matter in different ways. The arithmetic
 * must be right; but the *refusals* matter more, because a fabricated clinical
 * target is worse than no target at all. Most of this file checks that the
 * engine declines to answer.
 *
 * Every expected number is worked out by hand from the published equation,
 * never copied from a run of the function.
 */

const ADULT: TargetInputs = {
  ageYears: 30,
  gender: "MALE",
  heightCm: "170",
  weightKg: "70",
  activityLevel: "MODERATELY_ACTIVE",
  primaryGoal: "WEIGHT_LOSS",
  physiologicalState: "NONE",
};

function inputs(overrides: Partial<TargetInputs> = {}): TargetInputs {
  return { ...ADULT, ...overrides };
}

function rule(overrides: Partial<ReferenceRuleData> = {}): ReferenceRuleData {
  return {
    id: "rule-1",
    ruleType: "PROTEIN_PER_KG",
    nutrientCode: null,
    ruleKey: null,
    sexApplicability: "ANY",
    ageMinYears: null,
    ageMaxYears: null,
    physiologicalState: "NONE",
    valueType: "RDA",
    value: "1",
    valueMin: null,
    valueMax: null,
    unit: "G_PER_KG_PER_DAY",
    notes: null,
    source: {
      code: "TEST_SOURCE",
      name: "Synthetic reference for tests",
      version: "0.0-test",
      permissionStatus: "DEVELOPMENT_ONLY",
    },
    ...overrides,
  };
}

function pointValue(target: Target): string | undefined {
  return target.status === "CALCULATED" && target.kind === "POINT" ? target.value : undefined;
}

// ---------------------------------------------------------------------------
// BMR — the one calculable target
// ---------------------------------------------------------------------------

describe("BMR — Mifflin-St Jeor", () => {
  it("computes the male equation", () => {
    // 10×70 + 6.25×170 − 5×30 + 5 = 700 + 1062.5 − 150 + 5 = 1617.5
    expect(pointValue(calculateBmr(inputs()))).toBe("1617.5");
  });

  it("computes the female equation", () => {
    // 10×60 + 6.25×160 − 5×30 − 161 = 600 + 1000 − 150 − 161 = 1289
    const result = calculateBmr(
      inputs({ gender: "FEMALE", weightKg: "60", heightCm: "160" }),
    );
    expect(pointValue(result)).toBe("1289");
  });

  it("differs between sexes by exactly the constant", () => {
    // The two constants are +5 and −161: a 166 kcal difference, nothing else.
    const male = pointValue(calculateBmr(inputs({ gender: "MALE" })))!;
    const female = pointValue(calculateBmr(inputs({ gender: "FEMALE" })))!;
    expect(Number(male) - Number(female)).toBe(166);
  });

  it("preserves decimal precision", () => {
    // 10×70.1 + 6.25×170.5 − 5×31 + 5 = 701 + 1065.625 − 155 + 5 = 1616.625
    const result = calculateBmr(
      inputs({ weightKg: "70.1", heightCm: "170.5", ageYears: 31 }),
    );
    expect(pointValue(result)).toBe("1616.625");
  });

  it("computes with a decimal height", () => {
    // 10×70 + 6.25×170.1 − 5×30 + 5 = 700 + 1063.125 − 150 + 5 = 1618.125
    //
    // The equation itself is float-safe: 10, 6.25 and 5 are all exactly
    // representable in binary. Decimal earns its place downstream, where
    // arbitrary reference factors multiply this figure — see the pipeline
    // precision test below.
    const result = calculateBmr(inputs({ heightCm: "170.1", weightKg: "70", ageYears: 30 }));
    expect(pointValue(result)).toBe("1618.125");
  });

  it("carries the citation on the result", () => {
    const result = calculateBmr(inputs());
    expect(result.status).toBe("CALCULATED");
    if (result.status !== "CALCULATED") return;

    expect(result.references).toContainEqual(MIFFLIN_ST_JEOR);
    expect(result.references[0]).toMatchObject({ kind: "PUBLICATION" });
    expect(JSON.stringify(result.references)).toContain("Am J Clin Nutr");
  });

  it("explains every term of the derivation", () => {
    const result = calculateBmr(inputs());
    if (result.status !== "CALCULATED") throw new Error("expected a value");

    const labels = result.explanation.map((step) => step.label);
    expect(labels).toContain("Weight term");
    expect(labels).toContain("Height term");
    expect(labels).toContain("Age term");
    expect(labels).toContain("Sex constant");
    // The steps must reconstruct the answer: 700 + 1062.5 − 150 + 5
    expect(result.explanation.find((s) => s.label === "Weight term")?.value).toBe("700");
    expect(result.explanation.find((s) => s.label === "Height term")?.value).toBe("1062.5");
  });

  it("is deterministic", () => {
    const runs = Array.from({ length: 20 }, () => JSON.stringify(calculateBmr(inputs())));
    expect(new Set(runs).size).toBe(1);
  });
});

describe("BMR refusals", () => {
  it.each([
    ["weight", { weightKg: null }],
    ["height", { heightCm: null }],
    ["age", { ageYears: null }],
    ["sex", { gender: null }],
  ])("declines when %s is not recorded", (_label, overrides) => {
    const result = calculateBmr(inputs(overrides as Partial<TargetInputs>));
    expect(result.status).toBe("UNAVAILABLE");
    if (result.status !== "UNAVAILABLE") return;
    expect(result.reason).toBe("INPUT_MISSING");
  });

  it.each(["OTHER", "UNDISCLOSED"] as const)(
    "refuses to default %s to a male constant",
    (gender) => {
      const result = calculateBmr(inputs({ gender }));

      expect(result.status).toBe("UNAVAILABLE");
      if (result.status !== "UNAVAILABLE") return;
      expect(result.reason).toBe("POPULATION_UNSUPPORTED");

      // The male answer must not have leaked out under a different label.
      expect(JSON.stringify(result)).not.toContain("1617.5");
    },
  );

  it.each([
    ["weight below bounds", { weightKg: "0.4" }],
    ["weight above bounds", { weightKg: "600" }],
    ["height below bounds", { heightCm: "20" }],
    ["height above bounds", { heightCm: "300" }],
    ["unreadable weight", { weightKg: "seventy" }],
    ["negative weight", { weightKg: "-70" }],
  ])("rejects %s", (_label, overrides) => {
    const result = calculateBmr(inputs(overrides as Partial<TargetInputs>));
    expect(result.status).toBe("UNAVAILABLE");
    if (result.status !== "UNAVAILABLE") return;
    expect(result.reason).toBe("INPUT_INVALID");
  });

  it.each([-1, 131, 30.5, Number.NaN])("rejects the age %s", (ageYears) => {
    const result = calculateBmr(inputs({ ageYears }));
    expect(result.status).toBe("UNAVAILABLE");
  });
});

describe("age derivation", () => {
  it("counts whole years", () => {
    expect(ageInYears(new Date("1990-06-15"), new Date("2026-06-15"))).toBe(36);
  });

  it("does not count a birthday that has not happened", () => {
    expect(ageInYears(new Date("1990-06-16"), new Date("2026-06-15"))).toBe(35);
  });

  it("counts the birthday itself", () => {
    expect(ageInYears(new Date("1990-06-15"), new Date("2026-06-15"))).toBe(36);
  });

  it("handles a leap day", () => {
    expect(ageInYears(new Date("2000-02-29"), new Date("2026-02-28"))).toBe(25);
    expect(ageInYears(new Date("2000-02-29"), new Date("2026-03-01"))).toBe(26);
  });

  it("returns null for a future birth date", () => {
    expect(ageInYears(new Date("2030-01-01"), new Date("2026-01-01"))).toBeNull();
  });

  it("takes the reference date as a parameter rather than reading a clock", () => {
    // Same inputs, computed twice, must agree regardless of when the test runs.
    const a = ageInYears(new Date("1990-06-15"), new Date("2026-06-15"));
    const b = ageInYears(new Date("1990-06-15"), new Date("2026-06-15"));
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

describe("reference rule resolution", () => {
  it("reports no rules when the table is empty", () => {
    const result = resolveRule([], { ruleType: "PROTEIN_PER_KG" }, inputs());
    expect(result).toEqual({ matched: false, reason: "NO_RULES_OF_TYPE" });
  });

  it("matches a rule with no applicability restrictions", () => {
    const result = resolveRule([rule()], { ruleType: "PROTEIN_PER_KG" }, inputs());
    expect(result.matched).toBe(true);
  });

  it("selects by age band", () => {
    const child = rule({ id: "child", ageMinYears: 0, ageMaxYears: 17, value: "1.2" });
    const adult = rule({ id: "adult", ageMinYears: 18, ageMaxYears: 130, value: "0.9" });

    const result = resolveRule([child, adult], { ruleType: "PROTEIN_PER_KG" }, inputs({ ageYears: 30 }));
    expect(result.matched && result.rule.id).toBe("adult");
  });

  it("never applies an adult rule to someone below its age band", () => {
    const adult = rule({ id: "adult", ageMinYears: 18, ageMaxYears: 130 });

    const result = resolveRule([adult], { ruleType: "PROTEIN_PER_KG" }, inputs({ ageYears: 17 }));
    expect(result).toEqual({ matched: false, reason: "NO_APPLICABLE_POPULATION" });
  });

  it("selects by sex", () => {
    const female = rule({ id: "f", sexApplicability: "FEMALE" });
    const male = rule({ id: "m", sexApplicability: "MALE" });
    const rules = [female, male];

    const forFemale = resolveRule(rules, { ruleType: "PROTEIN_PER_KG" }, inputs({ gender: "FEMALE" }));
    const forMale = resolveRule(rules, { ruleType: "PROTEIN_PER_KG" }, inputs({ gender: "MALE" }));

    expect(forFemale.matched && forFemale.rule.id).toBe("f");
    expect(forMale.matched && forMale.rule.id).toBe("m");
  });

  it("prefers a sex-specific rule over a general one", () => {
    const any = rule({ id: "any", sexApplicability: "ANY" });
    const male = rule({ id: "male", sexApplicability: "MALE" });

    const result = resolveRule([any, male], { ruleType: "PROTEIN_PER_KG" }, inputs());
    expect(result.matched && result.rule.id).toBe("male");
  });

  it("prefers a narrower age band", () => {
    const wide = rule({ id: "wide", ageMinYears: 18, ageMaxYears: 130 });
    const narrow = rule({ id: "narrow", ageMinYears: 19, ageMaxYears: 49 });

    const result = resolveRule([wide, narrow], { ruleType: "PROTEIN_PER_KG" }, inputs());
    expect(result.matched && result.rule.id).toBe("narrow");
  });

  it("falls back to a general rule when sex does not map", () => {
    const any = rule({ id: "any", sexApplicability: "ANY" });
    const male = rule({ id: "male", sexApplicability: "MALE" });

    const result = resolveRule([any, male], { ruleType: "PROTEIN_PER_KG" }, inputs({ gender: "OTHER" }));
    expect(result.matched && result.rule.id).toBe("any");
  });

  it("applies no age-bounded rule when age is unknown", () => {
    const bounded = rule({ id: "bounded", ageMinYears: 18, ageMaxYears: 60 });

    const result = resolveRule([bounded], { ruleType: "PROTEIN_PER_KG" }, inputs({ ageYears: null }));
    expect(result).toEqual({ matched: false, reason: "NO_APPLICABLE_POPULATION" });
  });

  it("never applies a pregnancy rule to a client with no physiological state", () => {
    const pregnancy = rule({ id: "preg", physiologicalState: "PREGNANCY" });

    const result = resolveRule([pregnancy], { ruleType: "PROTEIN_PER_KG" }, inputs());
    expect(result).toEqual({ matched: false, reason: "NO_APPLICABLE_POPULATION" });
  });

  it("keys micronutrient rules on the nutrient", () => {
    const iron = rule({ id: "fe", ruleType: "MICRONUTRIENT_INTAKE", nutrientCode: "IRON" });
    const calcium = rule({ id: "ca", ruleType: "MICRONUTRIENT_INTAKE", nutrientCode: "CALCIUM" });

    const result = resolveRule(
      [iron, calcium],
      { ruleType: "MICRONUTRIENT_INTAKE", nutrientCode: "CALCIUM" },
      inputs(),
    );
    expect(result.matched && result.rule.id).toBe("ca");
  });

  it("never selects a Tolerable Upper Limit as a target", () => {
    /*
     * A UL is a safety ceiling, not something to aim for. Iron's UL is 45 mg
     * against an RDA of 19; presenting the UL as a target inverts its meaning.
     */
    const ul = rule({ id: "ul", valueType: "UL", value: "45" });

    const onlyUl = resolveRule([ul], { ruleType: "PROTEIN_PER_KG" }, inputs());
    expect(onlyUl).toEqual({ matched: false, reason: "NO_APPLICABLE_POPULATION" });

    const withRda = resolveRule(
      [ul, rule({ id: "rda", valueType: "RDA", value: "19" })],
      { ruleType: "PROTEIN_PER_KG" },
      inputs(),
    );
    expect(withRda.matched && withRda.rule.value).toBe("19");
  });

  it("prefers the RDA over the EAR", () => {
    const ear = rule({ id: "ear", valueType: "EAR", value: "11" });
    const rda = rule({ id: "rda", valueType: "RDA", value: "19" });

    const forward = resolveRule([ear, rda], { ruleType: "PROTEIN_PER_KG" }, inputs());
    const reversed = resolveRule([rda, ear], { ruleType: "PROTEIN_PER_KG" }, inputs());

    expect(forward.matched && forward.rule.valueType).toBe("RDA");
    expect(reversed.matched && reversed.rule.valueType).toBe("RDA");
  });

  it("falls back to the EAR when no RDA exists", () => {
    const result = resolveRule(
      [rule({ id: "ear", valueType: "EAR", value: "11" })],
      { ruleType: "PROTEIN_PER_KG" },
      inputs(),
    );
    expect(result.matched && result.rule.valueType).toBe("EAR");
  });

  it("is deterministic when two rules are equally specific", () => {
    const a = rule({ id: "aaa" });
    const b = rule({ id: "bbb" });

    const forward = resolveRule([a, b], { ruleType: "PROTEIN_PER_KG" }, inputs());
    const reversed = resolveRule([b, a], { ruleType: "PROTEIN_PER_KG" }, inputs());

    expect(forward.matched && forward.rule.id).toBe("aaa");
    expect(reversed.matched && reversed.rule.id).toBe("aaa");
  });

  it("maps only female and male onto reference populations", () => {
    expect(referenceSexFor("FEMALE")).toBe("FEMALE");
    expect(referenceSexFor("MALE")).toBe("MALE");
    expect(referenceSexFor("OTHER")).toBeNull();
    expect(referenceSexFor("UNDISCLOSED")).toBeNull();
    expect(referenceSexFor(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The profile with no licensed references — the current state of the repo
// ---------------------------------------------------------------------------

describe("target profile with no reference data", () => {
  const profile = buildTargetProfile(inputs(), [], []);

  it("still calculates resting energy", () => {
    expect(pointValue(profile.basalMetabolicRate)).toBe("1617.5");
  });

  it.each([
    ["energyExpenditure"],
    ["energy"],
    ["protein"],
    ["fat"],
    ["carbohydrate"],
    ["fibre"],
  ] as const)("reports %s as unavailable rather than guessing", (key) => {
    const target = profile[key] as Target;
    expect(target.status).toBe("UNAVAILABLE");
  });

  it("names the reference that would supply the missing step", () => {
    const expenditure = profile.energyExpenditure;
    expect(expenditure.status).toBe("UNAVAILABLE");
    if (expenditure.status !== "UNAVAILABLE") return;

    expect(expenditure.reason).toBe("REFERENCE_REQUIRED");
    expect(expenditure.requiredReference?.ruleType).toBe("ACTIVITY_FACTOR");
    expect(expenditure.requiredReference?.suggestedSource).toContain("ICMR-NIN");
  });

  it("marks downstream targets as depending on an unavailable step", () => {
    const carbohydrate = profile.carbohydrate;
    expect(carbohydrate.status).toBe("UNAVAILABLE");
    if (carbohydrate.status !== "UNAVAILABLE") return;
    expect(carbohydrate.reason).toBe("DEPENDS_ON_UNAVAILABLE");
  });

  it("warns that no reference data is licensed", () => {
    expect(profile.warnings.map((w) => w.code)).toContain("NO_REFERENCE_DATA");
  });

  it("carries the population caveat for the equation it did use", () => {
    expect(profile.warnings.map((w) => w.code)).toContain("METHOD_POPULATION_CAVEAT");
  });

  it("produces no number anywhere without a reference behind it", () => {
    const targets: Target[] = [
      profile.basalMetabolicRate,
      profile.energyExpenditure,
      profile.energy,
      profile.protein,
      profile.fat,
      profile.carbohydrate,
      profile.fibre,
    ];

    for (const target of targets) {
      if (target.status !== "CALCULATED") continue;
      expect(target.references.length).toBeGreaterThan(0);
    }
  });

  it("never represents an unavailable target as zero", () => {
    const serialised = JSON.stringify(profile);
    // No unavailable branch may carry a numeric value field at all.
    for (const target of [profile.protein, profile.fat, profile.fibre]) {
      expect(target).not.toHaveProperty("value");
      expect(target).not.toHaveProperty("min");
    }
    expect(serialised).not.toContain('"value":0');
    expect(serialised).not.toContain('"value":"0"');
  });
});

// ---------------------------------------------------------------------------
// The profile once references exist — synthetic rules, proving the pipeline
// ---------------------------------------------------------------------------

describe("target profile with synthetic references", () => {
  /*
   * These values are INVENTED FOR TESTING and are not clinical guidance. They
   * exist to prove the arithmetic wires up, and are deliberately round and
   * implausible so they can never be mistaken for a published recommendation.
   */
  const syntheticRules: ReferenceRuleData[] = [
    rule({
      id: "activity",
      ruleType: "ACTIVITY_FACTOR",
      ruleKey: "MODERATELY_ACTIVE",
      valueType: "FACTOR",
      value: "2",
      unit: "FACTOR",
    }),
    rule({
      id: "goal",
      ruleType: "GOAL_ENERGY_ADJUSTMENT",
      ruleKey: "WEIGHT_LOSS",
      valueType: "FACTOR",
      value: "-235",
      unit: "KCAL_PER_DAY",
    }),
    rule({ id: "protein", ruleType: "PROTEIN_PER_KG", value: "1", unit: "G_PER_KG_PER_DAY" }),
    rule({
      id: "fat",
      ruleType: "FAT_ENERGY_PERCENT",
      valueType: "RDA",
      value: "30",
      unit: "PERCENT_OF_ENERGY",
    }),
    rule({
      id: "fibre",
      ruleType: "FIBRE_INTAKE",
      valueType: "AI",
      value: "30",
      unit: "G_PER_DAY",
    }),
    rule({
      id: "iron",
      ruleType: "MICRONUTRIENT_INTAKE",
      nutrientCode: "IRON",
      valueType: "RDA",
      value: "19",
      unit: "MG_PER_DAY",
    }),
  ];

  const profile = buildTargetProfile(inputs(), syntheticRules, [
    { code: "IRON", name: "Iron" },
    { code: "VITAMIN_B12", name: "Vitamin B12" },
  ]);

  it("multiplies BMR by the activity factor", () => {
    // 1617.5 × 2 = 3235
    expect(pointValue(profile.energyExpenditure)).toBe("3235");
  });

  it("applies a kcal goal adjustment", () => {
    // 3235 − 235 = 3000
    expect(pointValue(profile.energy)).toBe("3000");
  });

  it("multiplies body weight by the per-kilogram rule", () => {
    // 70 kg × 1 g/kg = 70 g
    expect(pointValue(profile.protein)).toBe("70");
  });

  it("derives fat grams from a percentage of energy", () => {
    // 3000 kcal × 30% = 900 kcal; 900 / 9 = 100 g
    expect(pointValue(profile.fat)).toBe("100");
  });

  it("derives carbohydrate from the remaining energy", () => {
    // 3000 − (70×4) − (100×9) = 3000 − 280 − 900 = 1820 kcal; /4 = 455 g
    expect(pointValue(profile.carbohydrate)).toBe("455");
  });

  it("takes fibre directly from the reference", () => {
    expect(pointValue(profile.fibre)).toBe("30");
  });

  it("preserves the semantic value type rather than relabelling it", () => {
    expect(profile.fibre.status === "CALCULATED" && profile.fibre.valueType).toBe("AI");
    expect(profile.fat.status === "CALCULATED" && profile.fat.valueType).toBe("RDA");
  });

  it("reports a micronutrient with a rule and one without", () => {
    const iron = profile.micronutrients.find((entry) => entry.code === "IRON");
    const b12 = profile.micronutrients.find((entry) => entry.code === "VITAMIN_B12");

    expect(pointValue(iron!.target)).toBe("19");
    expect(b12!.target.status).toBe("UNAVAILABLE");
    // B12 has no value at all — not zero.
    expect(b12!.target).not.toHaveProperty("value");
  });

  it("attaches the dataset provenance to every calculated target", () => {
    const protein = profile.protein;
    expect(protein.status).toBe("CALCULATED");
    if (protein.status !== "CALCULATED") return;

    expect(protein.references).toContainEqual(
      expect.objectContaining({ kind: "DATASET", sourceCode: "TEST_SOURCE", ruleId: "protein" }),
    );
  });

  it("keeps the derivation explainable end to end", () => {
    const energy = profile.energy;
    if (energy.status !== "CALCULATED") throw new Error("expected a value");

    const labels = energy.explanation.map((step) => step.label);
    expect(labels).toContain("Resting energy");
    expect(labels).toContain("Total energy expenditure");
    expect(labels).toContain("Goal adjustment");
  });

  it("supports a published range without collapsing it to a midpoint", () => {
    const withRange = buildTargetProfile(
      inputs(),
      [
        ...syntheticRules.filter((entry) => entry.id !== "fibre"),
        rule({
          id: "fibre-range",
          ruleType: "FIBRE_INTAKE",
          valueType: "RANGE",
          value: null,
          valueMin: "25",
          valueMax: "35",
          unit: "G_PER_DAY",
        }),
      ],
      [],
    );

    const fibre = withRange.fibre;
    expect(fibre.status).toBe("CALCULATED");
    if (fibre.status !== "CALCULATED" || fibre.kind !== "RANGE") {
      throw new Error("expected a range");
    }

    expect(fibre.min).toBe("25");
    expect(fibre.max).toBe("35");
    expect(fibre).not.toHaveProperty("value");
  });

  it("keeps decimal precision where floating point would lose it", () => {
    // 70 kg × 0.83 g/kg = 58.1 exactly. In binary floating point the product is
    // 58.099999999999994, which would surface as a target of "58.10" only by
    // luck of rounding — and as 58.099999999999994 in any exported figure.
    const protein = buildTargetProfile(
      inputs(),
      [rule({ id: "p", ruleType: "PROTEIN_PER_KG", value: "0.83" })],
      [],
    );

    expect(pointValue(protein.protein)).toBe("58.1");
    expect(70 * 0.83).not.toBe(58.1);

    // And through the energy chain: 1617.5 × 1.63 = 2636.525, not 2636.5249999999996
    const energy = buildTargetProfile(
      inputs(),
      [
        rule({
          id: "a",
          ruleType: "ACTIVITY_FACTOR",
          ruleKey: "MODERATELY_ACTIVE",
          valueType: "FACTOR",
          value: "1.63",
          unit: "FACTOR",
        }),
      ],
      [],
    );

    expect(pointValue(energy.energyExpenditure)).toBe("2636.525");
    expect(1617.5 * 1.63).not.toBe(2636.525);
  });

  it("is deterministic", () => {
    const runs = Array.from({ length: 10 }, () =>
      JSON.stringify(buildTargetProfile(inputs(), syntheticRules, [{ code: "IRON", name: "Iron" }])),
    );
    expect(new Set(runs).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Clinical safety
// ---------------------------------------------------------------------------

describe("clinical safety", () => {
  it("produces no targets at all for an unsupported population", () => {
    const profile = buildTargetProfile(inputs({ gender: "OTHER" }), [], []);

    expect(profile.basalMetabolicRate.status).toBe("UNAVAILABLE");
    expect(profile.energy.status).toBe("UNAVAILABLE");
    expect(profile.warnings.map((w) => w.code)).toContain("SEX_NOT_MAPPABLE");
  });

  it("never emits a disease-specific rule type", () => {
    // No clinical-condition rule exists, and none may appear by accident.
    const profile = buildTargetProfile(inputs(), [], []);
    const serialised = JSON.stringify(profile);

    for (const term of ["diabet", "PCOS", "renal", "kidney", "thyroid", "pregnan"]) {
      expect(serialised.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it("never presents an unlicensed source as approved", () => {
    const profile = buildTargetProfile(
      inputs(),
      [rule({ id: "p", ruleType: "PROTEIN_PER_KG", value: "1" })],
      [],
    );

    const protein = profile.protein;
    if (protein.status !== "CALCULATED") throw new Error("expected a value");

    const dataset = protein.references.find((ref) => ref.kind === "DATASET");
    expect(dataset).toBeDefined();
    if (dataset?.kind !== "DATASET") return;
    expect(dataset.permissionStatus).toBe("DEVELOPMENT_ONLY");
    expect(dataset.permissionStatus).not.toBe("APPROVED");
  });

  it("refuses a goal adjustment that would drive energy to zero", () => {
    const profile = buildTargetProfile(inputs(), [
      rule({
        id: "activity",
        ruleType: "ACTIVITY_FACTOR",
        ruleKey: "MODERATELY_ACTIVE",
        valueType: "FACTOR",
        value: "1",
        unit: "FACTOR",
      }),
      rule({
        id: "goal",
        ruleType: "GOAL_ENERGY_ADJUSTMENT",
        ruleKey: "WEIGHT_LOSS",
        valueType: "FACTOR",
        value: "-5000",
        unit: "KCAL_PER_DAY",
      }),
    ], []);

    expect(profile.energy.status).toBe("UNAVAILABLE");
    if (profile.energy.status !== "UNAVAILABLE") return;
    expect(profile.energy.reason).toBe("INPUT_INVALID");
  });

  it("refuses carbohydrate when protein and fat already consume the energy", () => {
    const profile = buildTargetProfile(inputs(), [
      rule({ id: "a", ruleType: "ACTIVITY_FACTOR", ruleKey: "MODERATELY_ACTIVE", valueType: "FACTOR", value: "1", unit: "FACTOR" }),
      rule({ id: "g", ruleType: "GOAL_ENERGY_ADJUSTMENT", ruleKey: "WEIGHT_LOSS", valueType: "FACTOR", value: "0", unit: "KCAL_PER_DAY" }),
      rule({ id: "p", ruleType: "PROTEIN_PER_KG", value: "5", unit: "G_PER_KG_PER_DAY" }),
      rule({ id: "f", ruleType: "FAT_ENERGY_PERCENT", valueType: "RDA", value: "90", unit: "PERCENT_OF_ENERGY" }),
    ], []);

    expect(profile.carbohydrate.status).toBe("UNAVAILABLE");
    if (profile.carbohydrate.status !== "UNAVAILABLE") return;
    expect(profile.carbohydrate.reason).toBe("INPUT_INVALID");
  });

  it("collects a warning for every input it could not use", () => {
    const profile = buildTargetProfile(
      {
        ageYears: null,
        gender: null,
        heightCm: null,
        weightKg: null,
        activityLevel: null,
        primaryGoal: null,
        physiologicalState: "NONE",
      },
      [],
      [],
    );

    const codes = profile.warnings.map((warning) => warning.code);
    expect(codes).toContain("AGE_NOT_RECORDED");
    expect(codes).toContain("SEX_NOT_RECORDED");
    expect(codes).toContain("HEIGHT_NOT_RECORDED");
    expect(codes).toContain("WEIGHT_NOT_RECORDED");
    expect(codes).toContain("ACTIVITY_NOT_RECORDED");
    expect(codes).toContain("GOAL_NOT_RECORDED");
  });
});
