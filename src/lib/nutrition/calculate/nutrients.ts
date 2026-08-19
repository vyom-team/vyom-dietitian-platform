/**
 * The nutrient arithmetic. One formula, applied to every nutrient alike.
 *
 *     amount = publishedValue × effectiveGrams / basisQuantity
 *
 * That is the whole engine. There is no branch for protein, none for energy,
 * and none for any micronutrient: a nutrient is a code, a unit, a published
 * figure, and a basis, and the same three operations serve all of them. Adding
 * vitamin B12 when a source finally publishes it is a data change, not a code
 * change.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No energy is derived from macronutrients. If a source publishes energy, that
 * figure is authoritative and is used as published; protein × 4 + carbohydrate
 * × 4 + fat × 9 is a *different* number that would compete with it, and Vyom
 * does not manufacture a second opinion about a value its source already
 * states. Every one of the 1,014 imported foods publishes energy directly.
 *
 * No missing value is filled in. A nutrient the source did not publish produces
 * no entry at all — never a zero. The two are different facts and the database
 * holds both: 2,661 stored values are an explicit zero, and those are calculated
 * like any other figure.
 *
 * Pure. No database, no I/O, no clock.
 */

import { Prisma } from "@/generated/prisma/browser";

import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/nutrients";
import { DECIMAL_LITERAL } from "@/validations/nutrition";

import {
  calculationError,
  type CalculatedNutrient,
  type CalculationOutcome,
  type NutrientComposition,
} from "./types";

const Decimal = Prisma.Decimal;
type DecimalValue = InstanceType<typeof Prisma.Decimal>;

/**
 * Calculates every nutrient in a composition for a given weight.
 *
 * The order of operations is deliberate: multiply, then divide. Multiplication
 * of two decimals is exact, so the only step that can round is the division,
 * and with the 100 g basis every imported value uses, that is exact too.
 *
 * Returns the values unrounded. Rounding is a presentation decision and belongs
 * to `format.ts`; storing or returning a rounded figure here would make the
 * displayed number the source of truth.
 *
 * @param composition what the source published, per nutrient
 * @param grams the effective weight, already resolved by `grams.ts`
 */
export function calculateNutrientsFromGrams(
  composition: readonly NutrientComposition[],
  grams: DecimalValue | string,
): CalculationOutcome<CalculatedNutrient[]> {
  const weight = grams instanceof Decimal ? grams : new Decimal(grams);

  if (!weight.isFinite() || weight.lessThanOrEqualTo(0)) {
    return calculationError(
      "INVALID_QUANTITY",
      "The effective weight must be greater than zero.",
    );
  }

  if (composition.length === 0) {
    return calculationError(
      "NUTRITION_DATA_UNAVAILABLE",
      "No nutrition values have been published for this food.",
    );
  }

  const calculated: CalculatedNutrient[] = [];

  for (const entry of composition) {
    if (!DECIMAL_LITERAL.test(entry.value.trim())) {
      return calculationError(
        "NUTRIENT_VALUE_INVALID",
        `The stored value for ${entry.name} could not be read.`,
      );
    }

    if (!DECIMAL_LITERAL.test(entry.basisQuantity.trim())) {
      return calculationError(
        "NUTRIENT_VALUE_INVALID",
        `The stored basis for ${entry.name} could not be read.`,
      );
    }

    const published = new Decimal(entry.value);
    const basis = new Decimal(entry.basisQuantity);

    if (!published.isFinite()) {
      return calculationError(
        "NUTRIENT_VALUE_INVALID",
        `The stored value for ${entry.name} could not be read.`,
      );
    }

    /*
     * A zero or negative basis is not a number this can divide by, and a
     * silently skipped nutrient would look identical to one the source never
     * published. It is a data fault, so it fails loudly.
     */
    if (!basis.isFinite() || basis.lessThanOrEqualTo(0)) {
      return calculationError(
        "NUTRIENT_VALUE_INVALID",
        `The stored basis for ${entry.name} is not usable.`,
      );
    }

    const value = published.mul(weight).div(basis);

    calculated.push({
      code: entry.code,
      name: entry.name,
      category: entry.category,
      unit: entry.unit,
      value: value.toString(),
      basis: {
        value: published.toString(),
        quantity: basis.toString(),
        unitCode: entry.basisUnitCode,
      },
      displayOrder: entry.displayOrder,
      sourceNutrientCode: entry.sourceNutrientCode,
    });
  }

  calculated.sort((a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code));

  return { ok: true, data: calculated };
}

/**
 * Nutrients Vyom knows about that this composition does not carry.
 *
 * Reported so a gap is visible rather than silent. With the currently imported
 * data this returns VITAMIN_B12 and VITAMIN_D for every food: INDB publishes
 * neither, and publishes D2 and D3 separately without a total. Nothing here
 * sums those into a vitamin D figure — that would be a derived value, and the
 * source did not state it.
 */
export function unavailableNutrientCodes(
  composition: readonly NutrientComposition[],
): string[] {
  const present = new Set(composition.map((entry) => entry.code));
  return NUTRIENT_DEFINITIONS.filter((nutrient) => !present.has(nutrient.code)).map(
    (nutrient) => nutrient.code,
  );
}
