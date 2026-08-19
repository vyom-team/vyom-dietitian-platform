/**
 * Display formatting — the only place a calculated value is rounded.
 *
 * Internal precision and display precision are separate concerns, and this
 * module is the boundary between them. The engine returns 22.537500; a screen
 * shows 22.54 g. The rounded figure is never fed back into a calculation and is
 * never stored, so no total is ever built out of rounded parts.
 *
 * Rounding runs on decimal.js rather than `toFixed` on a JS number, so a value
 * that is exactly halfway rounds by decimal rules instead of by whatever the
 * binary representation happened to land on.
 *
 * Pure. No database, no I/O, no clock.
 */

import { Prisma } from "@/generated/prisma/browser";

import type { NutrientUnit } from "@/generated/prisma/enums";

const Decimal = Prisma.Decimal;

/** How a unit is written beside a number. */
const UNIT_LABELS: Record<NutrientUnit, string> = {
  KCAL: "kcal",
  KJ: "kJ",
  G: "g",
  MG: "mg",
  UG: "µg",
  IU: "IU",
};

export function nutrientUnitLabel(unit: NutrientUnit): string {
  return UNIT_LABELS[unit];
}

/**
 * Decimal places for a displayed nutrient amount.
 *
 * Energy is always whole: no reference publishes a fractional kilocalorie a
 * practitioner would act on. Everything else gets two decimals until the figure
 * is large enough that they add nothing — 0.42 mg of a trace mineral is
 * meaningless without them, and 123 g of carbohydrate is not improved by them.
 *
 * Two rather than one below 100 so that a column of macronutrients stays
 * comparable: 4.06 g and 22.54 g read as the same kind of measurement, where
 * 4.1 g and 22.5 g quietly lose a digit of the smaller one.
 */
function decimalPlacesFor(unit: NutrientUnit, magnitude: number): number {
  if (unit === "KCAL" || unit === "KJ" || unit === "IU") return 0;
  return magnitude >= 100 ? 0 : 2;
}

/**
 * Formats a calculated nutrient amount for display.
 *
 * Takes the exact decimal string the engine produced and returns text. Never
 * returns "0" for a value that was not measured — a missing nutrient has no
 * value to pass in, and callers must not substitute one.
 */
export function formatNutrientValue(value: string, unit: NutrientUnit): string {
  const amount = new Decimal(value);
  if (!amount.isFinite()) return "—";

  const places = decimalPlacesFor(unit, amount.abs().toNumber());
  return amount.toFixed(places);
}

/** Amount and unit together, e.g. "22.54 g". */
export function formatNutrient(value: string, unit: NutrientUnit): string {
  return `${formatNutrientValue(value, unit)} ${nutrientUnitLabel(unit)}`;
}

/**
 * Formats a weight in grams.
 *
 * Matches the convention already used by the food list: whole grams once the
 * figure is large enough that a decimal adds nothing, one decimal below that. A
 * portion is not known to a thousandth of a gram, and showing one would imply a
 * precision nobody has.
 */
export function formatGrams(value: string): string {
  const grams = new Decimal(value);
  if (!grams.isFinite()) return "—";
  return grams.greaterThanOrEqualTo(10) ? grams.toFixed(0) : grams.toFixed(1);
}

/**
 * Formats a quantity as entered.
 *
 * Trailing zeros are trimmed so "2" stays "2" rather than becoming "2.00", but
 * "1.5" keeps its half. The quantity is the practitioner's own input and should
 * read back the way they wrote it.
 */
export function formatQuantity(value: string): string {
  const quantity = new Decimal(value);
  if (!quantity.isFinite()) return value;
  return quantity.toString();
}
