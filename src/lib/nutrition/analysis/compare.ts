/**
 * The comparison engine.
 *
 *     planned amount (8C)   vs   client target (8D)   →   gap, percentage, status
 *
 * It calculates neither side. Both arrive already computed by engines that own
 * them, and this module only relates the two — which is what keeps one source
 * of truth per number and makes this layer testable in isolation.
 *
 * THE UNIT TRAP
 *
 * Phase 8C reports a nutrient in `MG`. Phase 8D reports a requirement in
 * `MG_PER_DAY`. Those correspond, but `G` and `MG_PER_DAY` do not, and quietly
 * treating them as if they did would be wrong by a factor of a thousand while
 * looking entirely reasonable on screen. Compatibility is therefore an explicit
 * table, and an unlisted pair produces `INCOMPARABLE_UNITS` rather than a
 * number. This engine converts nothing.
 *
 * Pure. No database, no I/O, no clock.
 */

import { Prisma } from "@/generated/prisma/browser";

import type { NutrientUnit } from "@/generated/prisma/enums";
import type { AggregatedNutrient } from "@/lib/nutrition/calculate/types";
import type { ReferenceUnit } from "@/generated/prisma/enums";
import type { Target } from "@/lib/nutrition/targets/types";

import type { ComparisonStatus, NutrientComparison, PercentageBasis } from "./types";

const Decimal = Prisma.Decimal;
type DecimalValue = InstanceType<typeof Prisma.Decimal>;

/**
 * Which nutrient unit a requirement unit may be compared against.
 *
 * A daily total in milligrams answers a requirement stated in milligrams per
 * day, and nothing else. Four pairs, no conversions.
 *
 * Deliberately absent:
 *   KJ                  — no reference unit expresses kilojoules per day
 *   IU                  — the IU-to-mass factor differs by compound
 *   G_PER_KG_PER_DAY    — Phase 8D resolves this to G_PER_DAY before it
 *                         reaches a target; one arriving here unresolved is a
 *                         bug, not something to multiply by a weight again
 *   PERCENT_OF_ENERGY   — an intermediate, never a final nutrient requirement
 *   FACTOR              — likewise
 */
const COMPARABLE: Partial<Record<ReferenceUnit, NutrientUnit>> = {
  KCAL_PER_DAY: "KCAL",
  G_PER_DAY: "G",
  MG_PER_DAY: "MG",
  UG_PER_DAY: "UG",
};

export function unitsAreComparable(
  targetUnit: ReferenceUnit,
  actualUnit: NutrientUnit,
): boolean {
  return COMPARABLE[targetUnit] === actualUnit;
}

/**
 * Compares one nutrient's planned total against its target.
 *
 * @param nutrient the aggregated plan total from Phase 8C, or null when no food
 * in the plan published this nutrient
 * @param target the client's requirement from Phase 8D
 * @param definition the dictionary entry, so an absent nutrient can still be
 * named and ordered
 */
export function compareNutrient(
  nutrient: AggregatedNutrient | null,
  target: Target,
  definition: { code: string; name: string; category: NutrientComparison["category"]; displayOrder: number },
): NutrientComparison {
  const base: NutrientComparison = {
    code: definition.code,
    name: definition.name,
    category: definition.category,
    status: "DATA_UNAVAILABLE",
    coverage: nutrient?.completeness ?? "COMPLETE",
    contributingItems: nutrient?.contributingItems ?? 0,
    totalItems: nutrient?.totalItems ?? 0,
    missingFrom: nutrient?.missingFrom ?? [],
    displayOrder: definition.displayOrder,
  };

  /*
   * No food published this nutrient. There is no `actual` field at all — a zero
   * here would read as "this plan contains none of it", which is a measurement
   * nobody made.
   */
  if (!nutrient) {
    return {
      ...base,
      status: target.status === "CALCULATED" ? "DATA_UNAVAILABLE" : "TARGET_UNAVAILABLE",
      ...(target.status === "CALCULATED" ? describeTarget(target) : {}),
    };
  }

  const withActual: NutrientComparison = {
    ...base,
    actual: nutrient.value,
    unit: nutrient.unit,
  };

  // Phase 8D has no licensed reference. The plan total still stands on its own.
  if (target.status !== "CALCULATED") {
    return { ...withActual, status: "TARGET_UNAVAILABLE" };
  }

  if (!unitsAreComparable(target.unit, nutrient.unit)) {
    return {
      ...withActual,
      ...describeTarget(target),
      status: "INCOMPARABLE_UNITS",
    };
  }

  const actual = new Decimal(nutrient.value);

  return target.kind === "RANGE"
    ? compareAgainstRange(withActual, target, actual)
    : compareAgainstPoint(withActual, target, actual);
}

/**
 * A point target.
 *
 * `TARGET_MET` is exact equality, and there is deliberately no tolerance band:
 * deciding that ±5% is "close enough" is a clinical judgement, and this project
 * does not invent those. The percentage carries the nuance a band would have
 * hidden — 99.4% of a target reads as BELOW_TARGET, and correctly so.
 */
function compareAgainstPoint(
  comparison: NutrientComparison,
  target: Extract<Target, { status: "CALCULATED"; kind: "POINT" }>,
  actual: DecimalValue,
): NutrientComparison {
  const targetValue = new Decimal(target.value);
  const remaining = targetValue.minus(actual);

  let status: ComparisonStatus;
  if (actual.equals(targetValue)) status = "TARGET_MET";
  else if (actual.lessThan(targetValue)) status = "BELOW_TARGET";
  else status = "ABOVE_TARGET";

  return {
    ...comparison,
    ...describeTarget(target),
    status,
    remaining: remaining.toString(),
    ...percentage(actual, targetValue, "TARGET"),
  };
}

/**
 * A published range.
 *
 * Inside the band is `TARGET_MET` — the publisher declined to name a single
 * figure, so any point within it satisfies the recommendation. `remaining` is
 * measured against whichever bound was crossed, because that is the number a
 * dietitian would act on.
 */
function compareAgainstRange(
  comparison: NutrientComparison,
  target: Extract<Target, { status: "CALCULATED"; kind: "RANGE" }>,
  actual: DecimalValue,
): NutrientComparison {
  const min = new Decimal(target.min);
  const max = new Decimal(target.max);

  if (actual.lessThan(min)) {
    return {
      ...comparison,
      ...describeTarget(target),
      status: "BELOW_TARGET",
      remaining: min.minus(actual).toString(),
      ...percentage(actual, min, "RANGE_MINIMUM"),
    };
  }

  if (actual.greaterThan(max)) {
    return {
      ...comparison,
      ...describeTarget(target),
      status: "ABOVE_TARGET",
      remaining: max.minus(actual).toString(),
      ...percentage(actual, min, "RANGE_MINIMUM"),
    };
  }

  return {
    ...comparison,
    ...describeTarget(target),
    status: "TARGET_MET",
    remaining: "0",
    ...percentage(actual, min, "RANGE_MINIMUM"),
  };
}

/**
 * `actual / basis × 100`.
 *
 * A zero basis yields **no percentage at all** rather than zero, infinity, or
 * NaN. Dividing by it is undefined, and every one of those substitutes would
 * render as a number somebody could act on.
 */
function percentage(
  actual: DecimalValue,
  basis: DecimalValue,
  percentageBasis: PercentageBasis,
): { percentage?: string; percentageBasis?: PercentageBasis } {
  if (basis.isZero() || !basis.isFinite()) return {};

  return {
    percentage: actual.div(basis).mul(100).toString(),
    percentageBasis,
  };
}

/** Copies the target's own figures and semantic label onto the comparison. */
function describeTarget(
  target: Extract<Target, { status: "CALCULATED" }>,
): Pick<NutrientComparison, "target" | "targetRange" | "targetType"> {
  return target.kind === "RANGE"
    ? {
        targetRange: { min: target.min, max: target.max },
        targetType: target.valueType,
      }
    : { target: target.value, targetType: target.valueType };
}
