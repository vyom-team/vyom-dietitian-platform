/**
 * The nutrition target domain.
 *
 * Phase 8C answers "what is in this food". This answers "how much does this
 * client need" — a different question with a different evidence base, and one
 * that must never be answered by guessing.
 *
 * THE CENTRAL RULE
 *
 * A target is either **calculated from a cited reference** or it is
 * **unavailable, with the missing reference named**. There is no third state.
 * No default, no international fallback, no "reasonable" figure. A dietitian
 * reading a number here must be able to trace it to a publication, and a number
 * that cannot be traced must not appear.
 *
 * Most targets are unavailable today, and that is the honest state of this
 * repository rather than an unfinished feature: ICMR-NIN RDA/EAR 2020 is
 * registered as a source, is marked PERMISSION_REQUIRED, and has not been
 * acquired. See docs/nutrition-targets.md.
 *
 * Pure vocabulary. No database, no I/O, no clock.
 */

import type {
  ActivityLevel,
  ClientGender,
  PhysiologicalState,
  PrimaryGoal,
  ReferenceRuleType,
  ReferenceUnit,
  ReferenceValueType,
  SexApplicability,
} from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Everything the engine needs about a person, as plain data.
 *
 * Age arrives as a **number of years already computed**. The pure engine never
 * reads a clock: a function whose output depends on today's date cannot be
 * tested deterministically, and a target calculated at midnight must not differ
 * from one calculated a second later.
 *
 * Every field is nullable because every one of them genuinely can be. A
 * completed assessment guarantees only height and weight; age and sex live on
 * the Client and are optional there.
 */
export type TargetInputs = {
  /** Whole years, computed by the caller from date of birth. */
  ageYears: number | null;
  /** As recorded on the client record, not mapped to a reference population. */
  gender: ClientGender | null;
  /** Centimetres, as a decimal string. */
  heightCm: string | null;
  /** Kilograms, as a decimal string. */
  weightKg: string | null;
  activityLevel: ActivityLevel | null;
  primaryGoal: PrimaryGoal | null;
  /**
   * Always NONE today. The assessment model captures no physiological state,
   * and inferring pregnancy from sex or lactation from age is exactly the guess
   * this project forbids. Present so the resolver's shape is already correct
   * when the field is added.
   */
  physiologicalState: PhysiologicalState;
};

/**
 * One reference rule, flattened for the pure engine.
 *
 * Deliberately not a Prisma row: rule resolution and arithmetic must be
 * testable without PostgreSQL.
 */
export type ReferenceRuleData = {
  id: string;
  ruleType: ReferenceRuleType;
  /** Nutrient code for MICRONUTRIENT_INTAKE, null otherwise. */
  nutrientCode: string | null;
  /** Enum value or equation name for every other rule type. */
  ruleKey: string | null;
  sexApplicability: SexApplicability;
  ageMinYears: number | null;
  ageMaxYears: number | null;
  physiologicalState: PhysiologicalState;
  valueType: ReferenceValueType;
  /** Decimal strings. `value` for a point, min/max for a RANGE. */
  value: string | null;
  valueMin: string | null;
  valueMax: string | null;
  unit: ReferenceUnit;
  notes: string | null;
  /** Provenance — required, never null. */
  source: {
    code: string;
    name: string;
    version: string;
    permissionStatus: string;
  };
};

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * What a target's number is traceable to.
 *
 * `EQUATION` targets cite a published method rather than a licensed dataset —
 * an equation with a journal citation is public knowledge, where a table of
 * requirement values is copyrighted data. The two are distinguished so a reader
 * can tell which kind of authority stands behind a figure.
 */
export type TargetReference =
  | {
      kind: "PUBLICATION";
      /** e.g. "Mifflin MD et al., Am J Clin Nutr 1990;51:241-7" */
      citation: string;
      method: string;
      /** Stated plainly where a method was not derived on this population. */
      populationCaveat?: string;
    }
  | {
      kind: "DATASET";
      sourceCode: string;
      sourceName: string;
      version: string;
      /** DEVELOPMENT_ONLY for everything currently registered. */
      permissionStatus: string;
      ruleId: string;
    };

/** One line of the "why this number?" derivation. */
export type ExplanationStep = {
  label: string;
  /** The arithmetic in words, e.g. "10 × 70 + 6.25 × 170 − 5 × 30 + 5". */
  detail: string;
  /** The step's result, unrounded. */
  value?: string;
  unit?: string;
};

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/**
 * Why a target could not be produced.
 *
 * Each is actionable and distinguishable. "We have no licensed reference" and
 * "you did not record a weight" call for completely different responses from a
 * practitioner, and collapsing them into one "unavailable" would hide which.
 */
export type TargetUnavailableReason =
  /** No licensed reference value exists in this repository for this rule. */
  | "REFERENCE_REQUIRED"
  /** A required assessment or client field is not recorded. */
  | "INPUT_MISSING"
  /** A recorded value is outside the plausible range. */
  | "INPUT_INVALID"
  /** References exist, but none applies to this person. */
  | "POPULATION_UNSUPPORTED"
  /** An earlier step in the pipeline was unavailable. */
  | "DEPENDS_ON_UNAVAILABLE";

/**
 * One target: a cited number, or a named absence.
 *
 * A discriminated union rather than a nullable value, so the type system will
 * not let a caller read `value` without first proving there is one. `?? 0` is
 * unrepresentable, which is the point — a missing requirement rendered as zero
 * would read as "this client needs none of it".
 */
type CalculatedCommon = {
  status: "CALCULATED";
  unit: ReferenceUnit;
  /** What the source called it — RDA, EAR, AI, UL. Never relabelled. */
  valueType: ReferenceValueType;
  explanation: ExplanationStep[];
  references: TargetReference[];
};

export type Target =
  /** A single figure. Unrounded decimal string; rounding belongs to the formatter. */
  | (CalculatedCommon & { kind: "POINT"; value: string })
  /**
   * A published range, kept as a range.
   *
   * Where a reference states 20-30% of energy, that *is* the recommendation.
   * Collapsing it to a midpoint would invent a precision the publisher declined
   * to claim, so there is deliberately no `value` field to reach for.
   */
  | (CalculatedCommon & { kind: "RANGE"; min: string; max: string })
  | {
      status: "UNAVAILABLE";
      reason: TargetUnavailableReason;
      /** Safe to display. Says what is missing and what would resolve it. */
      detail: string;
      /** Which reference would supply this, when the reason is REFERENCE_REQUIRED. */
      requiredReference?: {
        ruleType: ReferenceRuleType;
        /** e.g. "ICMR-NIN RDA/EAR 2020" */
        suggestedSource: string;
      };
    };

/** A micronutrient target, keyed by the Phase 8A nutrient dictionary. */
export type MicronutrientTarget = {
  code: string;
  name: string;
  target: Target;
};

/**
 * Something a practitioner should know about the result as a whole.
 *
 * Distinct from an unavailable target: a warning qualifies what *was*
 * calculated, where an unavailable target reports what was not.
 */
export type TargetWarning = {
  code:
    | "AGE_NOT_RECORDED"
    | "SEX_NOT_RECORDED"
    | "SEX_NOT_MAPPABLE"
    | "HEIGHT_NOT_RECORDED"
    | "WEIGHT_NOT_RECORDED"
    | "ACTIVITY_NOT_RECORDED"
    | "GOAL_NOT_RECORDED"
    | "NO_REFERENCE_DATA"
    | "POPULATION_UNSUPPORTED"
    | "METHOD_POPULATION_CAVEAT";
  message: string;
};

/**
 * The complete answer for one client.
 *
 * `basalMetabolicRate` and `energyExpenditure` are exposed as targets in their
 * own right rather than hidden inside the energy derivation. They are what a
 * dietitian checks when a final figure looks wrong, and burying them would make
 * the pipeline unauditable.
 */
export type TargetProfile = {
  inputs: TargetInputs;

  basalMetabolicRate: Target;
  energyExpenditure: Target;
  energy: Target;

  protein: Target;
  fat: Target;
  carbohydrate: Target;
  fibre: Target;

  micronutrients: MicronutrientTarget[];

  warnings: TargetWarning[];
  /** Every distinct reference behind any calculated target. */
  references: TargetReference[];
  /** Plain-language summary of the methodology actually used. */
  methodology: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function unavailable(
  reason: TargetUnavailableReason,
  detail: string,
  requiredReference?: {
    ruleType: ReferenceRuleType;
    suggestedSource: string;
  },
): Target {
  return requiredReference
    ? { status: "UNAVAILABLE", reason, detail, requiredReference }
    : { status: "UNAVAILABLE", reason, detail };
}

/**
 * Physiologically plausible bounds, matching the assessment's own constraints.
 * Shared with `lib/assessments/bmi.ts` values deliberately — a measurement the
 * assessment accepts must not be rejected here, and vice versa.
 */
export const AGE_YEARS_MIN = 0;
export const AGE_YEARS_MAX = 130;
