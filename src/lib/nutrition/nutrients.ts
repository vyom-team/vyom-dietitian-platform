/**
 * The nutrient dictionary.
 *
 * A **vocabulary**, not data. Every entry here says what a nutrient is called
 * and what unit it is measured in — never how much of it is in any food. That
 * distinction is the project's prime directive in one file: "protein is
 * measured in grams" is a definition, "toor dal contains 22.3 g of protein" is
 * a measurement that must come from a published source.
 *
 * WHY THE UNITS ARE FIXED HERE
 *
 * Each nutrient declares exactly one storage unit. A value arriving in a
 * different unit is a validation *failure*, not something to convert on the
 * fly. Silent unit conversion is how a milligram becomes a microgram and a
 * calcium figure ends up a thousand times wrong; making it an error forces the
 * dataset manifest to state the unit explicitly, and forces a human to look
 * when the two disagree.
 *
 * The list covers the macronutrients and the fifteen micronutrients Vyom tracks
 * (see CLAUDE.md), plus the further nutrients the Indian datasets actually
 * publish — fat fractions, trace minerals, and the vitamin fractions a source
 * reports separately.
 *
 * It is a superset of what any one phase exposes. Deciding which nutrients
 * appear in the UI is a later product decision, and the dictionary should not
 * have to change when it is made.
 *
 * Where a source reports fractions rather than a total (vitamin D2 and D3, K1
 * and K2), each fraction gets its own code and nothing sums them. A total is a
 * calculation, and this file stores no derived value.
 */

import type { NutrientCategory, NutrientUnit } from "@/generated/prisma/enums";

export type NutrientDefinition = {
  /**
   * Stable internal identifier. Dataset manifests are written against these,
   * so a code may be added but must never be renamed in place — a rename would
   * silently orphan every mapping that referenced it.
   */
  code: string;
  name: string;
  category: NutrientCategory;
  /** The one unit values of this nutrient are stored in. */
  unit: NutrientUnit;
  description?: string;
};

/**
 * Display order is assigned by position, so the reading order here is the order
 * a future UI shows: energy, then macronutrients, then minerals, then vitamins.
 */
export const NUTRIENT_DEFINITIONS: readonly NutrientDefinition[] = [
  // --- Energy ---------------------------------------------------------------
  {
    code: "ENERGY",
    name: "Energy",
    category: "ENERGY",
    unit: "KCAL",
    description:
      "Food energy in kilocalories. The unit Indian references and practitioners work in.",
  },
  {
    code: "ENERGY_KJ",
    name: "Energy (kilojoules)",
    category: "ENERGY",
    unit: "KJ",
    description:
      "The same quantity in kilojoules. Stored separately rather than converted, so a source that publishes both is recorded as published.",
  },

  // --- Macronutrients -------------------------------------------------------
  { code: "PROTEIN", name: "Protein", category: "MACRONUTRIENT", unit: "G" },
  { code: "FAT", name: "Total fat", category: "MACRONUTRIENT", unit: "G" },
  {
    code: "CARBOHYDRATE",
    name: "Carbohydrate",
    category: "MACRONUTRIENT",
    unit: "G",
    description:
      "Available carbohydrate as published by the source. Sources differ on whether fibre is included; the difference is preserved rather than reconciled.",
  },
  {
    code: "FIBRE",
    name: "Dietary fibre",
    category: "MACRONUTRIENT",
    unit: "G",
  },
  { code: "SUGARS", name: "Free sugars", category: "MACRONUTRIENT", unit: "G" },

  // Fat fractions. Declared in milligrams because that is the unit the Indian
  // datasets publish them in. Declaring them in grams would force a conversion
  // on every import, and Vyom does not convert units during ingestion.
  {
    code: "SATURATED_FAT",
    name: "Saturated fatty acids",
    category: "MACRONUTRIENT",
    unit: "MG",
  },
  {
    code: "MUFA",
    name: "Monounsaturated fatty acids",
    category: "MACRONUTRIENT",
    unit: "MG",
  },
  {
    code: "PUFA",
    name: "Polyunsaturated fatty acids",
    category: "MACRONUTRIENT",
    unit: "MG",
  },
  { code: "CHOLESTEROL", name: "Cholesterol", category: "OTHER", unit: "MG" },

  // --- Minerals -------------------------------------------------------------
  { code: "CALCIUM", name: "Calcium", category: "MINERAL", unit: "MG" },
  { code: "IRON", name: "Iron", category: "MINERAL", unit: "MG" },
  { code: "ZINC", name: "Zinc", category: "MINERAL", unit: "MG" },
  { code: "MAGNESIUM", name: "Magnesium", category: "MINERAL", unit: "MG" },
  { code: "SODIUM", name: "Sodium", category: "MINERAL", unit: "MG" },
  { code: "POTASSIUM", name: "Potassium", category: "MINERAL", unit: "MG" },
  { code: "PHOSPHORUS", name: "Phosphorus", category: "MINERAL", unit: "MG" },
  { code: "COPPER", name: "Copper", category: "MINERAL", unit: "MG" },
  { code: "SELENIUM", name: "Selenium", category: "MINERAL", unit: "UG" },
  { code: "CHROMIUM", name: "Chromium", category: "MINERAL", unit: "MG" },
  { code: "MANGANESE", name: "Manganese", category: "MINERAL", unit: "MG" },
  { code: "MOLYBDENUM", name: "Molybdenum", category: "MINERAL", unit: "MG" },

  // --- Vitamins -------------------------------------------------------------
  {
    code: "VITAMIN_A",
    name: "Vitamin A",
    category: "VITAMIN",
    unit: "UG",
    description:
      "Micrograms. A source publishing IU must declare that in its manifest; the mismatch is rejected rather than converted, because the IU-to-microgram factor differs by compound.",
  },
  { code: "VITAMIN_B1", name: "Thiamine (B1)", category: "VITAMIN", unit: "MG" },
  {
    code: "VITAMIN_B2",
    name: "Riboflavin (B2)",
    category: "VITAMIN",
    unit: "MG",
  },
  { code: "VITAMIN_B3", name: "Niacin (B3)", category: "VITAMIN", unit: "MG" },
  { code: "VITAMIN_B6", name: "Vitamin B6", category: "VITAMIN", unit: "MG" },
  { code: "VITAMIN_B12", name: "Vitamin B12", category: "VITAMIN", unit: "UG" },
  { code: "VITAMIN_C", name: "Vitamin C", category: "VITAMIN", unit: "MG" },
  {
    code: "VITAMIN_D",
    name: "Vitamin D",
    category: "VITAMIN",
    unit: "UG",
    description:
      "Total vitamin D. A source publishing D2 and D3 separately maps to those codes instead — summing them would be a calculation, and this file stores no derived value.",
  },
  { code: "VITAMIN_D2", name: "Vitamin D2 (ergocalciferol)", category: "VITAMIN", unit: "UG" },
  { code: "VITAMIN_D3", name: "Vitamin D3 (cholecalciferol)", category: "VITAMIN", unit: "UG" },
  { code: "VITAMIN_E", name: "Vitamin E", category: "VITAMIN", unit: "MG" },
  { code: "VITAMIN_K1", name: "Vitamin K1 (phylloquinone)", category: "VITAMIN", unit: "UG" },
  { code: "VITAMIN_K2", name: "Vitamin K2 (menaquinone)", category: "VITAMIN", unit: "UG" },
  { code: "VITAMIN_B5", name: "Pantothenic acid (B5)", category: "VITAMIN", unit: "MG" },
  { code: "VITAMIN_B7", name: "Biotin (B7)", category: "VITAMIN", unit: "UG" },
  { code: "FOLATE", name: "Folate", category: "VITAMIN", unit: "UG" },
  {
    code: "CAROTENOIDS",
    name: "Total carotenoids",
    category: "OTHER",
    unit: "UG",
  },
] as const;

/** Lookup by code, for validating a manifest's nutrient mappings. */
export const NUTRIENT_BY_CODE: ReadonlyMap<string, NutrientDefinition> = new Map(
  NUTRIENT_DEFINITIONS.map((nutrient) => [nutrient.code, nutrient]),
);

export function isKnownNutrientCode(code: string): boolean {
  return NUTRIENT_BY_CODE.has(code);
}

/**
 * The unit a nutrient must be stored in, or null if the code is unknown.
 *
 * Callers compare this against the unit a dataset declares. They must not use
 * it to convert.
 */
export function nutrientUnit(code: string): NutrientUnit | null {
  return NUTRIENT_BY_CODE.get(code)?.unit ?? null;
}
