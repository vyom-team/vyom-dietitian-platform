/**
 * Quantity validation and gram normalisation.
 *
 * Grams are the engine's one internal unit. Everything resolves to grams before
 * a single nutrient is calculated, because every nutrient value in the database
 * is stored against a weight basis and there is no other common ground.
 *
 * WHAT THIS REFUSES TO DO
 *
 * It never invents a weight. A serving becomes grams only when the source
 * published a weight for that specific serving of that specific food. There is
 * no fallback, no average, and no default: "1 bowl = 150 g" is a fabricated
 * number unless a source said so, and a fabricated portion weight would sit
 * underneath every nutrient figure derived from it.
 *
 * Pure. No database, no I/O, no clock.
 */

import { Prisma } from "@/generated/prisma/browser";

import { DECIMAL_LITERAL } from "@/validations/nutrition";

import {
  MAX_EFFECTIVE_GRAMS,
  MAX_QUANTITY,
  calculationError,
  isQuantityUnit,
  type CalculationOutcome,
  type QuantityUnit,
  type ServingComposition,
} from "./types";

const Decimal = Prisma.Decimal;
type DecimalValue = InstanceType<typeof Prisma.Decimal>;

/**
 * Parses a quantity.
 *
 * Accepts a decimal string — the form the UI submits, and the only form that
 * survives a round trip without floating-point error. A `number` is accepted
 * for programmatic callers and checked for finiteness first, so `NaN` and
 * `Infinity` are rejected before they can reach the arithmetic.
 *
 * Zero is rejected. A zero-quantity food is not an intake of nothing, it is a
 * food that should not be in the list, and returning a row of zeros would put
 * measured-looking zeros beside genuine ones.
 */
export function parseQuantity(
  raw: string | number,
): CalculationOutcome<DecimalValue> {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      return calculationError(
        "INVALID_QUANTITY",
        "Quantity must be a number.",
      );
    }
    return parseQuantity(String(raw));
  }

  const trimmed = raw.trim();

  if (trimmed === "") {
    return calculationError("INVALID_QUANTITY", "Enter a quantity.");
  }

  /*
   * The same literal grammar the importer validates published values against.
   * It deliberately rejects thousands separators: "1,234" is 1234 in one
   * convention and 1.234 in another, and guessing between them would be a
   * factor-of-1000 error in a clinical figure.
   */
  if (!DECIMAL_LITERAL.test(trimmed)) {
    return calculationError(
      "INVALID_QUANTITY",
      "Quantity must be a plain number, for example 2 or 1.5.",
    );
  }

  const quantity = new Decimal(trimmed);

  if (!quantity.isFinite()) {
    return calculationError("INVALID_QUANTITY", "Quantity must be a number.");
  }

  if (quantity.lessThanOrEqualTo(0)) {
    return calculationError(
      "INVALID_QUANTITY",
      "Quantity must be greater than zero.",
    );
  }

  if (quantity.greaterThan(MAX_QUANTITY)) {
    return calculationError(
      "INVALID_QUANTITY",
      `Quantity must be ${MAX_QUANTITY.toLocaleString("en-IN")} or less.`,
    );
  }

  return { ok: true, data: quantity };
}

export type GramResolutionInput = {
  quantity: string | number;
  /** Unvalidated on purpose — this function is where a bad unit is caught. */
  unit: string;
  /** The food the calculation is for. Used to verify serving ownership. */
  foodId: string;
  /** Required when unit is SERVING; ignored when unit is GRAM. */
  serving: ServingComposition | null;
};

export type GramResolution = {
  quantity: DecimalValue;
  unit: QuantityUnit;
  effectiveGrams: DecimalValue;
  serving: {
    id: string;
    label: string;
    weightGrams: string;
    weightMethod: string;
  } | null;
};

/**
 * Resolves a quantity and unit to an effective weight in grams.
 *
 *     GRAM     effectiveGrams = quantity
 *     SERVING  effectiveGrams = quantity × serving.weightGrams
 *
 * The serving must belong to the food. A serving borrowed from another food
 * would silently apply one food's portion weight to another's nutrition, which
 * is a wrong answer that looks entirely plausible on screen.
 */
export function resolveEffectiveGrams(
  input: GramResolutionInput,
): CalculationOutcome<GramResolution> {
  if (!isQuantityUnit(input.unit)) {
    /*
     * No silent conversion. A unit this engine does not know is an error, not
     * something to approximate — see lib/nutrition/units.ts for why no
     * household measure has a gram equivalent.
     */
    return calculationError(
      "UNSUPPORTED_UNIT",
      "That unit is not supported. Use grams, or a serving published for this food.",
    );
  }

  const unit: QuantityUnit = input.unit;

  const quantity = parseQuantity(input.quantity);
  if (!quantity.ok) return quantity;

  if (unit === "GRAM") {
    return finish(quantity.data, quantity.data, unit, null);
  }

  const serving = input.serving;

  if (!serving) {
    return calculationError(
      "SERVING_REQUIRED",
      "Choose a serving, or enter the quantity in grams.",
    );
  }

  if (serving.foodId !== input.foodId) {
    return calculationError(
      "FOOD_SERVING_MISMATCH",
      "That serving belongs to a different food.",
    );
  }

  if (serving.weightGrams === null) {
    /*
     * A real and common state: the source named a portion without publishing
     * what it weighs. The honest answer is that this cannot be calculated by
     * serving, not a plausible-looking guess.
     */
    return calculationError(
      "SERVING_WEIGHT_UNAVAILABLE",
      `The source did not publish a weight for "1 ${serving.label}". Enter the quantity in grams instead.`,
    );
  }

  if (!DECIMAL_LITERAL.test(serving.weightGrams.trim())) {
    return calculationError(
      "NUTRIENT_VALUE_INVALID",
      "The stored serving weight could not be read.",
    );
  }

  const weight = new Decimal(serving.weightGrams);

  if (!weight.isFinite() || weight.lessThanOrEqualTo(0)) {
    return calculationError(
      "NUTRIENT_VALUE_INVALID",
      "The stored serving weight could not be read.",
    );
  }

  return finish(quantity.data, quantity.data.mul(weight), unit, {
    id: serving.id,
    label: serving.label,
    weightGrams: weight.toString(),
    weightMethod: serving.weightMethod,
  });
}

function finish(
  quantity: DecimalValue,
  effectiveGrams: DecimalValue,
  unit: QuantityUnit,
  serving: GramResolution["serving"],
): CalculationOutcome<GramResolution> {
  if (effectiveGrams.greaterThan(MAX_EFFECTIVE_GRAMS)) {
    return calculationError(
      "INVALID_QUANTITY",
      `That works out to more than ${MAX_EFFECTIVE_GRAMS.toLocaleString("en-IN")} g. Reduce the quantity.`,
    );
  }

  return { ok: true, data: { quantity, unit, effectiveGrams, serving } };
}
