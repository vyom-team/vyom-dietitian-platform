import { z } from "zod";

import { isKnownNutrientCode, nutrientUnit } from "@/lib/nutrition/nutrients";
import { isKnownSourceCode } from "@/lib/nutrition/sources";
import { QUANTITY_UNITS } from "@/lib/nutrition/calculate/types";
import { isValidBasisUnit } from "@/lib/nutrition/units";

/**
 * Dataset manifest schema.
 *
 * A manifest is the contract between an external dataset and Vyom's model. It
 * says which file to read, which columns mean what, and which nutrient each
 * numeric column carries.
 *
 * WHY A MANIFEST RATHER THAN A PARSER PER DATASET
 *
 * IFCT, INDB, and USDA all publish tabular food data with different column
 * names, different category vocabularies, and different units. Writing a
 * bespoke parser per source would mean new code for every dataset and a fresh
 * chance to get a unit wrong each time. A manifest turns "support a new
 * dataset" into a data-entry task validated by this schema, and keeps the
 * ingestion code identical for all of them.
 *
 * It also makes the mapping *reviewable*. A column-to-nutrient assignment
 * written in JSON can be read by someone holding the printed tables; the same
 * assignment buried in a parser cannot.
 *
 * Nothing here contains a nutrition value. A manifest describes structure.
 */

export const FOOD_CATEGORIES = [
  "GRAINS",
  "PULSES",
  "LEGUMES",
  "VEGETABLES",
  "FRUITS",
  "DAIRY",
  "NUTS",
  "SEEDS",
  "OILS",
  "SPICES",
  "BEVERAGES",
  "MEAT",
  "SEAFOOD",
  "EGGS",
  "PREPARED_FOODS",
  "OTHER",
] as const;

export const FOOD_TYPES = [
  "RAW",
  "COOKED",
  "PROCESSED",
  "PACKAGED",
  "PREPARED",
  "INGREDIENT",
] as const;

export const NUTRIENT_UNITS = ["KCAL", "KJ", "G", "MG", "UG", "IU"] as const;

/**
 * Cell values that mean "the source did not publish a figure".
 *
 * Anything not on this list that fails to parse as a number is an *error*, not
 * a silent skip — an unrecognised marker is a signal that the manifest is
 * incomplete, and swallowing it would quietly drop real data.
 *
 * Trace markers ("tr", "trace") are deliberately absent. Trace is not zero and
 * not missing, and representing it honestly needs a product decision. Until
 * that decision exists, a dataset using them must list them here explicitly,
 * which records the choice rather than hiding it.
 */
export const DEFAULT_MISSING_VALUES = [
  "",
  "-",
  "--",
  "NA",
  "N/A",
  "n/a",
  "na",
  "NULL",
  "null",
] as const;

const nutrientMappingSchema = z
  .object({
    /** Column in the source file. */
    column: z.string().min(1, "A nutrient mapping needs a column name"),
    /** Vyom nutrient code, e.g. "PROTEIN". */
    nutrient: z.string().min(1),
    /**
     * The unit the *source file* publishes this column in. Required and never
     * inferred: assuming a unit is how a milligram silently becomes a
     * microgram.
     */
    unit: z.enum(NUTRIENT_UNITS),
    /** The publisher's own nutrient identifier, kept for traceability. */
    sourceNutrientCode: z.string().max(80).optional(),
  })
  .superRefine((mapping, ctx) => {
    if (!isKnownNutrientCode(mapping.nutrient)) {
      ctx.addIssue({
        code: "custom",
        path: ["nutrient"],
        message: `Unknown nutrient code "${mapping.nutrient}". See src/lib/nutrition/nutrients.ts.`,
      });
      return;
    }

    /*
     * The dictionary fixes one storage unit per nutrient. A manifest declaring
     * a different one is rejected rather than converted — the conversion
     * factor between IU and micrograms depends on the compound, and between
     * mg and µg a mistake is a factor of a thousand in a clinical figure.
     */
    const expected = nutrientUnit(mapping.nutrient);
    if (expected && mapping.unit !== expected) {
      ctx.addIssue({
        code: "custom",
        path: ["unit"],
        message:
          `${mapping.nutrient} is stored in ${expected}, but this column declares ${mapping.unit}. ` +
          "Vyom does not convert units during import: correct the manifest, or add a nutrient entry for the published unit.",
      });
    }
  });

const aliasMappingSchema = z.object({
  column: z.string().min(1),
  /** Splits a cell holding several names. */
  separator: z.string().min(1).default(";"),
  /** ISO 639-1, where the column is known to be in one language. */
  languageCode: z.string().max(8).optional(),
  region: z.string().max(100).optional(),
});

export const datasetManifestSchema = z.object({
  /** Registered source code — must exist in the source registry. */
  source: z.string().refine(isKnownSourceCode, {
    message: "Unknown source code. Register it in src/lib/nutrition/sources.ts first.",
  }),

  /** The publisher's version label for this release, e.g. "2017". */
  version: z.string().min(1).max(40),

  /**
   * Data file, relative to NUTRITION_DATA_DIR.
   *
   * Path separators and parent references are refused outright. A manifest is
   * a configuration file, and a configuration file must not be able to point
   * the importer at an arbitrary location on disk.
   */
  file: z
    .string()
    .min(1)
    .refine((value) => !value.includes("..") && !/[\\/]/.test(value), {
      message:
        "file must be a plain file name inside the nutrition data directory — no path separators or parent references",
    }),

  format: z.enum(["csv"]).default("csv"),
  delimiter: z.string().length(1).default(","),

  missingValues: z.array(z.string()).default([...DEFAULT_MISSING_VALUES]),

  /** Column holding the publisher's stable record identifier. */
  identifierColumn: z.string().min(1),
  /** Column holding the food's name. */
  nameColumn: z.string().min(1),
  descriptionColumn: z.string().min(1).optional(),

  /** Column holding the publisher's own category wording. */
  categoryColumn: z.string().min(1).optional(),
  /**
   * Publisher category wording → Vyom FoodCategory. Anything unmapped falls to
   * `defaultCategory` and raises a warning, so gaps surface in the report
   * rather than passing unnoticed.
   */
  categoryMap: z.record(z.string(), z.enum(FOOD_CATEGORIES)).default({}),
  defaultCategory: z.enum(FOOD_CATEGORIES).default("OTHER"),

  /** Applied to every row unless `foodTypeColumn` overrides it. */
  foodType: z.enum(FOOD_TYPES).default("RAW"),
  foodTypeColumn: z.string().min(1).optional(),
  foodTypeMap: z.record(z.string(), z.enum(FOOD_TYPES)).default({}),

  /**
   * What the nutrient figures are per. Defaults to 100 g, which IFCT and USDA
   * both use — but it is stated rather than assumed, because a per-serving
   * dataset read as per-100 g would be wrong by an unknown factor in every
   * downstream calculation.
   */
  basis: z
    .object({
      quantity: z.number().positive().default(100),
      unit: z.string().refine(isValidBasisUnit, {
        message:
          "A nutrition basis must be a canonical unit (g or ml). 'Per katori' cannot be stored, because nothing can later determine what a katori weighs.",
      }),
    })
    .default({ quantity: 100, unit: "g" }),

  aliasColumns: z.array(aliasMappingSchema).default([]),

  nutrients: z
    .array(nutrientMappingSchema)
    .min(1, "A manifest with no nutrient columns would import names and nothing else"),

  notes: z.string().optional(),
});

export type DatasetManifest = z.output<typeof datasetManifestSchema>;
export type DatasetManifestInput = z.input<typeof datasetManifestSchema>;

/**
 * Parses and validates a manifest.
 *
 * Returns the errors rather than throwing: the CLI reports all of them at once,
 * which is far more useful than fixing a twenty-column mapping one message per
 * run.
 */
export function parseDatasetManifest(
  input: unknown,
): { ok: true; manifest: DatasetManifest } | { ok: false; errors: string[] } {
  const result = datasetManifestSchema.safeParse(input);

  if (result.success) return { ok: true, manifest: result.data };

  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    }),
  };
}

/**
 * A decimal literal, as published.
 *
 * Deliberately does **not** accept thousands separators. "1,234" is 1234 in
 * one convention and 1.234 in another, and guessing which would corrupt the
 * value. Such a cell is reported as invalid so the manifest or the file can be
 * fixed.
 */
export const DECIMAL_LITERAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Collapses a Next.js search param to a single string.
 *
 * `searchParams` yields `string | string[] | undefined`, because a URL may
 * repeat a key: `?unit=GRAM&unit=SERVING` arrives as an array. A schema
 * expecting a string throws on that, and a page calling `.parse()` would answer
 * a hand-edited URL with a crash rather than a sensible default.
 *
 * The last occurrence wins, matching how a browser form would overwrite an
 * earlier value.
 */
function singleParam(value: unknown): unknown {
  if (Array.isArray(value)) return value.at(-1);
  return value;
}

/**
 * Food search query, as it arrives from the URL.
 *
 * `.catch()` on the coerced values clamps nonsense rather than erroring: a
 * hand-edited `?page=abc` should show page one, not a crash.
 */
export const foodSearchQuerySchema = z.object({
  q: z.preprocess(
    singleParam,
    z
      .string()
      .trim()
      .max(120)
      .optional()
      .catch(undefined)
      .transform((value) => (value === "" ? undefined : value)),
  ),
  category: z.preprocess(
    singleParam,
    z
      .string()
      .optional()
      .catch(undefined)
      .transform((value) =>
        value && (FOOD_CATEGORIES as readonly string[]).includes(value)
          ? (value as (typeof FOOD_CATEGORIES)[number])
          : undefined,
      ),
  ),
  source: z.preprocess(
    singleParam,
    z
      .string()
      .trim()
      .max(40)
      .optional()
      .catch(undefined)
      .transform((value) => (value === "" || value === "all" ? undefined : value)),
  ),
  page: z.preprocess(singleParam, z.coerce.number().int().min(1).catch(1)),
});

export type FoodSearchQuery = z.output<typeof foodSearchQuerySchema>;

/** Modest on purpose: nobody scans a hundred foods, and a big page is slow. */
export const FOODS_PER_PAGE = 20;

// ---------------------------------------------------------------------------
// Food nutrition calculator
// ---------------------------------------------------------------------------

/**
 * Calculator input, as it arrives from the URL.
 *
 * The quantity stays a **string** all the way to the engine. `z.coerce.number()`
 * would turn "0.1" into a binary float before anything had a chance to preserve
 * it, and a nutrition figure must not acquire error on the way in. Range and
 * sign are checked by the engine, which owns those rules and reports them as
 * typed errors a screen can render.
 *
 * `.catch()` clamps a hand-edited URL to a usable default rather than throwing:
 * a mistyped query string should show the form, not a crash.
 */
export const foodCalculationQuerySchema = z.object({
  unit: z.preprocess(
    singleParam,
    z
      .string()
      .optional()
      .catch(undefined)
      .transform((value) =>
        value && (QUANTITY_UNITS as readonly string[]).includes(value)
          ? (value as (typeof QUANTITY_UNITS)[number])
          : undefined,
      ),
  ),
  quantity: z.preprocess(
    singleParam,
    z
      .string()
      .trim()
      .max(20)
      .optional()
      .catch(undefined)
      .transform((value) => (value === "" ? undefined : value)),
  ),
  serving: z.preprocess(
    singleParam,
    z
      .string()
      .trim()
      .max(64)
      .optional()
      .catch(undefined)
      .transform((value) => (value === "" ? undefined : value)),
  ),
});

export type FoodCalculationQuery = z.output<typeof foodCalculationQuerySchema>;
