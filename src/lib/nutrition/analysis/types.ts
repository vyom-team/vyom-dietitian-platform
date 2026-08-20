/**
 * Nutrition analysis — the bridge between what a plan provides and what a
 * client needs.
 *
 * Phase 8C answers "what is in this food". Phase 8D answers "what does this
 * client need". This module answers the question a dietitian actually asks:
 * **"how far off am I, and what is still missing?"**
 *
 * It calculates no nutrient value and no target. Both arrive already computed
 * from their own engines, with their own provenance, and this layer only
 * compares them. That boundary is what keeps a single source of truth for each
 * number.
 *
 * Pure vocabulary. No database, no I/O, no clock.
 */

import type {
  NutrientCategory,
  NutrientUnit,
  ReferenceValueType,
} from "@/generated/prisma/enums";
import type { Completeness } from "@/lib/nutrition/calculate/types";
import type { TargetReference } from "@/lib/nutrition/targets/types";

// ---------------------------------------------------------------------------
// Comparison outcome
// ---------------------------------------------------------------------------

/**
 * The **mathematical** relationship between a planned amount and a target.
 *
 * Emphatically not a clinical judgement. `BELOW_TARGET` does not mean deficient
 * and `ABOVE_TARGET` does not mean excessive — a plan at 97% of a protein
 * target is below it and entirely unremarkable, and exceeding an Adequate
 * Intake is different from exceeding a Tolerable Upper Intake Level. The
 * reference's own `valueType` travels with every comparison so a later rules
 * layer can interpret it; this layer refuses to.
 */
export type ComparisonStatus =
  /** Planned amount is less than the target (or below a range's floor). */
  | "BELOW_TARGET"
  /** Exactly equal, or inside a published range. */
  | "TARGET_MET"
  /** Planned amount exceeds the target (or a range's ceiling). */
  | "ABOVE_TARGET"
  /** Phase 8D has no licensed reference for this nutrient. */
  | "TARGET_UNAVAILABLE"
  /** No food in the plan publishes this nutrient. Never treated as zero. */
  | "DATA_UNAVAILABLE"
  /** Both sides exist but are expressed in units that cannot be compared. */
  | "INCOMPARABLE_UNITS";

/**
 * What a percentage is measured against.
 *
 * A range has no single target to divide by. Reporting a percentage of its
 * floor is meaningful — "you have reached 80% of the minimum" — and reporting a
 * percentage of an invented midpoint is not, so the basis is stated rather than
 * assumed.
 */
export type PercentageBasis = "TARGET" | "RANGE_MINIMUM";

/** One nutrient: what the plan provides, what the client needs, and the gap. */
export type NutrientComparison = {
  code: string;
  name: string;
  category: NutrientCategory;

  status: ComparisonStatus;

  /**
   * The planned amount, unrounded, in `unit`. Absent when no food in the plan
   * publishes this nutrient — there is deliberately no zero to mistake for a
   * measurement.
   */
  actual?: string;
  /** The unit the planned amount is in. Absent alongside `actual`. */
  unit?: NutrientUnit;

  /** The target, unrounded, in the same unit as `actual`. */
  target?: string;
  /** Present when the reference publishes a range rather than a point. */
  targetRange?: { min: string; max: string };
  /** What the publisher called it — RDA, EAR, AI, UL. Never relabelled. */
  targetType?: ReferenceValueType;

  /**
   * `target − actual`. Positive means more is needed; negative means the plan
   * exceeds the target. For a range, measured against whichever bound was
   * crossed.
   */
  remaining?: string;

  /** `actual / basis × 100`, unrounded. Absent when the basis is zero. */
  percentage?: string;
  percentageBasis?: PercentageBasis;

  /**
   * Whether every item in the plan contributed to `actual`.
   *
   * Carried as its own dimension rather than folded into `status`, because a
   * partial total can still be meaningfully below or above a target — and
   * collapsing the two would lose one of them.
   */
  coverage: Completeness;
  /** How many plan items published this nutrient, out of how many were totalled. */
  contributingItems: number;
  totalItems: number;
  /** Foods that published nothing for this nutrient. */
  missingFrom: string[];

  displayOrder: number;
};

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * The reusable analysis result.
 *
 * Deliberately not shaped for one screen. A future meal planner, template
 * engine, review view, and client portal all need the same answer, and any of
 * them should be able to read this without a translation layer.
 */
export type NutritionSummary = {
  /** Energy first — it is what a practitioner checks before anything else. */
  energy: NutrientComparison;
  protein: NutrientComparison;
  carbohydrate: NutrientComparison;
  fat: NutrientComparison;
  fibre: NutrientComparison;

  /** Every remaining dictionary nutrient, in dictionary order. */
  micronutrients: NutrientComparison[];

  coverage: {
    /** Items totalled. */
    itemCount: number;
    /** Nutrients where every item contributed. */
    completeNutrients: number;
    /** Nutrients where at least one item published nothing. */
    partialNutrients: number;
    /** Nutrients no item published at all. */
    unavailableNutrients: string[];
    /** Nutrients with no licensed target to compare against. */
    targetsUnavailable: number;
  };

  /** Distinct sources behind the food values and the targets. */
  provenance: {
    foodSources: { code: string; name: string; version: string; permissionStatus: string }[];
    targetReferences: TargetReference[];
  };
};

/** Nutrition for one meal slot, and its share of the day. */
export type MealBreakdown = {
  slot: string;
  label: string;
  itemCount: number;
  /** Totals for the slot alone, unrounded. Absent where nothing published. */
  energy?: string;
  protein?: string;
  carbohydrate?: string;
  fat?: string;
  fibre?: string;
  totalGrams: string;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Why an analysis could not be produced.
 *
 * Distinct from a nutrient being unavailable, which is an ordinary result. These
 * mean the analysis itself could not run.
 */
export type AnalysisErrorCode =
  | "PLAN_NOT_FOUND"
  | "CLIENT_NOT_ACCESSIBLE"
  | "FOOD_CALCULATION_FAILED"
  | "INVALID_PLAN_ITEM";

export type AnalysisError = {
  code: AnalysisErrorCode;
  /** Safe to display. Never an id, a table name, or a driver message. */
  message: string;
  /** Which item failed, for a UI that wants to highlight the row. */
  itemId?: string;
};

export type AnalysisOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: AnalysisError };

export function analysisError(
  code: AnalysisErrorCode,
  message: string,
  itemId?: string,
): { ok: false; error: AnalysisError } {
  return itemId
    ? { ok: false, error: { code, message, itemId } }
    : { ok: false, error: { code, message } };
}

/** Display order and wording for the meal slots. */
export const MEAL_SLOTS = [
  { slot: "BREAKFAST", label: "Breakfast" },
  { slot: "MID_MORNING", label: "Mid-morning" },
  { slot: "LUNCH", label: "Lunch" },
  { slot: "EVENING_SNACK", label: "Evening snack" },
  { slot: "DINNER", label: "Dinner" },
] as const;

export type MealSlotCode = (typeof MEAL_SLOTS)[number]["slot"];
