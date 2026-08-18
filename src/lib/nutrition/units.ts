/**
 * The unit vocabulary.
 *
 * Phase 8A establishes *what units exist* and *what shape a conversion has*.
 * It deliberately does not build the conversion engine — that belongs to the
 * calculation phase, where it can be built against published portion
 * references rather than guessed.
 *
 * WHAT IS AND IS NOT SEEDED
 *
 * Only two conversions are defined here, and both are SI definitions rather
 * than measurements:
 *
 *     1 kg = 1000 g
 *     1 L  = 1000 ml
 *
 * Nothing converts a katori, cup, bowl, glass, piece, or serving to grams. A
 * katori of dal and a katori of rice do not weigh the same, so no global factor
 * can exist; and picking a plausible number for "1 cup of cooked rice" would
 * put an invented value underneath every calculation later built on top of it.
 * Those factors come from published portion references and arrive with the
 * phase that has them.
 *
 * Even `tsp` and `tbsp` are left unconverted. 15 ml is the metric definition
 * and 14.79 ml is the US one; choosing between them is a decision, not a fact
 * this module gets to make quietly.
 */

import type { UnitCategory } from "@/generated/prisma/enums";

export type UnitDefinition = {
  /** Stable identifier, referenced by dataset manifests and basis units. */
  code: string;
  name: string;
  category: UnitCategory;
  /** The base unit of its category. Exactly one per category. */
  isCanonical?: boolean;
  /**
   * True when the gram equivalent depends on which food is being measured, so
   * no global conversion can ever exist for it.
   */
  requiresFoodContext?: boolean;
  description?: string;
};

export const UNIT_DEFINITIONS: readonly UnitDefinition[] = [
  // --- Weight ---------------------------------------------------------------
  {
    code: "g",
    name: "Gram",
    category: "WEIGHT",
    isCanonical: true,
    description: "Canonical weight unit. Nutrition bases are expressed in it.",
  },
  { code: "kg", name: "Kilogram", category: "WEIGHT" },

  // --- Volume ---------------------------------------------------------------
  {
    code: "ml",
    name: "Millilitre",
    category: "VOLUME",
    isCanonical: true,
    description: "Canonical volume unit.",
  },
  { code: "l", name: "Litre", category: "VOLUME" },
  {
    code: "tsp",
    name: "Teaspoon",
    category: "VOLUME",
    description:
      "No conversion is defined: the metric and US definitions differ, and choosing one is a product decision rather than a fact.",
  },
  {
    code: "tbsp",
    name: "Tablespoon",
    category: "VOLUME",
    description: "No conversion is defined, for the same reason as tsp.",
  },

  // --- Count ----------------------------------------------------------------
  // Countable, but the weight of one still depends on the food, so these carry
  // the food-context flag too.
  { code: "piece", name: "Piece", category: "COUNT", requiresFoodContext: true },
  { code: "slice", name: "Slice", category: "COUNT", requiresFoodContext: true },
  {
    code: "serving",
    name: "Serving",
    category: "COUNT",
    requiresFoodContext: true,
    description:
      "A serving is defined by the source or the practitioner, never assumed.",
  },

  // --- Household ------------------------------------------------------------
  // The units Indian practitioners and clients actually speak in. Every one
  // needs a food-specific weight, and none is seeded.
  {
    code: "katori",
    name: "Katori",
    category: "HOUSEHOLD",
    requiresFoodContext: true,
    description:
      "The standard Indian serving bowl. Its gram equivalent varies by both food and bowl size, so it is never converted globally.",
  },
  { code: "cup", name: "Cup", category: "HOUSEHOLD", requiresFoodContext: true },
  { code: "bowl", name: "Bowl", category: "HOUSEHOLD", requiresFoodContext: true },
  { code: "glass", name: "Glass", category: "HOUSEHOLD", requiresFoodContext: true },
  {
    code: "handful",
    name: "Handful",
    category: "HOUSEHOLD",
    requiresFoodContext: true,
  },
] as const;

export type GlobalConversion = {
  fromCode: string;
  toCode: string;
  factor: string;
  /** Why this factor is true. Never blank. */
  sourceNote: string;
};

/**
 * Conversions that hold for every food, because they are definitions of the
 * units themselves rather than properties of anything being measured.
 *
 * Factors are strings so they reach the NUMERIC column without passing through
 * a JavaScript float on the way.
 */
export const GLOBAL_UNIT_CONVERSIONS: readonly GlobalConversion[] = [
  {
    fromCode: "kg",
    toCode: "g",
    factor: "1000",
    sourceNote: "SI definition: 1 kilogram = 1000 grams.",
  },
  {
    fromCode: "l",
    toCode: "ml",
    factor: "1000",
    sourceNote: "SI definition: 1 litre = 1000 millilitres.",
  },
] as const;

export const UNIT_BY_CODE: ReadonlyMap<string, UnitDefinition> = new Map(
  UNIT_DEFINITIONS.map((unit) => [unit.code, unit]),
);

export function isKnownUnitCode(code: string): boolean {
  return UNIT_BY_CODE.has(code);
}

/**
 * Whether a unit may be used as a nutrition basis.
 *
 * Only canonical weight and volume qualify. "Per katori" is not a basis a
 * nutrient value can be stored against, because nothing can later work out
 * what a katori weighs.
 */
export function isValidBasisUnit(code: string): boolean {
  const unit = UNIT_BY_CODE.get(code);
  if (!unit) return false;
  return unit.isCanonical === true;
}
