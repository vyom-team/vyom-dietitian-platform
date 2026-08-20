import { z } from "zod";

import { NUTRIENT_BY_CODE } from "@/lib/nutrition/nutrients";
import { isKnownSourceCode } from "@/lib/nutrition/sources";

/**
 * Reference-value manifest.
 *
 * The contract between a published requirement table — ICMR-NIN RDA/EAR and
 * anything like it — and Vyom's `reference_rules`. It says which file to read,
 * which column means what, and what kind of value each row carries.
 *
 * WHY A MANIFEST RATHER THAN A PARSER PER PUBLICATION
 *
 * Same reason the food importer uses one. A column-to-meaning mapping written
 * in JSON can be checked by somebody holding the printed page; the same mapping
 * buried in code cannot. It also turns "support another reference" into a
 * data-entry task rather than new code with a fresh chance to get a unit wrong.
 *
 * NOTHING HERE CONTAINS A CLINICAL VALUE. A manifest describes structure.
 */

export const REFERENCE_RULE_TYPES = [
  "BMR_EQUATION",
  "ACTIVITY_FACTOR",
  "GOAL_ENERGY_ADJUSTMENT",
  "PROTEIN_PER_KG",
  "FAT_ENERGY_PERCENT",
  "CARBOHYDRATE_ENERGY_PERCENT",
  "FIBRE_INTAKE",
  "MICRONUTRIENT_INTAKE",
] as const;

export const REFERENCE_VALUE_TYPES = [
  "RDA",
  "EAR",
  "AI",
  "UL",
  "RANGE",
  "FACTOR",
  "EQUATION",
] as const;

export const REFERENCE_UNITS = [
  "KCAL_PER_DAY",
  "G_PER_DAY",
  "MG_PER_DAY",
  "UG_PER_DAY",
  "G_PER_KG_PER_DAY",
  "PERCENT_OF_ENERGY",
  "FACTOR",
] as const;

export const SEX_APPLICABILITIES = ["ANY", "FEMALE", "MALE"] as const;
export const PHYSIOLOGICAL_STATES = ["NONE", "PREGNANCY", "LACTATION"] as const;

/**
 * Which nutrient unit each requirement unit is the daily form of.
 *
 * Used to reject a row whose unit disagrees with the nutrient dictionary. Iron
 * is stored in milligrams, so an iron requirement must arrive as MG_PER_DAY —
 * a row declaring UG_PER_DAY is a transcription error that would be wrong by a
 * factor of a thousand and look entirely plausible in a table.
 */
const UNIT_FOR_NUTRIENT_UNIT: Record<string, string> = {
  KCAL: "KCAL_PER_DAY",
  G: "G_PER_DAY",
  MG: "MG_PER_DAY",
  UG: "UG_PER_DAY",
};

const columnMapSchema = z.object({
  /** Vyom nutrient code, for MICRONUTRIENT_INTAKE rows. */
  nutrient: z.string().min(1).optional(),
  /** ActivityLevel / PrimaryGoal enum value, or an equation name. */
  ruleKey: z.string().min(1).optional(),
  /** Per-row rule type, when one file carries several. */
  ruleType: z.string().min(1).optional(),

  sex: z.string().min(1).optional(),
  ageMin: z.string().min(1).optional(),
  ageMax: z.string().min(1).optional(),
  physiologicalState: z.string().min(1).optional(),

  value: z.string().min(1).optional(),
  valueMin: z.string().min(1).optional(),
  valueMax: z.string().min(1).optional(),

  unit: z.string().min(1).optional(),
  valueType: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
});

const defaultsSchema = z.object({
  ruleType: z.enum(REFERENCE_RULE_TYPES).optional(),
  valueType: z.enum(REFERENCE_VALUE_TYPES).optional(),
  unit: z.enum(REFERENCE_UNITS).optional(),
  sex: z.enum(SEX_APPLICABILITIES).default("ANY"),
  physiologicalState: z.enum(PHYSIOLOGICAL_STATES).default("NONE"),
});

/**
 * Cell values that mean "this row has no figure here".
 *
 * Anything else that fails to parse is an **error**, not a silent skip. An
 * unrecognised marker means the manifest is incomplete, and swallowing it would
 * quietly drop a clinical value.
 */
export const REFERENCE_MISSING_VALUES = ["", "-", "--", "NA", "N/A", "n/a", "na"] as const;

export const referenceManifestSchema = z
  .object({
    /** Registered source code — must exist in the source registry. */
    source: z.string().refine(isKnownSourceCode, {
      message: "Unknown source code. Register it in src/lib/nutrition/sources.ts first.",
    }),

    /** The publisher's own version label, e.g. "2020". */
    version: z.string().min(1).max(40),

    /**
     * Data file, relative to NUTRITION_DATA_DIR. Path separators and parent
     * references are refused: a manifest is configuration and must not be able
     * to point the importer at an arbitrary location on disk.
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
    missingValues: z.array(z.string()).default([...REFERENCE_MISSING_VALUES]),

    columns: columnMapSchema,
    defaults: defaultsSchema.default({ sex: "ANY", physiologicalState: "NONE" }),

    /**
     * Where these values were read from — the table number, the page. Copied
     * onto every rule so a reviewer can find the printed original.
     */
    citation: z.string().min(1, "Say which table and page these values come from"),

    notes: z.string().optional(),
  })
  .superRefine((manifest, ctx) => {
    const hasRuleType = Boolean(manifest.columns.ruleType || manifest.defaults.ruleType);

    if (!hasRuleType) {
      ctx.addIssue({
        code: "custom",
        path: ["defaults", "ruleType"],
        message:
          "Every row needs a rule type. Set defaults.ruleType, or map columns.ruleType.",
      });
    }

    const hasValue =
      manifest.columns.value || (manifest.columns.valueMin && manifest.columns.valueMax);

    if (!hasValue) {
      ctx.addIssue({
        code: "custom",
        path: ["columns", "value"],
        message:
          "Map columns.value, or both columns.valueMin and columns.valueMax for a range.",
      });
    }

    if (!manifest.columns.unit && !manifest.defaults.unit) {
      ctx.addIssue({
        code: "custom",
        path: ["defaults", "unit"],
        message:
          "A unit is required and is never inferred. Set defaults.unit, or map columns.unit.",
      });
    }
  });

export type ReferenceManifest = z.output<typeof referenceManifestSchema>;

export function parseReferenceManifest(
  input: unknown,
): { ok: true; manifest: ReferenceManifest } | { ok: false; errors: string[] } {
  const result = referenceManifestSchema.safeParse(input);

  if (result.success) return { ok: true, manifest: result.data };

  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    }),
  };
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

/** One row, after the manifest has been applied. Values stay strings. */
export type ParsedReferenceRow = {
  ruleType: (typeof REFERENCE_RULE_TYPES)[number];
  nutrientCode: string | null;
  ruleKey: string | null;
  sexApplicability: (typeof SEX_APPLICABILITIES)[number];
  ageMinYears: number | null;
  ageMaxYears: number | null;
  physiologicalState: (typeof PHYSIOLOGICAL_STATES)[number];
  valueType: (typeof REFERENCE_VALUE_TYPES)[number];
  value: string | null;
  valueMin: string | null;
  valueMax: string | null;
  unit: (typeof REFERENCE_UNITS)[number];
  notes: string | null;
};

/**
 * Checks a row against everything that must hold before a clinical value is
 * written.
 *
 * Returns *all* the problems rather than the first, so a mis-mapped file is
 * fixed in one pass instead of one message per run.
 */
export function validateReferenceRow(row: ParsedReferenceRow): string[] {
  const errors: string[] = [];

  if (row.ruleType === "MICRONUTRIENT_INTAKE") {
    if (!row.nutrientCode) {
      errors.push("A micronutrient rule needs a nutrient code.");
    } else {
      const nutrient = NUTRIENT_BY_CODE.get(row.nutrientCode);

      if (!nutrient) {
        errors.push(
          `Unknown nutrient "${row.nutrientCode}". See src/lib/nutrition/nutrients.ts.`,
        );
      } else {
        /*
         * The unit check that matters. The dictionary fixes one storage unit
         * per nutrient; a requirement in a different one is rejected rather
         * than converted, because between mg and µg a mistake is a factor of a
         * thousand in a clinical figure.
         */
        const expected = UNIT_FOR_NUTRIENT_UNIT[nutrient.unit];

        if (!expected) {
          errors.push(
            `${row.nutrientCode} is stored in ${nutrient.unit}, which has no daily requirement unit. Vyom cannot represent a target for it.`,
          );
        } else if (row.unit !== expected) {
          errors.push(
            `${row.nutrientCode} is stored in ${nutrient.unit}, so its requirement must be ${expected}, not ${row.unit}. Vyom does not convert units on import.`,
          );
        }
      }
    }

    if (row.ruleKey) {
      errors.push("A micronutrient rule keys on the nutrient, not on a rule key.");
    }
  } else if (row.nutrientCode) {
    errors.push(`A ${row.ruleType} rule must not carry a nutrient code.`);
  }

  // Value shape must match what the publisher actually stated.
  if (row.valueType === "RANGE") {
    if (!row.valueMin || !row.valueMax) {
      errors.push("A RANGE needs both a minimum and a maximum.");
    }
    if (row.value) errors.push("A RANGE carries min and max, not a single value.");
  } else if (row.valueType === "EQUATION") {
    if (row.value || row.valueMin || row.valueMax) {
      errors.push("An EQUATION rule carries no numeric value.");
    }
  } else {
    if (!row.value) errors.push(`A ${row.valueType} needs a value.`);
    if (row.valueMin || row.valueMax) {
      errors.push(`A ${row.valueType} carries a single value, not a range.`);
    }
  }

  for (const [label, raw] of [
    ["value", row.value],
    ["minimum", row.valueMin],
    ["maximum", row.valueMax],
  ] as const) {
    if (raw === null) continue;

    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(raw)) {
      errors.push(`The ${label} "${raw}" is not a plain number.`);
    } else if (Number(raw) < 0) {
      errors.push(`The ${label} is negative. A requirement is never below zero.`);
    }
  }

  if (
    row.valueMin !== null &&
    row.valueMax !== null &&
    Number(row.valueMin) > Number(row.valueMax)
  ) {
    errors.push("The minimum is greater than the maximum.");
  }

  for (const [label, age] of [
    ["ageMin", row.ageMinYears],
    ["ageMax", row.ageMaxYears],
  ] as const) {
    if (age === null) continue;
    if (!Number.isInteger(age) || age < 0 || age > 130) {
      errors.push(`${label} must be a whole number of years between 0 and 130.`);
    }
  }

  if (
    row.ageMinYears !== null &&
    row.ageMaxYears !== null &&
    row.ageMinYears > row.ageMaxYears
  ) {
    errors.push("The minimum age is greater than the maximum age.");
  }

  return errors;
}
