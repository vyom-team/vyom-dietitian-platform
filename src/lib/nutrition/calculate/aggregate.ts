/**
 * Aggregation — several calculated foods into one total.
 *
 * The primitive a meal total is built from, and later a daily total. It sums
 * calculated results; it does not know what a meal is, and nothing here is a
 * meal-planning feature.
 *
 * THE RULE THAT MATTERS: NO FALSE COMPLETENESS
 *
 * A nutrient is summed only over the items that actually published it. Adding
 * four foods when three published iron gives a real number that is *not* the
 * iron content of those four foods, and showing it as a total would be a claim
 * the data does not support. So every total carries its coverage:
 *
 *     COMPLETE   every item published this nutrient
 *     PARTIAL    at least one did not — the figure is a floor, not a total
 *
 * A nutrient no item published does not appear as a total at all. It appears in
 * `unavailableNutrients`, because a zero there would be a fabricated value.
 *
 * Pure. No database, no I/O, no clock.
 */

import { Prisma } from "@/generated/prisma/browser";

import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/nutrients";

import {
  calculationError,
  type AggregatedNutrient,
  type AggregatedNutritionResult,
  type CalculationOutcome,
  type CalculationProvenance,
  type NutritionCalculationResult,
} from "./types";

const Decimal = Prisma.Decimal;

/**
 * Sums calculated results into one total.
 *
 * An empty list is not an error — it is a meal with nothing in it, and the
 * honest total is zero grams with no nutrients and everything unavailable.
 */
export function aggregateNutrition(
  items: readonly NutritionCalculationResult[],
): CalculationOutcome<AggregatedNutritionResult> {
  const totalItems = items.length;

  type Accumulator = {
    definition: AggregatedNutrient;
    sum: InstanceType<typeof Prisma.Decimal>;
    contributors: Set<number>;
  };

  const byCode = new Map<string, Accumulator>();
  let totalGrams = new Decimal(0);

  for (const [index, item] of items.entries()) {
    totalGrams = totalGrams.plus(new Decimal(item.effectiveGrams));

    for (const nutrient of item.nutrients) {
      const existing = byCode.get(nutrient.code);

      if (!existing) {
        byCode.set(nutrient.code, {
          definition: {
            code: nutrient.code,
            name: nutrient.name,
            category: nutrient.category,
            unit: nutrient.unit,
            value: "0",
            completeness: "COMPLETE",
            contributingItems: 0,
            totalItems,
            missingFrom: [],
            displayOrder: nutrient.displayOrder,
          },
          sum: new Decimal(nutrient.value),
          contributors: new Set([index]),
        });
        continue;
      }

      /*
       * Units are fixed per nutrient by the dictionary and denormalised onto
       * every stored value, so a disagreement here means the data is corrupt.
       * Summing milligrams into grams would be wrong by a factor of a thousand
       * and would look entirely reasonable on screen, so it fails outright
       * rather than dropping the contribution and reporting a smaller total.
       */
      if (existing.definition.unit !== nutrient.unit) {
        return calculationError(
          "NUTRIENT_VALUE_INVALID",
          `${nutrient.name} is recorded in two different units and cannot be totalled.`,
        );
      }

      existing.sum = existing.sum.plus(new Decimal(nutrient.value));
      existing.contributors.add(index);
    }
  }

  const nutrients: AggregatedNutrient[] = [];

  for (const entry of byCode.values()) {
    const contributingItems = entry.contributors.size;
    const missingFrom = items
      .filter((_item, index) => !entry.contributors.has(index))
      .map((item) => item.food.name);

    nutrients.push({
      ...entry.definition,
      value: entry.sum.toString(),
      completeness: contributingItems === totalItems ? "COMPLETE" : "PARTIAL",
      contributingItems,
      totalItems,
      missingFrom,
    });
  }

  nutrients.sort((a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code));

  const unavailableNutrients = NUTRIENT_DEFINITIONS.filter(
    (nutrient) => !byCode.has(nutrient.code),
  ).map((nutrient) => nutrient.code);

  return {
    ok: true,
    data: {
      items: [...items],
      totalGrams: totalGrams.toString(),
      nutrients,
      unavailableNutrients,
      sources: distinctSources(items),
      hasPartialTotals: nutrients.some((nutrient) => nutrient.completeness === "PARTIAL"),
    },
  };
}

/**
 * The distinct sources behind a total, in the order first seen.
 *
 * A total assembled from two datasets says so. Provenance is not diluted by
 * aggregation — if anything it matters more, because the reader can no longer
 * see which food contributed which figure.
 */
function distinctSources(
  items: readonly NutritionCalculationResult[],
): CalculationProvenance[] {
  const seen = new Set<string>();
  const sources: CalculationProvenance[] = [];

  for (const item of items) {
    const key = `${item.provenance.source.code}@${item.provenance.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(item.provenance);
  }

  return sources;
}
