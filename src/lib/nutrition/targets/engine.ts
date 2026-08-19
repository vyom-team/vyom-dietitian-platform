/**
 * The target pipeline.
 *
 *     BMR ──× activity factor──> expenditure ──± goal adjustment──> energy
 *                                                     │
 *                          ┌──────────────────────────┼──────────────┐
 *                          ▼                          ▼              ▼
 *                     protein (g/kg)            fat (% energy)   fibre (direct)
 *                          └──────────────┬───────────┘
 *                                         ▼
 *                            carbohydrate (remaining energy)
 *
 * Every stage after BMR is gated on a licensed reference rule. None of those
 * rules exists in this repository today, so every stage after BMR reports
 * REFERENCE_REQUIRED and names what would supply it. The pipeline is written in
 * full so that importing ICMR-NIN values makes it work without touching this
 * file — a reference is data, not code.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No default activity factor. No assumed protein figure. No "typical" macro
 * split. No WHO fallback. A target with no reference behind it is not produced.
 *
 * Pure. No database, no I/O, no clock.
 */

import { Prisma } from "@/generated/prisma/browser";

import type { ReferenceRuleType } from "@/generated/prisma/enums";

import { calculateBmr } from "./bmr";
import { resolveRule, referenceSexFor, type RuleResolution } from "./resolve";
import {
  unavailable,
  type MicronutrientTarget,
  type ReferenceRuleData,
  type Target,
  type TargetInputs,
  type TargetProfile,
  type TargetReference,
  type TargetWarning,
} from "./types";

const Decimal = Prisma.Decimal;

/**
 * The publication that would supply each missing rule.
 *
 * Named so an unavailable target says what to go and license, rather than
 * leaving a practitioner or a future developer to guess which document is
 * missing.
 */
const SUGGESTED_SOURCE: Record<ReferenceRuleType, string> = {
  BMR_EQUATION: "ICMR-NIN resting-energy methodology",
  ACTIVITY_FACTOR: "ICMR-NIN RDA/EAR 2020",
  GOAL_ENERGY_ADJUSTMENT: "Vyom clinical specification (PRD)",
  PROTEIN_PER_KG: "ICMR-NIN RDA/EAR 2020",
  FAT_ENERGY_PERCENT: "ICMR-NIN RDA/EAR 2020",
  CARBOHYDRATE_ENERGY_PERCENT: "ICMR-NIN RDA/EAR 2020",
  FIBRE_INTAKE: "ICMR-NIN RDA/EAR 2020",
  MICRONUTRIENT_INTAKE: "ICMR-NIN RDA/EAR 2020",
};

/**
 * Energy per gram of macronutrient — the Atwater general factors.
 *
 * Used only to convert an energy allocation that a reference has already
 * defined. They never *create* an allocation: without a licensed fat-percentage
 * rule there is nothing to convert, which is why fat and carbohydrate remain
 * unavailable regardless of these constants.
 */
const KCAL_PER_GRAM = { protein: "4", fat: "9", carbohydrate: "4" } as const;
const ATWATER: TargetReference = {
  kind: "PUBLICATION",
  citation:
    "Atwater general factors, as used throughout food-energy conversion: " +
    "protein 4 kcal/g, fat 9 kcal/g, carbohydrate 4 kcal/g.",
  method: "Atwater general factors",
};

/**
 * Builds the complete target profile for one client.
 *
 * @param inputs the person, already flattened — age in years, no clock
 * @param rules every reference rule the service could load, unfiltered
 * @param nutrientDictionary codes and names to report micronutrient targets for
 */
export function buildTargetProfile(
  inputs: TargetInputs,
  rules: readonly ReferenceRuleData[],
  nutrientDictionary: readonly { code: string; name: string }[],
): TargetProfile {
  const warnings: TargetWarning[] = [];
  const methodology: string[] = [];

  collectInputWarnings(inputs, warnings);

  if (rules.length === 0) {
    warnings.push({
      code: "NO_REFERENCE_DATA",
      message:
        "No clinical reference values have been licensed and imported. Targets that depend on a published requirement cannot be calculated.",
    });
  }

  // --- Resting energy -------------------------------------------------------

  const basalMetabolicRate = calculateBmr(inputs);

  if (basalMetabolicRate.status === "CALCULATED") {
    methodology.push("Resting energy from the Mifflin-St Jeor equation.");
    warnings.push({
      code: "METHOD_POPULATION_CAVEAT",
      message:
        "Resting energy uses Mifflin-St Jeor, derived on a US population. No Indian-population equation has been acquired.",
    });
  }

  // --- Total expenditure ----------------------------------------------------

  const energyExpenditure = applyFactor(
    basalMetabolicRate,
    resolveRule(rules, { ruleType: "ACTIVITY_FACTOR", ruleKey: inputs.activityLevel }, inputs),
    "ACTIVITY_FACTOR",
    "Total energy expenditure",
    inputs.activityLevel === null
      ? "No activity level is recorded on the assessment."
      : undefined,
  );

  // --- Energy target --------------------------------------------------------

  const energy = applyAdjustment(
    energyExpenditure,
    resolveRule(
      rules,
      { ruleType: "GOAL_ENERGY_ADJUSTMENT", ruleKey: inputs.primaryGoal },
      inputs,
    ),
    "GOAL_ENERGY_ADJUSTMENT",
    inputs.primaryGoal === null ? "No goal is recorded on the assessment." : undefined,
  );

  // --- Protein --------------------------------------------------------------

  const protein = perKilogramTarget(
    inputs,
    resolveRule(rules, { ruleType: "PROTEIN_PER_KG" }, inputs),
    "PROTEIN_PER_KG",
  );

  // --- Fat ------------------------------------------------------------------

  const fat = energyShareTarget(
    energy,
    resolveRule(rules, { ruleType: "FAT_ENERGY_PERCENT" }, inputs),
    "FAT_ENERGY_PERCENT",
    KCAL_PER_GRAM.fat,
    "Fat",
  );

  // --- Carbohydrate ---------------------------------------------------------

  const carbohydrate = remainingEnergyTarget(energy, protein, fat);

  // --- Fibre ----------------------------------------------------------------

  const fibre = directTarget(
    resolveRule(rules, { ruleType: "FIBRE_INTAKE" }, inputs),
    "FIBRE_INTAKE",
    "Fibre",
  );

  // --- Micronutrients -------------------------------------------------------

  const micronutrients: MicronutrientTarget[] = nutrientDictionary.map((nutrient) => ({
    code: nutrient.code,
    name: nutrient.name,
    target: directTarget(
      resolveRule(
        rules,
        { ruleType: "MICRONUTRIENT_INTAKE", nutrientCode: nutrient.code },
        inputs,
      ),
      "MICRONUTRIENT_INTAKE",
      nutrient.name,
    ),
  }));

  const profile: TargetProfile = {
    inputs,
    basalMetabolicRate,
    energyExpenditure,
    energy,
    protein,
    fat,
    carbohydrate,
    fibre,
    micronutrients,
    warnings,
    references: [],
    methodology,
  };

  profile.references = distinctReferences(profile);

  if (
    referenceSexFor(inputs.gender) === null &&
    inputs.gender !== null &&
    !warnings.some((warning) => warning.code === "SEX_NOT_MAPPABLE")
  ) {
    warnings.push({
      code: "SEX_NOT_MAPPABLE",
      message:
        "Reference tables publish values for female and male populations. This client's recorded sex does not map onto one, so sex-specific references cannot be applied.",
    });
  }

  return profile;
}

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

/** BMR × activity factor. */
function applyFactor(
  base: Target,
  resolution: RuleResolution,
  ruleType: ReferenceRuleType,
  label: string,
  inputNote?: string,
): Target {
  if (base.status !== "CALCULATED") {
    return unavailable(
      "DEPENDS_ON_UNAVAILABLE",
      "Resting energy could not be estimated, so total expenditure cannot be either.",
    );
  }

  const rule = requireRule(resolution, ruleType, inputNote);
  if ("status" in rule) return rule;

  if (rule.value === null) {
    return unavailable("REFERENCE_REQUIRED", "The reference rule carries no usable value.", {
      ruleType,
      suggestedSource: SUGGESTED_SOURCE[ruleType],
    });
  }

  const factor = new Decimal(rule.value);
  const result = new Decimal(base.kind === "POINT" ? base.value : base.min).mul(factor);

  return {
    status: "CALCULATED",
    kind: "POINT",
    value: result.toString(),
    unit: "KCAL_PER_DAY",
    valueType: rule.valueType,
    explanation: [
      ...(base.kind === "POINT" ? base.explanation : []),
      {
        label,
        detail: `${base.kind === "POINT" ? base.value : base.min} kcal × ${factor.toString()}`,
        value: result.toString(),
        unit: "kcal/day",
      },
    ],
    references: [...base.references, datasetReference(rule)],
  };
}

/** Expenditure ± goal adjustment. */
function applyAdjustment(
  base: Target,
  resolution: RuleResolution,
  ruleType: ReferenceRuleType,
  inputNote?: string,
): Target {
  if (base.status !== "CALCULATED") {
    return unavailable(
      "DEPENDS_ON_UNAVAILABLE",
      "Total energy expenditure is unavailable, so an energy target cannot be set.",
    );
  }

  const rule = requireRule(resolution, ruleType, inputNote);
  if ("status" in rule) return rule;

  if (rule.value === null) {
    return unavailable("REFERENCE_REQUIRED", "The reference rule carries no usable value.", {
      ruleType,
      suggestedSource: SUGGESTED_SOURCE[ruleType],
    });
  }

  const baseValue = new Decimal(base.kind === "POINT" ? base.value : base.min);
  const adjustment = new Decimal(rule.value);

  /*
   * A percentage adjustment scales; a kcal adjustment adds. The unit on the
   * rule decides, so a reference can express either without a code change.
   */
  const result =
    rule.unit === "PERCENT_OF_ENERGY"
      ? baseValue.mul(new Decimal(100).plus(adjustment)).div(100)
      : baseValue.plus(adjustment);

  if (result.lessThanOrEqualTo(0)) {
    return unavailable(
      "INPUT_INVALID",
      "The goal adjustment produces a non-positive energy target.",
    );
  }

  return {
    status: "CALCULATED",
    kind: "POINT",
    value: result.toString(),
    unit: "KCAL_PER_DAY",
    valueType: rule.valueType,
    explanation: [
      ...base.explanation,
      {
        label: "Goal adjustment",
        detail:
          rule.unit === "PERCENT_OF_ENERGY"
            ? `${baseValue} kcal ${adjustment.isNegative() ? "−" : "+"} ${adjustment.abs()}%`
            : `${baseValue} kcal ${adjustment.isNegative() ? "−" : "+"} ${adjustment.abs()} kcal`,
        value: result.toString(),
        unit: "kcal/day",
      },
    ],
    references: [...base.references, datasetReference(rule)],
  };
}

/** Body weight × g/kg. */
function perKilogramTarget(
  inputs: TargetInputs,
  resolution: RuleResolution,
  ruleType: ReferenceRuleType,
): Target {
  const rule = requireRule(resolution, ruleType);
  if ("status" in rule) return rule;

  if (inputs.weightKg === null) {
    return unavailable(
      "INPUT_MISSING",
      "A weight is needed to apply a per-kilogram reference.",
    );
  }

  if (rule.value === null) {
    return unavailable("REFERENCE_REQUIRED", "The reference rule carries no usable value.", {
      ruleType,
      suggestedSource: SUGGESTED_SOURCE[ruleType],
    });
  }

  const weight = new Decimal(inputs.weightKg);
  const perKg = new Decimal(rule.value);
  const result = weight.mul(perKg);

  return {
    status: "CALCULATED",
    kind: "POINT",
    value: result.toString(),
    unit: "G_PER_DAY",
    valueType: rule.valueType,
    explanation: [
      {
        label: "Protein",
        detail: `${weight.toString()} kg × ${perKg.toString()} g/kg`,
        value: result.toString(),
        unit: "g/day",
      },
    ],
    references: [datasetReference(rule)],
  };
}

/** A percentage of the energy target, converted to grams. */
function energyShareTarget(
  energy: Target,
  resolution: RuleResolution,
  ruleType: ReferenceRuleType,
  kcalPerGram: string,
  label: string,
): Target {
  const rule = requireRule(resolution, ruleType);
  if ("status" in rule) return rule;

  if (energy.status !== "CALCULATED") {
    return unavailable(
      "DEPENDS_ON_UNAVAILABLE",
      `An energy target is needed before ${label.toLowerCase()} can be derived from it.`,
    );
  }

  const energyValue = new Decimal(energy.kind === "POINT" ? energy.value : energy.min);
  const perGram = new Decimal(kcalPerGram);

  // A published range stays a range: a midpoint would invent precision.
  if (rule.valueType === "RANGE" && rule.valueMin !== null && rule.valueMax !== null) {
    const min = energyValue.mul(new Decimal(rule.valueMin)).div(100).div(perGram);
    const max = energyValue.mul(new Decimal(rule.valueMax)).div(100).div(perGram);

    return {
      status: "CALCULATED",
      kind: "RANGE",
      min: min.toString(),
      max: max.toString(),
      unit: "G_PER_DAY",
      valueType: "RANGE",
      explanation: [
        {
          label,
          detail: `${energyValue} kcal × ${rule.valueMin}–${rule.valueMax}% ÷ ${kcalPerGram} kcal/g`,
          value: `${min}–${max}`,
          unit: "g/day",
        },
      ],
      references: [datasetReference(rule), ATWATER],
    };
  }

  if (rule.value === null) {
    return unavailable("REFERENCE_REQUIRED", "The reference rule carries no usable value.", {
      ruleType,
      suggestedSource: SUGGESTED_SOURCE[ruleType],
    });
  }

  const percent = new Decimal(rule.value);
  const result = energyValue.mul(percent).div(100).div(perGram);

  return {
    status: "CALCULATED",
    kind: "POINT",
    value: result.toString(),
    unit: "G_PER_DAY",
    valueType: rule.valueType,
    explanation: [
      {
        label,
        detail: `${energyValue} kcal × ${percent}% ÷ ${kcalPerGram} kcal/g`,
        value: result.toString(),
        unit: "g/day",
      },
    ],
    references: [datasetReference(rule), ATWATER],
  };
}

/**
 * Carbohydrate as the energy left over.
 *
 * Requires a point value for both protein and fat. A range for either leaves
 * the remainder a range too, and representing that correctly is a decision for
 * the phase that has the references — until then it is unavailable rather than
 * silently resolved to one end of the band.
 */
function remainingEnergyTarget(energy: Target, protein: Target, fat: Target): Target {
  if (energy.status !== "CALCULATED") {
    return unavailable(
      "DEPENDS_ON_UNAVAILABLE",
      "An energy target is needed before carbohydrate can be derived as the remainder.",
    );
  }

  if (protein.status !== "CALCULATED" || fat.status !== "CALCULATED") {
    return unavailable(
      "DEPENDS_ON_UNAVAILABLE",
      "Protein and fat targets are needed before carbohydrate can be derived as the remainder.",
    );
  }

  if (protein.kind !== "POINT" || fat.kind !== "POINT" || energy.kind !== "POINT") {
    return unavailable(
      "DEPENDS_ON_UNAVAILABLE",
      "Carbohydrate is derived from single protein and fat figures. One of them is a published range, and how to allocate the remainder across a range needs a reference that states it.",
    );
  }

  const energyKcal = new Decimal(energy.value);
  const proteinKcal = new Decimal(protein.value).mul(KCAL_PER_GRAM.protein);
  const fatKcal = new Decimal(fat.value).mul(KCAL_PER_GRAM.fat);
  const remaining = energyKcal.minus(proteinKcal).minus(fatKcal);

  if (remaining.lessThanOrEqualTo(0)) {
    return unavailable(
      "INPUT_INVALID",
      "Protein and fat already account for the whole energy target, leaving nothing for carbohydrate.",
    );
  }

  const grams = remaining.div(KCAL_PER_GRAM.carbohydrate);

  return {
    status: "CALCULATED",
    kind: "POINT",
    value: grams.toString(),
    unit: "G_PER_DAY",
    // Carbohydrate inherits protein's semantic label: it is the remainder of an
    // allocation that reference defined, not a requirement stated in its own right.
    valueType: protein.valueType,
    explanation: [
      {
        label: "Energy left for carbohydrate",
        detail: `${energyKcal} kcal − ${proteinKcal} kcal protein − ${fatKcal} kcal fat`,
        value: remaining.toString(),
        unit: "kcal/day",
      },
      {
        label: "Carbohydrate",
        detail: `${remaining} kcal ÷ ${KCAL_PER_GRAM.carbohydrate} kcal/g`,
        value: grams.toString(),
        unit: "g/day",
      },
    ],
    references: [...protein.references, ...fat.references, ATWATER],
  };
}

/** A reference value used as-is, with no arithmetic — fibre, micronutrients. */
function directTarget(
  resolution: RuleResolution,
  ruleType: ReferenceRuleType,
  label: string,
): Target {
  const rule = requireRule(resolution, ruleType);
  if ("status" in rule) return rule;

  if (rule.valueType === "RANGE" && rule.valueMin !== null && rule.valueMax !== null) {
    return {
      status: "CALCULATED",
      kind: "RANGE",
      min: rule.valueMin,
      max: rule.valueMax,
      unit: rule.unit,
      valueType: "RANGE",
      explanation: [
        { label, detail: "Stated directly by the reference", value: `${rule.valueMin}–${rule.valueMax}` },
      ],
      references: [datasetReference(rule)],
    };
  }

  if (rule.value === null) {
    return unavailable("REFERENCE_REQUIRED", "The reference rule carries no usable value.", {
      ruleType,
      suggestedSource: SUGGESTED_SOURCE[ruleType],
    });
  }

  return {
    status: "CALCULATED",
    kind: "POINT",
    value: rule.value,
    unit: rule.unit,
    valueType: rule.valueType,
    explanation: [{ label, detail: "Stated directly by the reference", value: rule.value }],
    references: [datasetReference(rule)],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Turns a resolution into either a usable rule or the unavailable target that
 * explains its absence.
 *
 * The two failure modes are kept apart deliberately: "we hold no rules of this
 * kind" is a licensing gap, while "we hold rules but none covers this person"
 * is a coverage gap. They need different actions.
 */
function requireRule(
  resolution: RuleResolution,
  ruleType: ReferenceRuleType,
  inputNote?: string,
): ReferenceRuleData | Target {
  if (resolution.matched) return resolution.rule;

  if (resolution.reason === "NO_RULES_OF_TYPE") {
    return unavailable(
      "REFERENCE_REQUIRED",
      inputNote
        ? `${inputNote} No licensed reference value is available for this step either.`
        : "No licensed reference value is available for this step.",
      { ruleType, suggestedSource: SUGGESTED_SOURCE[ruleType] },
    );
  }

  return unavailable(
    "POPULATION_UNSUPPORTED",
    "Reference values exist, but none covers this client's age, sex, or physiological state.",
  );
}

function datasetReference(rule: ReferenceRuleData): TargetReference {
  return {
    kind: "DATASET",
    sourceCode: rule.source.code,
    sourceName: rule.source.name,
    version: rule.source.version,
    permissionStatus: rule.source.permissionStatus,
    ruleId: rule.id,
  };
}

function collectInputWarnings(inputs: TargetInputs, warnings: TargetWarning[]): void {
  if (inputs.ageYears === null) {
    warnings.push({
      code: "AGE_NOT_RECORDED",
      message: "No date of birth is recorded, so age-specific references cannot be applied.",
    });
  }
  if (inputs.gender === null) {
    warnings.push({
      code: "SEX_NOT_RECORDED",
      message: "No sex is recorded, so sex-specific references cannot be applied.",
    });
  }
  if (inputs.heightCm === null) {
    warnings.push({ code: "HEIGHT_NOT_RECORDED", message: "No height is recorded." });
  }
  if (inputs.weightKg === null) {
    warnings.push({ code: "WEIGHT_NOT_RECORDED", message: "No weight is recorded." });
  }
  if (inputs.activityLevel === null) {
    warnings.push({
      code: "ACTIVITY_NOT_RECORDED",
      message: "No activity level is recorded, so energy expenditure cannot be estimated.",
    });
  }
  if (inputs.primaryGoal === null) {
    warnings.push({
      code: "GOAL_NOT_RECORDED",
      message: "No goal is recorded, so no goal adjustment can be applied.",
    });
  }
}

/** Every distinct reference behind any calculated target, in first-seen order. */
function distinctReferences(profile: TargetProfile): TargetReference[] {
  const targets: Target[] = [
    profile.basalMetabolicRate,
    profile.energyExpenditure,
    profile.energy,
    profile.protein,
    profile.fat,
    profile.carbohydrate,
    profile.fibre,
    ...profile.micronutrients.map((entry) => entry.target),
  ];

  const seen = new Set<string>();
  const references: TargetReference[] = [];

  for (const target of targets) {
    if (target.status !== "CALCULATED") continue;

    for (const reference of target.references) {
      const key =
        reference.kind === "PUBLICATION"
          ? `pub:${reference.method}`
          : `data:${reference.sourceCode}@${reference.version}`;

      if (seen.has(key)) continue;
      seen.add(key);
      references.push(reference);
    }
  }

  return references;
}

export { ATWATER };
