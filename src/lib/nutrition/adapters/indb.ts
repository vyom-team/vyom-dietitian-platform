import type { NutrientUnit } from "@/generated/prisma/enums";
import { DECIMAL_LITERAL } from "@/validations/nutrition";

import type {
  Diagnostic,
  NormalizedFood,
  NormalizedNutrientValue,
  NormalizedServing,
  RawRow,
} from "../ingest/types";
import { normalizeFoodName } from "../normalize-name";
import { deriveServingWeight } from "./serving-weight";
import type {
  AdapterResult,
  NutritionSourceAdapter,
  NutrientColumnMapping,
} from "./types";

/**
 * Indian Nutrient Databank adapter.
 *
 * INDB publishes 1,014 commonly consumed Indian recipes — khichdi, dosa, garam
 * chai — rather than raw ingredients. That makes it a better fit for meal
 * planning than a composition table: a dietitian plans "a bowl of dal", not
 * "22 g of raw toor dal".
 *
 * WHY THIS NEEDS AN ADAPTER RATHER THAN A MANIFEST
 *
 * Every nutrient appears twice: once per 100 g and once per serving. The
 * serving is named ("bowl", "plate") but its weight is never stated. Expressing
 * that in the Phase 8A manifest format would have meant inventing manifest
 * syntax for one publisher's layout — so the layout lives here instead, and
 * everything downstream stays identical for all sources.
 *
 * COLUMN → NUTRIENT MAPPING
 *
 * Every mapping below is one-to-one with a nutrient declared in the *same
 * unit* INDB publishes. Nothing is converted during import, which is what keeps
 * the Phase 8A rule intact: a unit disagreement is an error, never a silent
 * multiplication.
 *
 * Two columns are deliberately left unmapped rather than forced:
 *
 *   vitb9_ug   B9 is folate, which arrives separately as `folate_ug`. Mapping
 *              both to FOLATE would write one value twice; picking one
 *              silently would hide that the source disagrees with itself.
 *   (none other)
 *
 * Vitamin D arrives as D2 and D3 separately and is stored that way. Summing
 * them into a total would be a calculation, and this pipeline stores no derived
 * nutrient value.
 *
 * **Vitamin B12 is absent from INDB entirely.** Nothing here fabricates it. A
 * food imported from INDB has no B12 row, which reads as "not measured" — the
 * correct answer, and one that matters for a product serving a largely
 * vegetarian population.
 */

/** INDB column → Vyom nutrient, in the unit INDB publishes. */
const NUTRIENT_COLUMNS: ReadonlyArray<{
  column: string;
  nutrient: string;
  unit: NutrientUnit;
}> = [
  { column: "energy_kj", nutrient: "ENERGY_KJ", unit: "KJ" },
  { column: "energy_kcal", nutrient: "ENERGY", unit: "KCAL" },
  { column: "carb_g", nutrient: "CARBOHYDRATE", unit: "G" },
  { column: "protein_g", nutrient: "PROTEIN", unit: "G" },
  { column: "fat_g", nutrient: "FAT", unit: "G" },
  { column: "freesugar_g", nutrient: "SUGARS", unit: "G" },
  { column: "fibre_g", nutrient: "FIBRE", unit: "G" },
  { column: "sfa_mg", nutrient: "SATURATED_FAT", unit: "MG" },
  { column: "mufa_mg", nutrient: "MUFA", unit: "MG" },
  { column: "pufa_mg", nutrient: "PUFA", unit: "MG" },
  { column: "cholesterol_mg", nutrient: "CHOLESTEROL", unit: "MG" },
  { column: "calcium_mg", nutrient: "CALCIUM", unit: "MG" },
  { column: "phosphorus_mg", nutrient: "PHOSPHORUS", unit: "MG" },
  { column: "magnesium_mg", nutrient: "MAGNESIUM", unit: "MG" },
  { column: "sodium_mg", nutrient: "SODIUM", unit: "MG" },
  { column: "potassium_mg", nutrient: "POTASSIUM", unit: "MG" },
  { column: "iron_mg", nutrient: "IRON", unit: "MG" },
  { column: "copper_mg", nutrient: "COPPER", unit: "MG" },
  { column: "selenium_ug", nutrient: "SELENIUM", unit: "UG" },
  { column: "chromium_mg", nutrient: "CHROMIUM", unit: "MG" },
  { column: "manganese_mg", nutrient: "MANGANESE", unit: "MG" },
  { column: "molybdenum_mg", nutrient: "MOLYBDENUM", unit: "MG" },
  { column: "zinc_mg", nutrient: "ZINC", unit: "MG" },
  { column: "vita_ug", nutrient: "VITAMIN_A", unit: "UG" },
  { column: "vite_mg", nutrient: "VITAMIN_E", unit: "MG" },
  { column: "vitd2_ug", nutrient: "VITAMIN_D2", unit: "UG" },
  { column: "vitd3_ug", nutrient: "VITAMIN_D3", unit: "UG" },
  { column: "vitk1_ug", nutrient: "VITAMIN_K1", unit: "UG" },
  { column: "vitk2_ug", nutrient: "VITAMIN_K2", unit: "UG" },
  { column: "folate_ug", nutrient: "FOLATE", unit: "UG" },
  { column: "vitb1_mg", nutrient: "VITAMIN_B1", unit: "MG" },
  { column: "vitb2_mg", nutrient: "VITAMIN_B2", unit: "MG" },
  { column: "vitb3_mg", nutrient: "VITAMIN_B3", unit: "MG" },
  { column: "vitb5_mg", nutrient: "VITAMIN_B5", unit: "MG" },
  { column: "vitb6_mg", nutrient: "VITAMIN_B6", unit: "MG" },
  { column: "vitb7_ug", nutrient: "VITAMIN_B7", unit: "UG" },
  { column: "vitc_mg", nutrient: "VITAMIN_C", unit: "MG" },
  { column: "carotenoids_ug", nutrient: "CAROTENOIDS", unit: "UG" },
];

/**
 * Columns INDB publishes that Vyom deliberately does not map, with the reason.
 *
 * Recorded rather than ignored: an unmapped column becomes an UNMAPPED row in
 * `source_nutrient_mappings`, so the decision is visible to anyone auditing
 * where a value came from — or did not.
 */
const UNMAPPED_COLUMNS: ReadonlyArray<{ column: string; reason: string }> = [
  {
    column: "vitb9_ug",
    reason:
      "B9 is folate, which INDB also publishes as folate_ug. Mapping both would write the same nutrient twice, and choosing one silently would hide any disagreement between them.",
  },
];

const ID_COLUMN = "food_code";
const NAME_COLUMN = "food_name";
const SOURCE_COLUMN = "primarysource";
const SERVING_COLUMN = "servings_unit";
const SERVING_PREFIX = "unit_serving_";

export const indbAdapter: NutritionSourceAdapter = {
  sourceCode: "INDB",
  displayName: "Indian Nutrient Databank",

  nutrientColumns(headers): NutrientColumnMapping[] {
    const present = new Set(headers);
    const mappings: NutrientColumnMapping[] = [];

    for (const entry of NUTRIENT_COLUMNS) {
      if (!present.has(entry.column)) continue;
      mappings.push({
        sourceColumn: entry.column,
        nutrientCode: entry.nutrient,
        sourceUnit: entry.unit,
      });
    }

    for (const entry of UNMAPPED_COLUMNS) {
      if (!present.has(entry.column)) continue;
      mappings.push({
        sourceColumn: entry.column,
        nutrientCode: null,
        sourceUnit: null,
        notes: entry.reason,
      });
    }

    return mappings;
  },

  validateHeaders(headers): Diagnostic[] {
    const present = new Set(headers);
    const diagnostics: Diagnostic[] = [];

    // Structural columns. Without these the file is not INDB, and continuing
    // would produce a dataset of empty records rather than an obvious failure.
    for (const [column, role] of [
      [ID_COLUMN, "food identifier"],
      [NAME_COLUMN, "food name"],
    ] as const) {
      if (present.has(column)) continue;
      diagnostics.push({
        severity: "error",
        code: "MISSING_COLUMN",
        row: 0,
        column,
        message: `INDB file has no "${column}" column (${role}). This does not look like an INDB export.`,
      });
    }

    // A file with none of the expected nutrient columns is the wrong file, or
    // a release whose layout changed. Either way it must not import silently.
    const known = NUTRIENT_COLUMNS.filter((entry) => present.has(entry.column));
    if (known.length === 0) {
      diagnostics.push({
        severity: "error",
        code: "MISSING_COLUMN",
        row: 0,
        message:
          "No recognised INDB nutrient column is present. The adapter's column mapping may be out of date for this release.",
      });
    }

    // Columns the file has that the adapter has never seen. A warning, not an
    // error: a new release adding a nutrient should not block the import, but
    // it must be visible so the mapping can be extended.
    const accounted = new Set<string>([
      ID_COLUMN,
      NAME_COLUMN,
      SOURCE_COLUMN,
      SERVING_COLUMN,
      ...NUTRIENT_COLUMNS.map((entry) => entry.column),
      ...UNMAPPED_COLUMNS.map((entry) => entry.column),
    ]);

    for (const header of headers) {
      if (accounted.has(header)) continue;
      if (header.startsWith(SERVING_PREFIX)) continue;
      diagnostics.push({
        severity: "warning",
        code: "UNMAPPED_NUTRIENT",
        row: 0,
        column: header,
        message: `Column "${header}" is not in the INDB adapter's mapping and was not imported.`,
      });
    }

    return diagnostics;
  },

  parse(rows, context): AdapterResult {
    const records: NormalizedFood[] = [];
    const diagnostics: Diagnostic[] = [];

    for (const [index, raw] of rows.entries()) {
      const row = index + 1;
      const externalId = (raw[ID_COLUMN] ?? "").trim();
      const externalName = (raw[NAME_COLUMN] ?? "").trim();

      if (externalId === "") {
        diagnostics.push({
          severity: "error",
          code: "MISSING_IDENTIFIER",
          row,
          column: ID_COLUMN,
          message: "Row has no food_code, so it could not be imported idempotently.",
        });
        continue;
      }

      if (externalName === "") {
        diagnostics.push({
          severity: "error",
          code: "MISSING_NAME",
          row,
          externalId,
          column: NAME_COLUMN,
          message: "Row has no food_name.",
        });
        continue;
      }

      const nutrients = readNutrients(raw, row, externalId, diagnostics);
      const servings = readServing(raw, row, externalId, diagnostics);

      if (nutrients.length === 0) {
        diagnostics.push({
          severity: "warning",
          code: "NO_NUTRIENT_VALUES",
          row,
          externalId,
          message:
            "No nutrient value could be read. The record imports with no measured values — not with zeros.",
        });
      }

      records.push({
        externalId,
        externalName,
        // INDB's `primarysource` names which of its own sub-datasets a recipe
        // came from. Kept as the external category so the provenance survives,
        // even though it is not a food group.
        externalCategory: (raw[SOURCE_COLUMN] ?? "").trim() || null,
        canonicalName: externalName,
        normalizedName: normalizeFoodName(externalName),
        description: null,
        /*
         * INDB publishes no food group at all. OTHER is the honest answer:
         * assigning GRAINS or DAIRY by guessing at the name would be exactly
         * the invented categorisation the brief rules out, and the publisher's
         * own wording is preserved above so a real mapping can be added later.
         */
        category: "OTHER",
        // Every INDB record is a prepared dish rather than an ingredient.
        foodType: "PREPARED",
        /*
         * UNKNOWN, not COOKED. INDB does not publish a preparation state, and
         * while most of these are cooked, some are not — a cold drink is
         * neither raw nor cooked in any useful sense. Guessing here would put a
         * fabricated distinction into a field a later engine will trust.
         */
        preparationState: "UNKNOWN",
        /*
         * No aliases. INDB has no alias column: alternative names appear inside
         * the food name in brackets, and "(Garam Chai)" is an alias while
         * "(with semolina)" is a qualifier, with no reliable rule between them.
         * Both land in normalizedName so search finds them; neither becomes an
         * unverified alias row.
         */
        aliases: [],
        nutrients,
        servings,
        raw,
        row,
      });
    }

    void context;
    return { records, diagnostics };
  },
};

/** Reads the per-100 g nutrient columns. */
function readNutrients(
  raw: RawRow,
  row: number,
  externalId: string,
  diagnostics: Diagnostic[],
): NormalizedNutrientValue[] {
  const values: NormalizedNutrientValue[] = [];

  for (const entry of NUTRIENT_COLUMNS) {
    const cell = (raw[entry.column] ?? "").trim();

    /*
     * MISSING IS NOT ZERO. A blank cell produces no value, which reads as "the
     * source did not publish this" — a different fact from a published zero,
     * and the distinction is unrecoverable once written as 0.
     */
    if (cell === "") {
      diagnostics.push({
        severity: "warning",
        code: "MISSING_NUTRIENT_VALUE",
        row,
        externalId,
        column: entry.column,
        message: `${entry.nutrient}: no value published. Recorded as absent, not zero.`,
      });
      continue;
    }

    if (!DECIMAL_LITERAL.test(cell)) {
      diagnostics.push({
        severity: "error",
        code: "INVALID_NUMBER",
        row,
        externalId,
        column: entry.column,
        message: `${entry.nutrient}: "${cell}" is not a number.`,
      });
      continue;
    }

    if (cell.startsWith("-")) {
      diagnostics.push({
        severity: "error",
        code: "NEGATIVE_VALUE",
        row,
        externalId,
        column: entry.column,
        message: `${entry.nutrient}: "${cell}" is negative, which is not a possible quantity.`,
      });
      continue;
    }

    values.push({
      nutrientCode: entry.nutrient,
      // Carried as text: the published figure never becomes a float.
      value: cell,
      unit: entry.unit,
      basisQuantity: "100",
      basisUnitCode: "g",
      sourceNutrientCode: entry.column,
    });
  }

  return values;
}

/**
 * Reads the named serving and recovers its weight.
 *
 * INDB names a portion but never states what it weighs. It does publish every
 * nutrient twice — per 100 g and per serving — so the weight is implied by the
 * ratio, and `deriveServingWeight` recovers it only when the nutrients agree.
 */
function readServing(
  raw: RawRow,
  row: number,
  externalId: string,
  diagnostics: Diagnostic[],
): NormalizedServing[] {
  const label = (raw[SERVING_COLUMN] ?? "").trim();
  if (label === "") return [];

  const pairs = NUTRIENT_COLUMNS.map((entry) => ({
    per100: (raw[entry.column] ?? "").trim(),
    perServing: (raw[`${SERVING_PREFIX}${entry.column}`] ?? "").trim(),
  }));

  const derived = deriveServingWeight(pairs);

  if (derived.status === "derived") {
    return [
      {
        label,
        weightGrams: derived.grams,
        weightMethod: "DERIVED_FROM_SOURCE",
        agreementSpread: derived.spread,
        isDefault: true,
      },
    ];
  }

  /*
   * The weight could not be established. The serving is still recorded — the
   * source did name a portion, and that is worth keeping — but with no weight
   * and an explicit UNKNOWN method, so nothing downstream can mistake silence
   * for a measurement.
   */
  diagnostics.push({
    severity: "warning",
    code:
      derived.status === "inconsistent"
        ? "SERVING_WEIGHT_INCONSISTENT"
        : "SERVING_WEIGHT_UNKNOWN",
    row,
    externalId,
    column: SERVING_COLUMN,
    message:
      derived.status === "inconsistent"
        ? `Serving "${label}": the per-100 g and per-serving figures imply different weights (spread ${derived.spread}). Recorded without a weight rather than picking one.`
        : `Serving "${label}": not enough published figures to establish a weight. Recorded without one.`,
  });

  return [
    {
      label,
      weightGrams: null,
      weightMethod: "UNKNOWN",
      agreementSpread: null,
      isDefault: true,
    },
  ];
}
