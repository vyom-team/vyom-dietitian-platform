/**
 * The nutrition calculation domain.
 *
 * Types and typed errors for turning a food, a serving, and a quantity into
 * calculated nutrient amounts. Nothing here touches a database, React, or an
 * HTTP request — this module is pure vocabulary, and the arithmetic modules
 * beside it are pure functions over it.
 *
 * WHY EVERY NUMBER IS A STRING
 *
 * Nutrition values cross this boundary as decimal strings, never as JS numbers.
 * A published figure is reference data: `0.1 + 0.2` is not `0.3` in binary
 * floating point, and a clinical tool must not introduce error it did not get
 * from its source. Internally the arithmetic runs on decimal.js; strings are
 * how the exact value survives the trip to a caller, a test, or a screen.
 *
 * WHY ERRORS ARE VALUES
 *
 * Following `lib/assessments/bmi.ts`: a calculation that cannot be performed
 * returns a reason, it does not throw. "This food has no serving weight" is an
 * ordinary state of the data — 97 of the 1,014 imported foods carry no serving
 * at all — and a screen has to render it, not catch it.
 */

import type { NutrientCategory, NutrientUnit } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/**
 * How a quantity is expressed.
 *
 * Deliberately two values. GRAM is universal; SERVING defers to a weight the
 * source published for that specific food. Nothing else can be supported
 * honestly today: no household unit — katori, cup, bowl, glass — has a gram
 * equivalent in the database, and `lib/nutrition/units.ts` seeds none, because
 * a katori of dal and a katori of rice do not weigh the same.
 *
 * A "bowl" reaches the engine as a FoodServing whose weight the source
 * supplied, never as a unit with an assumed conversion.
 */
export const QUANTITY_UNITS = ["GRAM", "SERVING"] as const;
export type QuantityUnit = (typeof QUANTITY_UNITS)[number];

export function isQuantityUnit(value: string): value is QuantityUnit {
  return (QUANTITY_UNITS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Why a calculation could not be performed.
 *
 * Every code is actionable by a practitioner or by the caller, and none leaks
 * database internals.
 */
export type CalculationErrorCode =
  /** Quantity was zero, negative, not a number, or beyond the technical bound. */
  | "INVALID_QUANTITY"
  /** A unit outside QUANTITY_UNITS. Never silently converted. */
  | "UNSUPPORTED_UNIT"
  /** unit = SERVING but no serving was identified. */
  | "SERVING_REQUIRED"
  /** No food with that id, or it is deactivated. */
  | "FOOD_NOT_FOUND"
  /** No serving with that id. */
  | "SERVING_NOT_FOUND"
  /** The serving exists but belongs to a different food. */
  | "FOOD_SERVING_MISMATCH"
  /** The serving exists and the source published no weight for it. */
  | "SERVING_WEIGHT_UNAVAILABLE"
  /** The food carries no nutrient values at all. */
  | "NUTRITION_DATA_UNAVAILABLE"
  /** A stored value or basis could not be read, or a basis was zero or negative. */
  | "NUTRIENT_VALUE_INVALID";

export type CalculationError = {
  code: CalculationErrorCode;
  /** Safe to display. Never contains an id, a table name, or a driver message. */
  message: string;
};

/** Result shape used by every calculation entry point. */
export type CalculationOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: CalculationError };

export function calculationError(
  code: CalculationErrorCode,
  message: string,
): { ok: false; error: CalculationError } {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Technical bounds
// ---------------------------------------------------------------------------

/**
 * Technical guards, NOT nutritional guidance.
 *
 * These exist so a hand-crafted request cannot drive the arithmetic into
 * absurd magnitudes. They say nothing about how much of a food a person should
 * eat — this engine makes no clinical statement, and neither number may ever be
 * presented as a recommendation or as a limit on intake.
 */
export const MAX_QUANTITY = 10_000;
/** 100 kg of one food in a single entry. A technical ceiling, nothing more. */
export const MAX_EFFECTIVE_GRAMS = 100_000;

// ---------------------------------------------------------------------------
// Inputs to the pure engine
// ---------------------------------------------------------------------------

/**
 * One nutrient value as published, handed to the pure engine as plain data.
 *
 * Deliberately not a Prisma row. The arithmetic must be testable without
 * PostgreSQL, so the repository layer flattens what it read into this shape and
 * the engine never learns where it came from.
 */
export type NutrientComposition = {
  /** Vyom nutrient code, e.g. "PROTEIN". */
  code: string;
  name: string;
  category: NutrientCategory;
  unit: NutrientUnit;
  /** The published figure, unrounded, as a decimal string. */
  value: string;
  /**
   * What `value` is per. Read from the row, never assumed to be 100: a source
   * publishing per-serving figures would make every result wrong by an unknown
   * factor if this were hard-coded.
   */
  basisQuantity: string;
  /** The basis unit code, e.g. "g". */
  basisUnitCode: string;
  /** Dictionary ordering, carried through so a UI need not re-sort. */
  displayOrder: number;
  /** The publisher's own nutrient identifier, for traceability. */
  sourceNutrientCode: string | null;
};

/** A serving as the source described it. */
export type ServingComposition = {
  id: string;
  foodId: string;
  label: string;
  /** Null when the source named a portion but published no weight for it. */
  weightGrams: string | null;
  weightMethod: string;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** One calculated nutrient amount, with the figure it was derived from. */
export type CalculatedNutrient = {
  code: string;
  name: string;
  category: NutrientCategory;
  unit: NutrientUnit;
  /** The calculated amount, unrounded. Rounding belongs to the formatter. */
  value: string;
  /**
   * The arithmetic, kept so a "why this number?" view can be built later
   * without re-querying: value = basis.value × grams / basis.quantity.
   */
  basis: {
    value: string;
    quantity: string;
    unitCode: string;
  };
  displayOrder: number;
  sourceNutrientCode: string | null;
};

/**
 * Where a result's numbers came from.
 *
 * Never optional and never stripped. A calculated nutrient figure without its
 * source is exactly what this project's prime directive exists to prevent, and
 * for a dataset that is not licence-cleared the practitioner needs to see the
 * provenance beside the number rather than in a settings page.
 */
export type CalculationProvenance = {
  source: {
    code: string;
    name: string;
    /** DEVELOPMENT_ONLY for every dataset currently imported. */
    permissionStatus: string;
    attributionRequired: boolean;
    attributionText: string | null;
  };
  version: string;
  /** The publisher's own identifier for this food, kept verbatim. */
  externalFoodId: string | null;
};

/** The food a calculation was performed on. */
export type CalculatedFood = {
  id: string;
  name: string;
  category: string;
  foodType: string;
  /**
   * RAW and COOKED are different foods with different nutrition and are never
   * converted between. Surfaced so a result cannot be mistaken for the other
   * state of the same ingredient.
   */
  preparationState: string;
};

/** The canonical result of calculating one food. */
export type NutritionCalculationResult = {
  food: CalculatedFood;
  /** As supplied, exact. */
  quantity: string;
  unit: QuantityUnit;
  /** Null for a GRAM calculation. */
  serving: {
    id: string;
    label: string;
    weightGrams: string;
    weightMethod: string;
  } | null;
  /** Everything resolves to grams before any nutrient arithmetic happens. */
  effectiveGrams: string;
  nutrients: CalculatedNutrient[];
  /**
   * Nutrients Vyom knows about that this source version did not publish for
   * this food. Listed explicitly so "not measured" is visible rather than being
   * an absence a reader might mistake for zero.
   */
  unavailableNutrients: string[];
  provenance: CalculationProvenance;
};

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Whether a total covers every item that was aggregated.
 *
 * The distinction is the point. Summing four foods when only three published
 * iron produces a real number that is *not* the iron content of the meal, and
 * presenting it as one would be a false claim of completeness.
 */
export type Completeness = "COMPLETE" | "PARTIAL";

export type AggregatedNutrient = {
  code: string;
  name: string;
  category: NutrientCategory;
  unit: NutrientUnit;
  /** Sum over the items that published this nutrient. Never over the others. */
  value: string;
  completeness: Completeness;
  /** How many items contributed, out of how many were aggregated. */
  contributingItems: number;
  totalItems: number;
  /** Names of the items with no value, so a UI can say which. */
  missingFrom: string[];
  displayOrder: number;
};

/** The result of aggregating several calculated foods. */
export type AggregatedNutritionResult = {
  items: NutritionCalculationResult[];
  totalGrams: string;
  nutrients: AggregatedNutrient[];
  /** Nutrients no item published. Absent from `nutrients` entirely. */
  unavailableNutrients: string[];
  /** Distinct sources behind the total, in the order first seen. */
  sources: CalculationProvenance[];
  /** True when at least one nutrient total is PARTIAL. */
  hasPartialTotals: boolean;
};
