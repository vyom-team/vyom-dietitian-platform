import type { FoodCategory } from "@/generated/prisma/enums";

import { normalizeFoodName } from "@/lib/nutrition/normalize-name";
import type {
  Diagnostic,
  NormalizedFood,
  NormalizedNutrientValue,
} from "../ingest/types";
import type {
  AdapterResult,
  NutrientColumnMapping,
  NutritionSourceAdapter,
} from "./types";

/**
 * IFCT 2017 adapter.
 *
 * Reads a tabular extraction of the Indian Food Composition Tables — 542
 * records across the publication's twelve tables, one row per food.
 *
 * WHY THE UNITS ARE READ OFF THE COLUMN NAMES
 *
 * The extraction names every column with its unit: `calcium_mg`,
 * `selenium_ug`, `energy_kj`. That is what makes this file importable at all.
 * The publication's own tables carry units in a separate header row that a PDF
 * extraction routinely loses or misaligns, and a mineral read as µg instead of
 * mg is wrong by a factor of a thousand while looking entirely plausible. Every
 * mapping below therefore states the unit explicitly and is checked against the
 * nutrient dictionary by the importer.
 *
 * WHAT THIS SOURCE DOES NOT PUBLISH
 *
 *   Energy in kcal   IFCT states kilojoules only. Foods from this source carry
 *                    ENERGY_KJ and no ENERGY. Vyom does not convert units
 *                    during ingestion, and dividing by 4.184 here would make
 *                    this adapter the author of a value the publication never
 *                    printed.
 *   Vitamin B12      No column exists. Absent, not zero.
 *   Cholesterol      Not present in this extraction.
 *   Vitamin D total  D2 and D3 are published separately with no stated total,
 *                    and nothing here sums them.
 *
 * Pure: rows in, records out. No file reading, no database, no logging.
 */

/** Structural columns. Their absence means this is not an IFCT extraction. */
const ID_COLUMN = "food_code";
const NAME_COLUMN = "item_name";
const GROUP_COLUMN = "food_group";
const RECORD_TYPE_COLUMN = "record_type";
const TABLE_COLUMN = "ifct_table";
const REGIONS_COLUMN = "regions";

type NutrientColumn = {
  column: string;
  nutrient: string;
  /** The unit the column name itself declares. */
  unit: string;
  notes?: string;
};

/**
 * Column → Vyom nutrient, with the unit the column declares.
 *
 * Deliberately explicit and deliberately conservative: a column is mapped only
 * where the publication's quantity and Vyom's nutrient mean the same thing.
 * Everything else is listed as unmapped below rather than being forced into an
 * approximate home.
 */
const NUTRIENT_COLUMNS: readonly NutrientColumn[] = [
  // --- Proximates (Table 1) -------------------------------------------------
  { column: "energy_kj", nutrient: "ENERGY_KJ", unit: "KJ" },
  { column: "protein_g", nutrient: "PROTEIN", unit: "G" },
  { column: "total_fat_g", nutrient: "FAT", unit: "G" },
  {
    column: "carbohydrate_g",
    nutrient: "CARBOHYDRATE",
    unit: "G",
    notes: "Available carbohydrate by difference, as the publication states it.",
  },
  { column: "dietary_fibre_total_g", nutrient: "FIBRE", unit: "G" },
  { column: "total_free_sugars_g", nutrient: "SUGARS", unit: "G" },

  // --- Fat fractions (Table 8) ---------------------------------------------
  // Vyom stores these in milligrams, which is the unit IFCT publishes.
  { column: "total_saturated_fatty_acids_mg", nutrient: "SATURATED_FAT", unit: "MG" },
  { column: "total_monounsaturated_fatty_acids_mg", nutrient: "MUFA", unit: "MG" },
  { column: "total_polyunsaturated_fatty_acids_mg", nutrient: "PUFA", unit: "MG" },

  // --- Minerals and trace elements (Table 5) --------------------------------
  { column: "calcium_mg", nutrient: "CALCIUM", unit: "MG" },
  { column: "iron_mg", nutrient: "IRON", unit: "MG" },
  { column: "zinc_mg", nutrient: "ZINC", unit: "MG" },
  { column: "magnesium_mg", nutrient: "MAGNESIUM", unit: "MG" },
  { column: "sodium_mg", nutrient: "SODIUM", unit: "MG" },
  { column: "potassium_mg", nutrient: "POTASSIUM", unit: "MG" },
  { column: "phosphorus_mg", nutrient: "PHOSPHORUS", unit: "MG" },
  { column: "copper_mg", nutrient: "COPPER", unit: "MG" },
  { column: "selenium_ug", nutrient: "SELENIUM", unit: "UG" },
  { column: "chromium_mg", nutrient: "CHROMIUM", unit: "MG" },
  { column: "manganese_mg", nutrient: "MANGANESE", unit: "MG" },
  { column: "molybdenum_mg", nutrient: "MOLYBDENUM", unit: "MG" },

  // --- Water-soluble vitamins (Table 3) -------------------------------------
  { column: "thiamine_b1_mg", nutrient: "VITAMIN_B1", unit: "MG" },
  { column: "riboflavin_b2_mg", nutrient: "VITAMIN_B2", unit: "MG" },
  { column: "niacin_b3_mg", nutrient: "VITAMIN_B3", unit: "MG" },
  { column: "pantothenic_acid_b5_mg", nutrient: "VITAMIN_B5", unit: "MG" },
  { column: "total_b6_mg", nutrient: "VITAMIN_B6", unit: "MG" },
  { column: "biotin_b7_ug", nutrient: "VITAMIN_B7", unit: "UG" },
  { column: "total_folates_b9_ug", nutrient: "FOLATE", unit: "UG" },
  { column: "total_ascorbic_acid_mg", nutrient: "VITAMIN_C", unit: "MG" },

  // --- Fat-soluble vitamins (Table 4) ---------------------------------------
  {
    column: "retinol_ug",
    nutrient: "VITAMIN_A",
    unit: "UG",
    notes:
      "Preformed retinol as published. Not a retinol activity equivalent — IFCT reports carotenoids separately and Vyom does not combine them.",
  },
  { column: "vitamin_d2_ug", nutrient: "VITAMIN_D2", unit: "UG" },
  { column: "cholecalciferol_d3_ug", nutrient: "VITAMIN_D3", unit: "UG" },
  {
    column: "alpha_tocopherol_equivalent_mg",
    nutrient: "VITAMIN_E",
    unit: "MG",
    notes:
      "Alpha-tocopherol equivalent, the publication's own total. The individual tocopherol and tocotrienol fractions are left unmapped rather than summed.",
  },
  { column: "vitamin_k1_ug", nutrient: "VITAMIN_K1", unit: "UG" },
  { column: "menaquinones_k2_ug", nutrient: "VITAMIN_K2", unit: "UG" },

  // --- Carotenoids (Table 4) ------------------------------------------------
  { column: "total_carotenoids_ug", nutrient: "CAROTENOIDS", unit: "UG" },
] as const;

/**
 * Columns this file carries that Vyom has no nutrient for.
 *
 * Recorded rather than dropped, so the gap between what IFCT measured and what
 * Vyom represents is visible in `source_nutrient_mappings` instead of being
 * invisible. Most are genuine science Vyom simply does not model yet; a few are
 * contaminants that have no place in a dietary target at all.
 */
const UNMAPPED_PREFIXES: readonly { prefix: string; reason: string }[] = [
  {
    prefix: "histidine_",
    reason: "Amino acid profile. Vyom models no individual amino acid.",
  },
  { prefix: "isoleucine_", reason: "Amino acid profile." },
  { prefix: "leucine_", reason: "Amino acid profile." },
  { prefix: "lysine_", reason: "Amino acid profile." },
  { prefix: "methionine_", reason: "Amino acid profile." },
  { prefix: "cystine_", reason: "Amino acid profile." },
  { prefix: "phenylalanine_", reason: "Amino acid profile." },
  { prefix: "threonine_", reason: "Amino acid profile." },
  { prefix: "tryptophan_", reason: "Amino acid profile." },
  { prefix: "valine_", reason: "Amino acid profile." },
  { prefix: "alanine_", reason: "Amino acid profile." },
  { prefix: "arginine_", reason: "Amino acid profile." },
  { prefix: "aspartic_", reason: "Amino acid profile." },
  { prefix: "glutamic_", reason: "Amino acid profile." },
  { prefix: "glycine_", reason: "Amino acid profile." },
  { prefix: "proline_", reason: "Amino acid profile." },
  { prefix: "serine_", reason: "Amino acid profile." },
  { prefix: "tyrosine_", reason: "Amino acid profile." },
] as const;

const UNMAPPED_EXACT: readonly { column: string; reason: string }[] = [
  { column: "moisture_g", reason: "Water content. Not a nutrient Vyom tracks." },
  { column: "ash_g", reason: "Total ash. An analytical residue, not a nutrient." },
  {
    column: "dietary_fibre_insoluble_g",
    reason: "Fibre fraction. Vyom stores total fibre only.",
  },
  { column: "dietary_fibre_soluble_g", reason: "Fibre fraction." },
  {
    column: "total_available_carbohydrate_g",
    reason:
      "A second carbohydrate figure from the carbohydrate table. carbohydrate_g from the proximates table is used instead, so one food never carries two competing values.",
  },
  { column: "total_starch_g", reason: "Carbohydrate fraction. Not modelled." },
  { column: "fructose_g", reason: "Individual sugar. Vyom stores free sugars only." },
  { column: "glucose_g", reason: "Individual sugar." },
  { column: "sucrose_g", reason: "Individual sugar." },
  { column: "maltose_g", reason: "Individual sugar." },
  {
    column: "aluminium_mg",
    reason: "Contaminant element. Never a dietary target and deliberately not mapped.",
  },
  { column: "arsenic_ug", reason: "Contaminant element." },
  { column: "cadmium_mg", reason: "Contaminant element." },
  { column: "lead_mg", reason: "Contaminant element." },
  { column: "mercury_ug", reason: "Contaminant element." },
  { column: "nickel_mg", reason: "Trace element Vyom does not model." },
  { column: "cobalt_mg", reason: "Trace element Vyom does not model." },
  { column: "lithium_mg", reason: "Trace element Vyom does not model." },
  { column: "oxalate_mg", reason: "Antinutrient. Not modelled." },
  { column: "phytate_mg", reason: "Antinutrient. Not modelled." },
  { column: "total_saponin_g", reason: "Antinutrient. Not modelled." },
] as const;

/**
 * IFCT food group → Vyom category.
 *
 * A vocabulary mapping, not a nutritional judgement: it decides which filter a
 * food appears under and nothing else. Anything unlisted falls to OTHER and
 * raises a warning rather than being guessed at.
 */
const CATEGORY_BY_GROUP: Record<string, FoodCategory> = {
  "cereals and millets": "GRAINS",
  "grain legumes": "PULSES",
  "green leafy vegetables": "VEGETABLES",
  "other vegetables": "VEGETABLES",
  "roots and tubers": "VEGETABLES",
  mushrooms: "VEGETABLES",
  fruits: "FRUITS",
  "nuts and oil seeds": "NUTS",
  "condiments and spices - fresh": "SPICES",
  "condiments and spices": "SPICES",
  "milk and milk products": "DAIRY",
  eggs: "EGGS",
  poultry: "MEAT",
  "animal meat": "MEAT",
  "marine fish": "SEAFOOD",
  "marine shellfish": "SEAFOOD",
  "marine mollusks": "SEAFOOD",
  "freshwater fish and shellfish": "SEAFOOD",
  "edible oils and fats": "OILS",
  sugars: "OTHER",
  "miscellaneous foods": "OTHER",
};

/**
 * Reads a published cell.
 *
 * IFCT reports a mean and a standard deviation for foods sampled across
 * regions — "9.20±0.40". The mean is the published value; the deviation
 * describes the sampling and is not a second measurement. It is dropped here
 * rather than averaged into anything.
 *
 * Returns null for a blank cell. **Never zero** — IFCT leaves a cell empty
 * where it did not measure, and a zero would claim the food contains none.
 */
export function readValue(raw: string | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;

  const mean = trimmed.split("±")[0]!.trim();
  if (mean === "") return null;

  // Anything that is not a plain decimal is a marker this adapter does not
  // understand, and guessing at it would put an invented value in the database.
  return /^\d+(\.\d+)?$/.test(mean) ? mean : null;
}

export const ifctAdapter: NutritionSourceAdapter = {
  sourceCode: "IFCT",
  displayName: "Indian Food Composition Tables 2017",

  nutrientColumns(headers): NutrientColumnMapping[] {
    const present = new Set(headers);
    const mappings: NutrientColumnMapping[] = [];

    for (const entry of NUTRIENT_COLUMNS) {
      if (!present.has(entry.column)) continue;
      mappings.push({
        sourceColumn: entry.column,
        nutrientCode: entry.nutrient,
        sourceUnit: entry.unit,
        ...(entry.notes ? { notes: entry.notes } : {}),
      });
    }

    const mapped = new Set(NUTRIENT_COLUMNS.map((entry) => entry.column));
    const structural = new Set([
      ID_COLUMN,
      NAME_COLUMN,
      GROUP_COLUMN,
      RECORD_TYPE_COLUMN,
      TABLE_COLUMN,
      REGIONS_COLUMN,
    ]);

    for (const header of headers) {
      if (mapped.has(header) || structural.has(header)) continue;

      const exact = UNMAPPED_EXACT.find((entry) => entry.column === header);
      const prefixed = UNMAPPED_PREFIXES.find((entry) => header.startsWith(entry.prefix));

      mappings.push({
        sourceColumn: header,
        nutrientCode: null,
        sourceUnit: null,
        notes:
          exact?.reason ??
          prefixed?.reason ??
          "Published by IFCT; Vyom has no nutrient for it. Recorded so the gap is visible.",
      });
    }

    return mappings;
  },

  validateHeaders(headers): Diagnostic[] {
    const present = new Set(headers);
    const diagnostics: Diagnostic[] = [];

    for (const [column, role] of [
      [ID_COLUMN, "food identifier"],
      [NAME_COLUMN, "food name"],
      [GROUP_COLUMN, "food group"],
    ] as const) {
      if (present.has(column)) continue;
      diagnostics.push({
        severity: "error",
        code: "MISSING_COLUMN",
        row: 0,
        column,
        message: `IFCT file has no "${column}" column (${role}). This does not look like an IFCT extraction.`,
      });
    }

    const known = NUTRIENT_COLUMNS.filter((entry) => present.has(entry.column));

    if (known.length === 0) {
      diagnostics.push({
        severity: "error",
        code: "MISSING_COLUMN",
        row: 0,
        message:
          "No recognised IFCT nutrient column is present. The extraction's column names may differ from the ones this adapter maps.",
      });
    } else if (known.length < NUTRIENT_COLUMNS.length) {
      const absent = NUTRIENT_COLUMNS.filter((entry) => !present.has(entry.column));
      diagnostics.push({
        severity: "warning",
        code: "MISSING_COLUMN",
        row: 0,
        message: `${absent.length} mapped nutrient column(s) are absent from this file: ${absent
          .map((entry) => entry.column)
          .join(", ")}. Those nutrients will be missing rather than zero.`,
      });
    }

    return diagnostics;
  },

  parse(rows, context): AdapterResult {
    const records: NormalizedFood[] = [];
    const diagnostics: Diagnostic[] = [];

    rows.forEach((raw, index) => {
      // +2: one for the header, one to make it 1-based like an editor shows.
      const row = index + 2;

      const externalId = (raw[ID_COLUMN] ?? "").trim();
      const name = (raw[NAME_COLUMN] ?? "").trim();

      if (!externalId || !name) {
        diagnostics.push({
          severity: "error",
          code: "MISSING_IDENTIFIER",
          row,
          message: "Row has no food code or no name, and cannot be identified.",
        });
        return;
      }

      const group = (raw[GROUP_COLUMN] ?? "").trim();
      const category = CATEGORY_BY_GROUP[group.toLowerCase()] ?? "OTHER";

      if (group && !CATEGORY_BY_GROUP[group.toLowerCase()]) {
        diagnostics.push({
          severity: "warning",
          code: "UNMAPPED_CATEGORY",
          row,
          column: GROUP_COLUMN,
          message: `Food group "${group}" is not mapped to a Vyom category; filed as OTHER.`,
        });
      }

      const nutrients: NormalizedNutrientValue[] = [];

      for (const entry of NUTRIENT_COLUMNS) {
        const value = readValue(raw[entry.column]);

        /*
         * A blank cell produces no nutrient row at all. IFCT leaves a cell
         * empty where it did not measure, and writing 0 would claim the food
         * contains none of it.
         */
        if (value === null) continue;

        nutrients.push({
          nutrientCode: entry.nutrient,
          value,
          unit: entry.unit as NormalizedNutrientValue["unit"],
          basisQuantity: "100",
          basisUnitCode: "g",
          // The publisher's own column, kept so a value traces to the printed
          // table it was read from.
          sourceNutrientCode: entry.column,
        });
      }

      if (nutrients.length === 0) {
        diagnostics.push({
          severity: "warning",
          code: "NO_NUTRIENT_VALUES",
          row,
          message: `${name} carries no value Vyom can represent. It will import with no measured values — not with zeros.`,
        });
      }

      records.push({
        externalId,
        externalName: name,
        externalCategory: group || null,
        canonicalName: name,
        normalizedName: normalizeFoodName(name),
        description: null,
        category,
        /*
         * IFCT documents foods as sampled — raw commodities and market forms —
         * rather than dishes. The preparation state is left UNKNOWN because the
         * publication does not state it per food, and rice raw and rice cooked
         * differ in energy by roughly a factor of three.
         */
        foodType: "RAW",
        preparationState: "UNKNOWN",
        aliases: [],
        nutrients,
        // IFCT publishes no household portion sizes. None is invented here.
        servings: [],
        raw,
        row,
      });
    });

    if (records.length === 0) {
      diagnostics.push({
        severity: "error",
        code: "MISSING_IDENTIFIER",
        row: 0,
        message: `${context.sourceCode} ${context.version}: no usable rows were found in the file.`,
      });
    }

    return { records, diagnostics };
  },
};
